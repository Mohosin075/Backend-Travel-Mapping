"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfferController = void 0;
const http_status_codes_1 = require("http-status-codes");
const catchAsync_1 = __importDefault(require("../../shared/catchAsync"));
const sendResponse_1 = __importDefault(require("../../shared/sendResponse"));
const offer_service_1 = require("./offer.service");
const localize_1 = require("../../helpers/localize");
const offerFields = ['title', 'description', 'buttonLabel', 'place.name', 'business.name'];
const createOffer = (0, catchAsync_1.default)(async (req, res) => {
    const result = await offer_service_1.OfferService.createOffer(req.body, req.headers.authorization);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.CREATED,
        success: true,
        message: 'Offer created successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, offerFields),
    });
});
const getAllOffers = (0, catchAsync_1.default)(async (req, res) => {
    const result = await offer_service_1.OfferService.getAllOffers(req.query, req.headers.authorization);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Offers retrieved successfully',
        meta: result.meta,
        data: (0, localize_1.localizeDocument)(result.data, req.lang, offerFields),
    });
});
const getOfferById = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await offer_service_1.OfferService.getOfferById(id, req.headers.authorization);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Offer retrieved successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, offerFields),
    });
});
const updateOffer = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await offer_service_1.OfferService.updateOffer(id, req.body, req.headers.authorization);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Offer updated successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, offerFields),
    });
});
const getOffersByPlaceOrBusinessId = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await offer_service_1.OfferService.getOffersByPlaceOrBusinessId(id, req.headers.authorization);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Offers retrieved successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, offerFields),
    });
});
const deleteOffer = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await offer_service_1.OfferService.deleteOffer(id);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Offer deleted successfully',
        data: result,
    });
});
const calculateDiscount = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const { price } = req.body;
    const result = await offer_service_1.OfferService.calculateDiscount(id, Number(price), req.headers.authorization);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Discount calculated successfully',
        data: result,
    });
});
const redeemOffer = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const { authId } = req.user;
    const result = await offer_service_1.OfferService.redeemOffer(id, authId, req.headers.authorization);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Offer redeemed successfully',
        data: result,
    });
});
const getOfferRedemptions = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const timeFilter = req.query.timeFilter;
    const result = await offer_service_1.OfferService.getOfferRedemptions(id, req.headers.authorization, timeFilter);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Offer redemptions retrieved successfully',
        data: result,
    });
});
exports.OfferController = {
    createOffer,
    getAllOffers,
    getManagedOffers: (0, catchAsync_1.default)(async (req, res) => {
        const result = await offer_service_1.OfferService.getManagedOffers(req.query, req.headers.authorization);
        (0, sendResponse_1.default)(res, {
            statusCode: http_status_codes_1.StatusCodes.OK, success: true, message: 'Managed offers retrieved successfully',
            meta: result.meta, data: (0, localize_1.localizeDocument)(result.data, req.lang, offerFields),
        });
    }),
    getOfferById,
    updateOffer,
    deleteOffer,
    calculateDiscount,
    redeemOffer,
    getOffersByPlaceOrBusinessId,
    getOfferRedemptions,
};
