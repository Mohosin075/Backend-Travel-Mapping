import { Request, Response } from 'express'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import { StatusCodes } from 'http-status-codes'
import { MessageService } from './message.service'
import { JwtPayload } from 'jsonwebtoken'
import { Chat } from '../chat/chat.model'
import ApiError from '../../errors/ApiError'

const sendMessage = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload

  const payload = req.body

  const chat = await Chat.findById(payload.chatId).populate('participants')
  if (!chat) throw new ApiError(StatusCodes.NOT_FOUND, 'Chat not found')

  // find the receiver (the participant that is NOT the sender)
  const receiver = chat.participants.find(
    (p: any) => p._id.toString() !== user.authId.toString(),
  )

  if (!receiver)
    throw new ApiError(StatusCodes.BAD_REQUEST, 'No receiver found')

  const receiverId = (receiver as any)._id
  payload.receiver = receiverId // now you have a valid receiver ID

  const data = {
    ...req.body,
    image: payload?.images ? payload.images[0] : null,
    sender: user.authId,
    receiver: receiverId,
  }

  const message = await MessageService.sendMessageToDB(data)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Send Message Successfully',
    data: message,
  })
})

const getMessage = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const id = req.params.id
  const messages = await MessageService.getMessageFromDB(id, user)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Message Retrieve Successfully',
    data: messages,
  })
})

export const MessageController = { sendMessage, getMessage }
