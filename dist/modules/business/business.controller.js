"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessController = void 0;
const http_status_codes_1 = require("http-status-codes");
const catchAsync_1 = __importDefault(require("../../shared/catchAsync"));
const sendResponse_1 = __importDefault(require("../../shared/sendResponse"));
const business_service_1 = require("./business.service");
const localize_1 = require("../../helpers/localize");
const businessFields = [
    'name',
    'description',
    'category.name',
    'address',
    'accessDescription',
    'atmosphere',
    'location.address',
];
/**
 * Controller to handle business creation requests.
 */
const createBusiness = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const result = await business_service_1.BusinessService.createBusiness(req.body, user === null || user === void 0 ? void 0 : user.authId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.CREATED,
        success: true,
        message: 'Business submitted successfully and is pending approval',
        data: (0, localize_1.localizeDocument)(result, req.lang, businessFields),
    });
});
/**
 * Controller to retrieve a paginated listing of all businesses.
 */
const getAllBusinesses = (0, catchAsync_1.default)(async (req, res) => {
    const result = await business_service_1.BusinessService.getAllBusinesses(req.query, req.headers.authorization);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Businesses retrieved successfully',
        meta: result.meta,
        data: (0, localize_1.localizeDocument)(result.data, req.lang, businessFields),
    });
});
/**
 * Controller to retrieve a paginated listing of businesses owned by the user.
 */
const getMyBusinesses = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const result = await business_service_1.BusinessService.getMyBusinesses(user.authId, req.query);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'My businesses retrieved successfully',
        meta: result.meta,
        data: (0, localize_1.localizeDocument)(result.data, req.lang, businessFields),
    });
});
/**
 * Controller to retrieve single business detailed information by ID.
 */
const getBusinessById = (0, catchAsync_1.default)(async (req, res) => {
    const result = await business_service_1.BusinessService.getBusinessById(req.params.id, req.headers.authorization);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Business retrieved successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, businessFields),
    });
});
/**
 * Controller to update a business submission.
 */
const updateBusiness = (0, catchAsync_1.default)(async (req, res) => {
    const result = await business_service_1.BusinessService.updateBusiness(req.params.id, req.body, req.user);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Business updated successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, businessFields),
    });
});
/**
 * Controller strictly for administrative actions to alter the business status state machine.
 */
const updateBusinessStatus = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const result = await business_service_1.BusinessService.updateBusinessStatus(id, status);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: `Business status updated to ${status} successfully`,
        data: result,
    });
});
/**
 * Controller to handle permanent deletion of a business.
 */
const deleteBusiness = (0, catchAsync_1.default)(async (req, res) => {
    const result = await business_service_1.BusinessService.deleteBusiness(req.params.id, req.user);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Business deleted successfully',
        data: result,
    });
});
const getBusinessStats = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const timeFilter = req.query.timeFilter;
    const result = await business_service_1.BusinessService.getBusinessStats(id, timeFilter);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Business stats retrieved successfully',
        data: result,
    });
});
const incrementViewCount = (0, catchAsync_1.default)(async (req, res) => {
    var _a, _b, _c;
    const { id } = req.params;
    const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a._id) ||
        ((_b = req.user) === null || _b === void 0 ? void 0 : _b.id) ||
        ((_c = req.user) === null || _c === void 0 ? void 0 : _c.authId);
    const result = await business_service_1.BusinessService.incrementViewCount(id, userId ? String(userId) : undefined);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'View count incremented successfully',
        data: result,
    });
});
exports.BusinessController = {
    createBusiness,
    getAllBusinesses,
    getMyBusinesses,
    getBusinessById,
    updateBusiness,
    updateBusinessStatus,
    deleteBusiness,
    getBusinessStats,
    incrementViewCount,
};
