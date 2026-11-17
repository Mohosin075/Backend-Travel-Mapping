"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
const zod_1 = require("zod");
const handleZodError_1 = __importDefault(require("../errors/handleZodError"));
const handleCastError_1 = __importDefault(require("../errors/handleCastError"));
const handleValidationError_1 = __importDefault(require("../errors/handleValidationError"));
const ApiError_1 = __importDefault(require("../errors/ApiError"));
const translateMessage_1 = require("../helpers/translateMessage");
const globalErrorHandler = (error, req, res, next) => {
    var _a, _b;
    // Safe logging
    if (config_1.default.node_env === 'development') {
        console.error('Inside Global Error Handler🪐', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    }
    let statusCode = 500;
    let message = 'Something went wrong!';
    let errorMessages = [];
    if ((error === null || error === void 0 ? void 0 : error.code) === 11000) {
        const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || '';
        statusCode = 409;
        message = field === 'email'
            ? 'An account with this email already exists. Please log in or use another email.'
            : 'A record with these details already exists. Please use different details.';
        errorMessages = [{ path: field, message }];
    }
    else if ((error === null || error === void 0 ? void 0 : error.name) === 'ValidationError' || (error === null || error === void 0 ? void 0 : error.name) === 'validationError') {
        const simplifiedError = (0, handleValidationError_1.default)(error);
        statusCode = simplifiedError.statusCode;
        message = ((_a = simplifiedError.errorMessages[0]) === null || _a === void 0 ? void 0 : _a.message) || message;
        errorMessages = simplifiedError.errorMessages;
    }
    else if (error instanceof zod_1.ZodError) {
        const simplifiedError = (0, handleZodError_1.default)(error);
        statusCode = simplifiedError.statusCode;
        message = ((_b = simplifiedError.errorMessages[0]) === null || _b === void 0 ? void 0 : _b.message) || message;
        errorMessages = simplifiedError.errorMessages;
    }
    else if ((error === null || error === void 0 ? void 0 : error.name) === 'CastError') {
        const simplifiedError = (0, handleCastError_1.default)(error);
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message || message;
        errorMessages = simplifiedError.errorMessages || [];
    }
    else if (error instanceof ApiError_1.default) {
        statusCode = error.statusCode || statusCode;
        message = error.message || message;
        errorMessages = error.message ? [{ path: '', message: error.message }] : [];
    }
    else if (error instanceof Error) {
        message = error.message || message;
        errorMessages = error.message ? [{ path: '', message: error.message }] : [];
    }
    const lang = req.lang || 'es';
    const localizedMessage = (0, translateMessage_1.translateMessage)(message, lang);
    const localizedErrorMessages = errorMessages.map(err => ({
        ...err,
        message: (0, translateMessage_1.translateMessage)(err.message, lang),
    }));
    res.status(statusCode).json({
        success: false,
        message: localizedMessage,
        errorMessages: localizedErrorMessages,
        stack: config_1.default.node_env === 'production' || (error === null || error === void 0 ? void 0 : error.code) === 11000 ? undefined : error === null || error === void 0 ? void 0 : error.stack,
    });
};
exports.default = globalErrorHandler;
