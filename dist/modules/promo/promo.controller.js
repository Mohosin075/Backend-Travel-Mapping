"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromoControllers = void 0;
const http_status_codes_1 = require("http-status-codes");
const catchAsync_1 = __importDefault(require("../../shared/catchAsync"));
const sendResponse_1 = __importDefault(require("../../shared/sendResponse"));
const promo_service_1 = require("./promo.service");
const localize_1 = require("../../helpers/localize");
const promoFields = ['mapId.name'];
const verifyPromoPayment = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const result = await promo_service_1.PromoServices.verifyPromoPayment(user.authId, req.body.code, req.body.sessionId);
    (0, sendResponse_1.default)(res, { statusCode: http_status_codes_1.StatusCodes.OK, success: true, message: 'Promo payment verified', data: result });
});
const verifyPromoCode = (0, catchAsync_1.default)(async (req, res) => {
    const { code, mapId } = req.query;
    if (!code) {
        return (0, sendResponse_1.default)(res, {
            statusCode: http_status_codes_1.StatusCodes.BAD_REQUEST,
            success: false,
            message: 'Code query parameter is required',
        });
    }
    const result = await promo_service_1.PromoServices.verifyPromoCode(code, mapId);
    const { checkoutReservationId, checkoutUserId, checkoutMapId, checkoutExpiresAt, checkoutSessionId, checkoutReturnOrigin, ...publicPromo } = result;
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Promo link is valid',
        data: publicPromo,
    });
});
const claimFreePromo = (0, catchAsync_1.default)(async (req, res) => {
    const { code, mapId } = req.body;
    const user = req.user;
    const userId = user === null || user === void 0 ? void 0 : user.authId; // Get authenticated user ID from req.user
    if (!userId) {
        return (0, sendResponse_1.default)(res, {
            statusCode: http_status_codes_1.StatusCodes.UNAUTHORIZED,
            success: false,
            message: 'User authentication credentials not found',
        });
    }
    const result = await promo_service_1.PromoServices.claimFreePromo(userId, code, mapId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: result.message,
        data: { mapId: result.mapId, mapName: result.mapName },
    });
});
const createPromoCheckoutSession = (0, catchAsync_1.default)(async (req, res) => {
    const { code, mapId } = req.body;
    const user = req.user;
    if (!user) {
        return (0, sendResponse_1.default)(res, {
            statusCode: http_status_codes_1.StatusCodes.UNAUTHORIZED,
            success: false,
            message: 'User credentials not found',
        });
    }
    const result = await promo_service_1.PromoServices.createPromoCheckoutSession(user, code, mapId, req.headers.origin);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Promo checkout session created successfully',
        data: result,
    });
});
const bulkGeneratePromoLinks = (0, catchAsync_1.default)(async (req, res) => {
    const result = await promo_service_1.PromoServices.bulkGeneratePromoLinks(req.body);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.CREATED,
        success: true,
        message: 'Promo links generated successfully',
        data: result,
    });
});
const sendBulkPromoEmails = (0, catchAsync_1.default)(async (req, res) => {
    const { promoIds } = req.body;
    const result = await promo_service_1.PromoServices.sendBulkPromoEmails(promoIds);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: result.message,
    });
});
const getAllPromoLinks = (0, catchAsync_1.default)(async (req, res) => {
    const result = await promo_service_1.PromoServices.getAllPromoLinks(req.query);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Promo links retrieved successfully',
        meta: result.meta,
        data: (0, localize_1.localizeDocument)(result.data, req.lang, promoFields),
    });
});
const deletePromoLink = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await promo_service_1.PromoServices.deletePromoLink(id);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Promo link deleted successfully',
        data: result,
    });
});
const getPromoStats = (0, catchAsync_1.default)(async (req, res) => {
    const result = await promo_service_1.PromoServices.getPromoStats();
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Promo stats retrieved successfully',
        data: result,
    });
});
exports.PromoControllers = {
    verifyPromoPayment,
    verifyPromoCode,
    claimFreePromo,
    createPromoCheckoutSession,
    bulkGeneratePromoLinks,
    sendBulkPromoEmails,
    getAllPromoLinks,
    deletePromoLink,
    getPromoStats,
};
