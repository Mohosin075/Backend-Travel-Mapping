"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCheckoutReturnOrigin = void 0;
const config_1 = __importDefault(require("../config"));
const ApiError_1 = __importDefault(require("../errors/ApiError"));
const http_status_codes_1 = require("http-status-codes");
// Only server-configured frontend origins can receive a checkout return.
const getCheckoutReturnOrigin = (origin) => {
    if (!origin)
        return new URL(config_1.default.clientUrl).origin;
    let url;
    try {
        url = new URL(origin);
    }
    catch (_a) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid checkout origin.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid checkout origin.');
    }
    const allowed = [config_1.default.clientUrl, ...(config_1.default.cors_origins || [])].some(value => {
        try {
            return new URL(value).origin === url.origin;
        }
        catch (_a) {
            return false;
        }
    });
    const localDevelopment = config_1.default.node_env !== 'production' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!allowed && !localDevelopment)
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Checkout origin is not allowed.');
    return url.origin;
};
exports.getCheckoutReturnOrigin = getCheckoutReturnOrigin;
