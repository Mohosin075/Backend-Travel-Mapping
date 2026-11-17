"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewController = void 0;
const review_service_1 = require("./review.service");
const catchAsync_1 = __importDefault(require("../../shared/catchAsync"));
const sendResponse_1 = __importDefault(require("../../shared/sendResponse"));
const http_status_codes_1 = require("http-status-codes");
const pagination_1 = require("../../interfaces/pagination");
const pick_1 = __importDefault(require("../../shared/pick"));
const mapAccessHelper_1 = require("../../helpers/mapAccessHelper");
const localize_1 = require("../../helpers/localize");
const reviewFields = [
    'review',
    'placeId.name',
    'placeId.description',
    'businessId.name',
    'businessId.description',
];
const createReview = (0, catchAsync_1.default)(async (req, res) => {
    const result = await review_service_1.ReviewService.createReview(req.user, req.body);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.CREATED,
        success: true,
        message: 'Review created successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, reviewFields),
    });
});
const updateReview = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await review_service_1.ReviewService.updateReview(req.user, id, req.body);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Review updated successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, reviewFields),
    });
});
const getAllReviews = (0, catchAsync_1.default)(async (req, res) => {
    const paginationOptions = (0, pick_1.default)(req.query, pagination_1.paginationFields);
    // Extract filters: placeId, businessId, reviewer, status
    const filter = (0, pick_1.default)(req.query, ['placeId', 'businessId', 'reviewer', 'status']);
    // Enforce Approved reviews only for regular users if status filter isn't explicitly checked/allowed
    const user = req.user;
    const isAdmin = user && (user.role === 'admin' || user.role === 'super_admin');
    if (!isAdmin && !filter.status) {
        filter.status = 'Approved';
    }
    const result = await review_service_1.ReviewService.getAllReviews(paginationOptions, filter, req.user);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Reviews retrieved successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, reviewFields),
    });
});
const getReviewsByPlace = (0, catchAsync_1.default)(async (req, res) => {
    var _a;
    const { placeId } = req.params;
    const user = await (0, mapAccessHelper_1.getUserFromToken)(req.headers.authorization);
    const paginationOptions = (0, pick_1.default)(req.query, pagination_1.paginationFields);
    const result = await review_service_1.ReviewService.getReviewsByPlace(placeId, paginationOptions, (_a = user === null || user === void 0 ? void 0 : user._id) === null || _a === void 0 ? void 0 : _a.toString(), user === null || user === void 0 ? void 0 : user.role);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Reviews retrieved successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, reviewFields),
    });
});
const getReviewsByBusiness = (0, catchAsync_1.default)(async (req, res) => {
    var _a;
    const { businessId } = req.params;
    const user = await (0, mapAccessHelper_1.getUserFromToken)(req.headers.authorization);
    const paginationOptions = (0, pick_1.default)(req.query, pagination_1.paginationFields);
    const result = await review_service_1.ReviewService.getReviewsByBusiness(businessId, paginationOptions, (_a = user === null || user === void 0 ? void 0 : user._id) === null || _a === void 0 ? void 0 : _a.toString(), user === null || user === void 0 ? void 0 : user.role);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Reviews retrieved successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, reviewFields),
    });
});
const deleteReview = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await review_service_1.ReviewService.deleteReview(req.user, id);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Review deleted successfully',
        data: result,
    });
});
const getSingleReview = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await review_service_1.ReviewService.getSingleReview(id, req.user);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Review retrieved successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, reviewFields),
    });
});
const getMyReviews = (0, catchAsync_1.default)(async (req, res) => {
    const paginationOptions = (0, pick_1.default)(req.query, pagination_1.paginationFields);
    const result = await review_service_1.ReviewService.getMyReviews(req.user, paginationOptions);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'My reviews retrieved successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, reviewFields),
    });
});
const approveReview = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await review_service_1.ReviewService.approveReview(id);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Review approved successfully',
        data: result,
    });
});
const rejectReview = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await review_service_1.ReviewService.rejectReview(id);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Review rejected successfully',
        data: result,
    });
});
exports.ReviewController = {
    createReview,
    updateReview,
    getAllReviews,
    deleteReview,
    getSingleReview,
    getReviewsByPlace,
    getReviewsByBusiness,
    getMyReviews,
    approveReview,
    rejectReview,
};
