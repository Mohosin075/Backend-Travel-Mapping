"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaceController = void 0;
const http_status_codes_1 = require("http-status-codes");
const catchAsync_1 = __importDefault(require("../../shared/catchAsync"));
const sendResponse_1 = __importDefault(require("../../shared/sendResponse"));
const place_service_1 = require("./place.service");
const mapAccessHelper_1 = require("../../helpers/mapAccessHelper");
const map_model_1 = require("../map/map.model");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const mapHelper_1 = require("../../utils/mapHelper");
const user_1 = require("../../enum/user");
const media_1 = require("../../utils/media");
const localize_1 = require("../../helpers/localize");
const pick_1 = __importDefault(require("../../shared/pick"));
const placeFields = ['name', 'description', 'access', 'entryCost', 'hikeTime', 'atmosphere', 'accessibility.notes', 'recommendations.tips', 'category.name'];
const createPlace = (0, catchAsync_1.default)(async (req, res) => {
    const user = await (0, mapAccessHelper_1.getUserFromToken)(req.headers.authorization);
    // A place must belong to a map, verify access
    if (req.body.map) {
        await (0, mapAccessHelper_1.verifyEditorEditAccess)(user, req.body.map);
    }
    const uploadedImages = (0, media_1.toStringArray)(req.body.images);
    const uploadedDocs = (0, media_1.toStringArray)(req.body.documents);
    if (uploadedImages.length || req.body.media) {
        req.body.media = [
            ...(0, media_1.toStringArray)(req.body.media),
            ...uploadedImages,
        ];
    }
    if (uploadedDocs.length || req.body.menuImages) {
        req.body.menuImages = [
            ...(0, media_1.toStringArray)(req.body.menuImages),
            ...uploadedDocs,
        ];
    }
    const result = await place_service_1.PlaceService.createPlace(req.body);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.CREATED,
        success: true,
        message: 'Place created successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, placeFields),
    });
});
const getAllPlaces = (0, catchAsync_1.default)(async (req, res) => {
    const authorizationHeader = req.headers.authorization;
    // Run auth lookup and paid map IDs in parallel to avoid sequential DB hits
    const [user, paidMaps] = await Promise.all([
        (0, mapAccessHelper_1.getUserFromToken)(authorizationHeader),
        map_model_1.Map.find({ isPaid: true }, '_id'),
    ]);
    const accessibleMapIds = await (0, mapAccessHelper_1.getAccessibleMapIds)(user);
    const paidMapIds = paidMaps.map(m => m._id.toString());
    const lockedMapIds = paidMapIds.filter(id => !accessibleMapIds.includes(id));
    const isPremium = !!(user && [user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.MAP_EDITOR].includes(user.role));
    const result = await place_service_1.PlaceService.getAllPlaces(req.query, isPremium, accessibleMapIds);
    const visitedSet = new Set(((user === null || user === void 0 ? void 0 : user.visitedPlaces) || []).map((id) => id.toString()));
    const updatedData = result.data.map((place) => {
        var _a;
        const mapId = ((_a = place.map) === null || _a === void 0 ? void 0 : _a._id) || place.map;
        const isLocked = !isPremium && mapId && lockedMapIds.includes(mapId.toString()) && place.type !== 'Business';
        const isVisited = visitedSet.has(place._id.toString());
        if (isLocked) {
            // Keep teaser fields (name/media/category/location) for locked cards
            const { description, hours, privateInfo, ...teaser } = place;
            return {
                ...teaser,
                description: undefined,
                hours: undefined,
                privateInfo: undefined,
                isLocked: true,
                isVisited,
            };
        }
        return {
            ...place,
            isLocked: false,
            isVisited,
        };
    });
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Places retrieved successfully',
        meta: result.meta,
        data: (0, localize_1.localizeDocument)(updatedData, req.lang, placeFields),
    });
});
const getPlaceById = (0, catchAsync_1.default)(async (req, res) => {
    var _a;
    const { id } = req.params;
    const result = await place_service_1.PlaceService.getPlaceById(id);
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
    }
    const authorizationHeader = req.headers.authorization;
    const user = await (0, mapAccessHelper_1.getUserFromToken)(authorizationHeader);
    const isPremium = !!(user && [user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.MAP_EDITOR].includes(user.role));
    if (!isPremium && (result.status === 'Draft' || result.status === 'Pending')) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
    }
    const accessibleMapIds = await (0, mapAccessHelper_1.getAccessibleMapIds)(user);
    const mapId = ((_a = result.map) === null || _a === void 0 ? void 0 : _a._id) || result.map;
    if (mapId) {
        const isLocked = !accessibleMapIds.includes(mapId.toString());
        if (!isPremium && isLocked) {
            if (result.type !== 'Business') {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'This information and these benefits can be unlocked by purchasing your favorite map.');
            }
        }
    }
    const placeObj = typeof result.toObject === 'function' ? result.toObject() : result;
    const isLocked = mapId && !accessibleMapIds.includes(mapId.toString()) && result.type !== 'Business';
    placeObj.isLocked = !isPremium && !!isLocked;
    placeObj.isVisited = !!(user && (user.visitedPlaces || []).some((vId) => vId.toString() === result._id.toString()));
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Place retrieved successfully',
        data: (0, localize_1.localizeDocument)(placeObj, req.lang, placeFields),
    });
});
const updatePlace = (0, catchAsync_1.default)(async (req, res) => {
    var _a;
    const { id } = req.params;
    const user = await (0, mapAccessHelper_1.getUserFromToken)(req.headers.authorization);
    const existingPlace = await place_service_1.PlaceService.getPlaceById(id);
    if (!existingPlace) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
    }
    // A place must belong to a map, verify access to the existing map
    const mapId = ((_a = existingPlace.map) === null || _a === void 0 ? void 0 : _a._id) || existingPlace.map;
    if (mapId) {
        await (0, mapAccessHelper_1.verifyEditorEditAccess)(user, mapId.toString());
    }
    // If they are moving the place to a new map, verify access to the new map too
    if (req.body.map && req.body.map !== (mapId === null || mapId === void 0 ? void 0 : mapId.toString())) {
        await (0, mapAccessHelper_1.verifyEditorEditAccess)(user, req.body.map);
    }
    const uploadedImages = (0, media_1.toStringArray)(req.body.images);
    const uploadedDocs = (0, media_1.toStringArray)(req.body.documents);
    if (uploadedImages.length || req.body.media) {
        req.body.media = [
            ...(0, media_1.toStringArray)(req.body.media),
            ...uploadedImages,
        ];
    }
    if (uploadedDocs.length || req.body.menuImages) {
        req.body.menuImages = [
            ...(0, media_1.toStringArray)(req.body.menuImages),
            ...uploadedDocs,
        ];
    }
    const result = await place_service_1.PlaceService.updatePlace(id, req.body);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Place updated successfully',
        data: (0, localize_1.localizeDocument)(result, req.lang, placeFields),
    });
});
const deletePlace = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await place_service_1.PlaceService.deletePlace(id);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Place deleted successfully',
        data: result,
    });
});
const incrementOpenCount = (0, catchAsync_1.default)(async (req, res) => {
    const result = await place_service_1.PlaceService.incrementOpenCount(req.params.id);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Place view recorded',
        data: { openCount: result.openCount || 0 },
    });
});
const extractCoordinates = (0, catchAsync_1.default)(async (req, res) => {
    const { url } = req.body;
    if (!url) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Google Maps URL is required');
    }
    const coordinates = await (0, mapHelper_1.getCoordinatesFromUrl)(url);
    if (!coordinates) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Could not extract coordinates. Try using the full URL from your browser address bar.');
    }
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Coordinates extracted successfully',
        data: coordinates,
    });
});
const recommendPlace = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'Authentication required');
    }
    const uploadedImages = (0, media_1.toStringArray)(req.body.images);
    const uploadedDocs = (0, media_1.toStringArray)(req.body.documents);
    if (uploadedImages.length || req.body.media) {
        req.body.media = [
            ...(0, media_1.toStringArray)(req.body.media),
            ...uploadedImages,
        ];
    }
    if (uploadedDocs.length || req.body.menuImages) {
        req.body.menuImages = [
            ...(0, media_1.toStringArray)(req.body.menuImages),
            ...uploadedDocs,
        ];
    }
    const result = await place_service_1.PlaceService.recommendPlace(user, req.body);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.CREATED,
        success: true,
        message: 'Tourist spot recommended successfully. It will be reviewed by our team.',
        data: (0, localize_1.localizeDocument)(result, req.lang, placeFields),
    });
});
const reviewRecommendedPlace = (0, catchAsync_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await place_service_1.PlaceService.reviewRecommendedPlace(id, req.body);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: `Tourist spot recommendation ${req.body.status.toLowerCase()} successfully`,
        data: (0, localize_1.localizeDocument)(result, req.lang, placeFields),
    });
});
const getMyRecommendations = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'Authentication required');
    }
    const paginationOptions = (0, pick_1.default)(req.query, ['page', 'limit', 'sortBy', 'sortOrder']);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const userId = user.authId || user._id || user.id;
    const result = await place_service_1.PlaceService.getMyRecommendations(userId, paginationOptions, status);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'User recommendations retrieved successfully',
        meta: result.meta,
        data: (0, localize_1.localizeDocument)(result.data, req.lang, placeFields),
    });
});
exports.PlaceController = {
    createPlace,
    getAllPlaces,
    getPlaceById,
    updatePlace,
    deletePlace,
    incrementOpenCount,
    extractCoordinates,
    recommendPlace,
    reviewRecommendedPlace,
    getMyRecommendations,
};
