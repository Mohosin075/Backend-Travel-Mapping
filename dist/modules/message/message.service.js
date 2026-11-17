"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageService = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const notification_integration_1 = require("../notification/notification.integration");
const message_model_1 = require("./message.model");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const http_status_codes_1 = require("http-status-codes");
const user_model_1 = require("../user/user.model");
const chat_model_1 = require("../chat/chat.model");
const sendMessageToDB = async (payload) => {
    if (!mongoose_1.default.Types.ObjectId.isValid(payload.receiver)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Receiver ID');
    }
    const sender = await user_model_1.User.findById(payload.sender).select('name');
    // save to DB
    const response = await message_model_1.Message.create(payload);
    // Update Chat's updatedAt to bring it to the top
    await chat_model_1.Chat.findByIdAndUpdate(payload.chatId, {
        $set: { updatedAt: new Date() },
    });
    //@ts-ignore
    const io = global.io;
    if (io) {
        io.emit(`getMessage::${payload === null || payload === void 0 ? void 0 : payload.chatId}`, response);
        io.emit(`updateChatList::${payload === null || payload === void 0 ? void 0 : payload.sender}`);
        io.emit(`updateChatList::${payload === null || payload === void 0 ? void 0 : payload.receiver}`);
    }
    // Trigger in-app notification for receiver
    const senderName = (sender === null || sender === void 0 ? void 0 : sender.name) ? `${sender.name}: ` : '';
    notification_integration_1.NotificationIntegration.onNewMessage(payload.sender, payload.receiver, `${senderName}${payload.text || 'Nuevo mensaje'}`).catch(err => {
        console.error('Failed to dispatch message notification:', err);
    });
    return response;
};
const getMessageFromDB = async (chatId, user) => {
    // Find messages that will be marked as seen to identify the sender
    const unreadMessages = await message_model_1.Message.find({
        chatId,
        sender: { $ne: user.authId },
        seen: false,
    });
    if (unreadMessages.length > 0) {
        // Mark messages as seen when chat is opened
        await message_model_1.Message.updateMany({ chatId, sender: { $ne: user.authId }, seen: false }, { $set: { seen: true } });
        // Notify the senders that their messages were seen
        //@ts-ignore
        const io = global.io;
        if (io) {
            // For each unique sender of the unread messages, notify them
            const senders = [...new Set(unreadMessages.map(m => m.sender.toString()))];
            senders.forEach(senderId => {
                io.emit(`updateChatList::${senderId}`);
            });
        }
    }
    const messages = await message_model_1.Message.find({ chatId }).sort({ createdAt: -1 }).lean();
    return messages;
};
exports.MessageService = { sendMessageToDB, getMessageFromDB };
