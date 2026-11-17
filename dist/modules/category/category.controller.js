"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CategoryController = void 0;
const http_status_codes_1 = require("http-status-codes");
const catchAsync_1 = __importDefault(require("../../shared/catchAsync"));
const sendResponse_1 = __importDefault(require("../../shared/sendResponse"));
const category_service_1 = require("./category.service");
const localize_1 = require("../../helpers/localize");
const createCategory = (0, catchAsync_1.default)(async (req, res) => {
    const categoryData = { ...req.body };
    // Backward compatibility: support existing "images" field.
    if (req.body.images) {
        categoryData.icon = Array.isArray(req.body.images)
            ? req.body.images[0]
            : req.body.images;
    }
    if (req.body.icon) {
        categoryData.icon = Array.isArray(req.body.icon)
            ? req.body.icon[0]
            : req.body.icon;
    }
    const result = await category_service_1.CategoryService.createCategory(categoryData);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.CREATED,
        success: true,
        message: 'Category created successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, ['name']),
    });
});
const getAllCategories = (0, catchAsync_1.default)(async (req, res) => {
    const result = await category_service_1.CategoryService.getAllCategories(req.query);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Categories retrieved successfully',
        meta: result.meta,
        data: (0, localize_1.localizeDocument)(result.data, req.lang, ['name']),
    });
});
const getCategoryById = (0, catchAsync_1.default)(async (req, res) => {
    const id = (req.params && req.params.id) || (req.query && req.query.id) || (req.body && req.body.id);
    if (!id) {
        return (0, sendResponse_1.default)(res, {
            statusCode: http_status_codes_1.StatusCodes.BAD_REQUEST,
            success: false,
            message: 'Category id is required in URL params, query or request body',
        });
    }
    const result = await category_service_1.CategoryService.getCategoryById(id);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Category retrieved successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, ['name']),
    });
});
const updateCategory = (0, catchAsync_1.default)(async (req, res) => {
    const id = (req.params && req.params.id) || (req.body && req.body.id);
    if (!id) {
        return (0, sendResponse_1.default)(res, {
            statusCode: http_status_codes_1.StatusCodes.BAD_REQUEST,
            success: false,
            message: 'Category id is required in URL params or request body',
        });
    }
    const categoryData = { ...req.body };
    // Backward compatibility: support existing "images" field.
    if (req.body.images) {
        categoryData.icon = Array.isArray(req.body.images)
            ? req.body.images[0]
            : req.body.images;
    }
    if (req.body.icon) {
        categoryData.icon = Array.isArray(req.body.icon)
            ? req.body.icon[0]
            : req.body.icon;
    }
    const result = await category_service_1.CategoryService.updateCategory(id, categoryData);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Category updated successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, ['name']),
    });
});
const deleteCategory = (0, catchAsync_1.default)(async (req, res) => {
    const id = (req.params && req.params.id) || (req.body && req.body.id);
    if (!id) {
        return (0, sendResponse_1.default)(res, {
            statusCode: http_status_codes_1.StatusCodes.BAD_REQUEST,
            success: false,
            message: 'Category id is required in URL params or request body',
        });
    }
    const result = await category_service_1.CategoryService.deleteCategory(id);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Category deleted successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, ['name']),
    });
});
exports.CategoryController = {
    createCategory,
    getAllCategories,
    getCategoryById,
    updateCategory,
    deleteCategory,
};
