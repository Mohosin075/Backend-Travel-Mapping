import mongoose from 'mongoose'
import { NotificationIntegration } from '../notification/notification.integration'
import { IMessage } from './message.interface'
import { Message } from './message.model'
import ApiError from '../../errors/ApiError'
import { StatusCodes } from 'http-status-codes'
import { User } from '../user/user.model'
import { Chat } from '../chat/chat.model'

const sendMessageToDB = async (payload: any): Promise<IMessage> => {

  if (!mongoose.Types.ObjectId.isValid(payload.receiver)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Receiver ID')
  }

  const sender = await User.findById(payload.sender).select('name')

  // save to DB
  const response = await Message.create(payload)

  // Update Chat's updatedAt to bring it to the top
  await Chat.findByIdAndUpdate(payload.chatId, {
    $set: { updatedAt: new Date() },
  })

  //@ts-ignore
  const io = global.io
  if (io) {
    io.emit(`getMessage::${payload?.chatId}`, response)
    io.emit(`updateChatList::${payload?.sender}`)
    io.emit(`updateChatList::${payload?.receiver}`)
  }

  // Trigger in-app notification for receiver
  const senderName = sender?.name ? `${sender.name}: ` : ''
  NotificationIntegration.onNewMessage(
    payload.sender,
    payload.receiver,
    `${senderName}${payload.text || 'Nuevo mensaje'}`,
  ).catch(err => {
    console.error('Failed to dispatch message notification:', err)
  })

  return response
}

const getMessageFromDB = async (
  chatId: string,
  user: any,
): Promise<IMessage[]> => {
  // Find messages that will be marked as seen to identify the sender
  const unreadMessages = await Message.find({
    chatId,
    sender: { $ne: user.authId },
    seen: false,
  })

  if (unreadMessages.length > 0) {
    // Mark messages as seen when chat is opened
    await Message.updateMany(
      { chatId, sender: { $ne: user.authId }, seen: false },
      { $set: { seen: true } },
    )

    // Notify the senders that their messages were seen
    //@ts-ignore
    const io = global.io
    if (io) {
      // For each unique sender of the unread messages, notify them
      const senders = [...new Set(unreadMessages.map(m => m.sender.toString()))]
      senders.forEach(senderId => {
        io.emit(`updateChatList::${senderId}`)
      })
    }
  }

  const messages = await Message.find({ chatId }).sort({ createdAt: -1 }).lean()
  return messages as any
}

export const MessageService = { sendMessageToDB, getMessageFromDB }
