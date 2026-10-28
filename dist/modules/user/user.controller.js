"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserController = void 0;
const http_status_codes_1 = require("http-status-codes");
const catchAsync_1 = __importDefault(require("../../shared/catchAsync"));
const sendResponse_1 = __importDefault(require("../../shared/sendResponse"));
const user_service_1 = require("./user.service");
const pick_1 = __importDefault(require("../../shared/pick"));
const pagination_1 = require("../../interfaces/pagination");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const user_constants_1 = require("./user.constants");
const mapAccessHelper_1 = require("../../helpers/mapAccessHelper");
const updateProfile = (0, catchAsync_1.default)(async (req, res) => {
    const { images, ...userData } = req.body;
    if (images) {
        userData.profile = Array.isArray(images) ? images[0] : images;
    }
    const result = await user_service_1.UserServices.updateProfile(req.user, userData);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Profile updated successfully',
        data: result,
    });
});
const getAllUsers = (0, catchAsync_1.default)(async (req, res) => {
    const paginationOptions = (0, pick_1.default)(req.query, pagination_1.paginationFields);
    const filterables = (0, pick_1.default)(req.query, user_constants_1.userFilterableFields);
    const result = await user_service_1.UserServices.getAllUsers(paginationOptions, filterables);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Users retrieved successfully',
        meta: result.meta,
        data: result.data,
    });
});
const deleteUser = (0, catchAsync_1.default)(async (req, res) => {
    const { userId } = req.params;
    const result = await user_service_1.UserServices.deleteUser(userId, req.user);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'User deleted successfully',
        data: result,
    });
});
const deleteProfile = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const { password } = req.body;
    if (!password) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Password is required');
    }
    const result = await user_service_1.UserServices.deleteProfile(user.authId, password);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'User profile deleted successfully',
        data: result,
    });
});
const getUserById = (0, catchAsync_1.default)(async (req, res) => {
    const { userId } = req.params;
    const result = await user_service_1.UserServices.getUserById(userId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'User retrieved successfully',
        data: result,
    });
});
const updateUserStatus = (0, catchAsync_1.default)(async (req, res) => {
    const { userId } = req.params;
    const { status } = req.body;
    if (!status) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Status is required');
    }
    const result = await user_service_1.UserServices.updateUserStatus(userId, status, req.user);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'User status updated successfully',
        data: result,
    });
});
const updateUserRole = (0, catchAsync_1.default)(async (req, res) => {
    const { userId } = req.params;
    const { role, assignedMaps, assignedCountries } = req.body;
    if (!role) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Role is required');
    }
    const result = await user_service_1.UserServices.updateUserRole(userId, role, assignedMaps, assignedCountries, req.user);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'User role updated successfully',
        data: result,
    });
});
const inviteUser = (0, catchAsync_1.default)(async (req, res) => {
    const result = await user_service_1.UserServices.inviteUser(req.body, req.user);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: result,
    });
});
const getProfile = (0, catchAsync_1.default)(async (req, res) => {
    const result = await user_service_1.UserServices.getProfile(req.user);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'User profile retrieved successfully',
        data: result,
    });
});
const getPublicProfile = (0, catchAsync_1.default)(async (req, res) => {
    const { userId } = req.params;
    const requester = await (0, mapAccessHelper_1.getUserFromToken)(req.headers.authorization);
    const result = await user_service_1.UserServices.getPublicProfile(userId, requester);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Public profile retrieved successfully',
        data: result,
    });
});
const addUserInterest = (0, catchAsync_1.default)(async (req, res) => {
    const { authId } = req.user;
    const { interest } = req.body;
    const result = await user_service_1.UserServices.addUserInterest(authId, interest);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'User interest updated successfully',
        data: result,
    });
});
const toggleFavoriteMap = (0, catchAsync_1.default)(async (req, res) => {
    const { authId } = req.user;
    const { mapId } = req.params;
    const result = await user_service_1.UserServices.toggleFavoriteMap(authId, mapId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Toggle favorite map successfully',
        data: result,
    });
});
const getFavoriteMaps = (0, catchAsync_1.default)(async (req, res) => {
    const { authId } = req.user;
    const result = await user_service_1.UserServices.getFavoriteMaps(authId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Favorite maps retrieved successfully',
        data: result,
    });
});
const toggleFavoriteOffer = (0, catchAsync_1.default)(async (req, res) => {
    const { authId } = req.user;
    const { offerId } = req.params;
    const result = await user_service_1.UserServices.toggleFavoriteOffer(authId, offerId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: result,
        data: result,
    });
});
const getFavoriteOffers = (0, catchAsync_1.default)(async (req, res) => {
    const { authId } = req.user;
    const result = await user_service_1.UserServices.getFavoriteOffers(authId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Favorite offers retrieved successfully',
        data: result,
    });
});
const assignEditorAccess = (0, catchAsync_1.default)(async (req, res) => {
    const { userId } = req.params;
    const { assignedMaps, assignedCountries } = req.body;
    const result = await user_service_1.UserServices.assignEditorAccess(userId, assignedMaps, assignedCountries);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Editor access assigned successfully',
        data: result,
    });
});
const updateUserMapAccess = (0, catchAsync_1.default)(async (req, res) => {
    const { userId } = req.params;
    const { mapId, action } = req.body;
    const result = await user_service_1.UserServices.updateUserMapAccess(userId, mapId, action, req.user);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: result.message,
        data: result.user,
    });
});
exports.UserController = {
    updateProfile,
    getAllUsers,
    deleteUser,
    getUserById,
    updateUserStatus,
    updateUserRole,
    inviteUser,
    getProfile,
    getPublicProfile,
    deleteProfile,
    addUserInterest,
    toggleFavoriteMap,
    getFavoriteMaps,
    toggleFavoriteOffer,
    getFavoriteOffers,
    assignEditorAccess,
    updateUserMapAccess,
};
