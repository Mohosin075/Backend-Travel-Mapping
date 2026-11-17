"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupportServices = void 0;
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const support_model_1 = require("./support.model");
const paginationHelper_1 = require("../../helpers/paginationHelper");
const mongoose_1 = require("mongoose");
const support_1 = require("../../enum/support");
const user_model_1 = require("../user/user.model");
const user_1 = require("../../enum/user");
const createSupport = async (user, payload) => {
    const data = {
        ...payload,
        userId: user === null || user === void 0 ? void 0 : user.authId,
        status: support_1.SUPPORT_STATUS.IN_PROGRESS,
    };
    try {
        const result = await support_model_1.Support.create(data);
        if (!result) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to create Support, please try again with valid data.');
        }
        const superAdmin = await user_model_1.User.findOne({
            role: user_1.USER_ROLES.SUPER_ADMIN,
            status: user_1.USER_STATUS.ACTIVE,
        }).select('_id email');
        return result;
    }
    catch (error) {
        if (error.code === 11000) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, 'Duplicate entry found');
        }
        throw error;
    }
};
const getAllSupports = async (user, filterables, pagination) => {
    const { page, skip, limit, sortBy, sortOrder } = paginationHelper_1.paginationHelper.calculatePagination(pagination);
    const [result, total] = await Promise.all([
        support_model_1.Support.find({ status: { $nin: [support_1.SUPPORT_STATUS.DELETED] } })
            .skip(skip)
            .limit(limit)
            .sort({ [sortBy]: sortOrder })
            .populate({ path: 'userId', select: 'email name' }),
        support_model_1.Support.countDocuments({ status: { $nin: [support_1.SUPPORT_STATUS.DELETED] } }),
    ]);
    return {
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
        data: result,
    };
};
const getSingleSupport = async (id) => {
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Support ID');
    }
    const result = await support_model_1.Support.findById(id).populate({
        path: 'userId',
        select: 'email name',
    });
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Requested support not found, please try again with valid id');
    }
    return result;
};
const updateSupport = async (id, payload) => {
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Support ID');
    }
    const isSupportExist = await support_model_1.Support.findOne({
        _id: id,
        status: { $nin: [support_1.SUPPORT_STATUS.DELETED] },
    });
    if (!isSupportExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Requested support not found, please try again with valid id');
    }
    const result = await support_model_1.Support.findByIdAndUpdate(id, { $set: payload }, { new: true, runValidators: true }).populate('userId');
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Requested support not found, please try again with valid id');
    }
    return result;
};
const deleteSupport = async (id) => {
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Support ID');
    }
    const isSupportExist = await support_model_1.Support.findOne({
        _id: id,
        status: { $nin: [support_1.SUPPORT_STATUS.DELETED] },
    });
    if (!isSupportExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Requested support not found, please try again with valid id');
    }
    const result = await support_model_1.Support.findByIdAndUpdate(id, { $set: { status: support_1.SUPPORT_STATUS.DELETED } }, { new: true });
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Something went wrong while deleting support, please try again with valid id.');
    }
    return result;
};
exports.SupportServices = {
    createSupport,
    getAllSupports,
    getSingleSupport,
    updateSupport,
    deleteSupport,
};
