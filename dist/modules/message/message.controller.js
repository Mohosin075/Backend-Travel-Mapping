"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageController = void 0;
const catchAsync_1 = __importDefault(require("../../shared/catchAsync"));
const sendResponse_1 = __importDefault(require("../../shared/sendResponse"));
const http_status_codes_1 = require("http-status-codes");
const message_service_1 = require("./message.service");
const chat_model_1 = require("../chat/chat.model");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const sendMessage = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const payload = req.body;
    const chat = await chat_model_1.Chat.findById(payload.chatId).populate('participants');
    if (!chat)
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Chat not found');
    // find the receiver (the participant that is NOT the sender)
    const receiver = chat.participants.find((p) => p._id.toString() !== user.authId.toString());
    if (!receiver)
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'No receiver found');
    const receiverId = receiver._id;
    payload.receiver = receiverId; // now you have a valid receiver ID
    const data = {
        ...req.body,
        image: (payload === null || payload === void 0 ? void 0 : payload.images) ? payload.images[0] : null,
        sender: user.authId,
        receiver: receiverId,
    };
    const message = await message_service_1.MessageService.sendMessageToDB(data);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Send Message Successfully',
        data: message,
    });
});
const getMessage = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const id = req.params.id;
    const messages = await message_service_1.MessageService.getMessageFromDB(id, user);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Message Retrieve Successfully',
        data: messages,
    });
});
exports.MessageController = { sendMessage, getMessage };
