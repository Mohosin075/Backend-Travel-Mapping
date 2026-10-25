"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoutePlanService = void 0;
const http_status_codes_1 = require("http-status-codes");
const mongoose_1 = __importDefault(require("mongoose"));
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const route_plan_model_1 = require("./route-plan.model");
const place_model_1 = require("../place/place.model");
const business_model_1 = require("../business/business.model");
const user_model_1 = require("../user/user.model");
const map_model_1 = require("../map/map.model");
/**
 * Normalizes stops before saving:
 * - Checks whether ID belongs to Place or Business
 * - Preserves existing subdocument _id if present
 * - Ensures valid order index
 * - Restricts tourist attractions to purchased/free maps for normal users
 */
const normalizeStops = async (rawStops, userId) => {
    if (!Array.isArray(rawStops))
        return [];
    let userRole;
    let purchasedMaps = [];
    if (userId && mongoose_1.default.Types.ObjectId.isValid(userId)) {
        const userDoc = await user_model_1.User.findById(userId).select('role purchasedMaps');
        if (userDoc) {
            userRole = userDoc.role;
            purchasedMaps = (userDoc.purchasedMaps || []).map((m) => m.toString());
        }
    }
    const isAdminOrEditor = ['super_admin', 'admin', 'map_editor'].includes(userRole || '');
    const formattedStops = [];
    for (let index = 0; index < rawStops.length; index++) {
        const item = rawStops[index];
        const targetId = item.place || item.business || item.placeId || item.id;
        if (!targetId || !mongoose_1.default.Types.ObjectId.isValid(targetId)) {
            continue;
        }
        let type = item.type || 'Place';
        let placeId = undefined;
        let businessId = undefined;
        // Verify existence in Place or Business collections
        const placeDoc = await place_model_1.Place.findById(targetId).select('_id type map');
        if (placeDoc) {
            placeId = placeDoc._id;
            type = placeDoc.type === 'Business' ? 'Business' : 'Place';
            // Restrict tourist attractions: non-business places require purchased or free map
            if (type === 'Place' && !isAdminOrEditor) {
                if (placeDoc.map) {
                    const mapDoc = await map_model_1.Map.findById(placeDoc.map).select('isPaid');
                    const isPaid = mapDoc ? mapDoc.isPaid !== false : true;
                    const hasPurchased = purchasedMaps.includes(placeDoc.map.toString());
                    if (isPaid && !hasPurchased) {
                        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Restricted tourist attraction. You must purchase the corresponding map to add this place to your route plan.');
                    }
                }
            }
        }
        else {
            const businessDoc = await business_model_1.Business.findById(targetId).select('_id');
            if (businessDoc) {
                businessId = businessDoc._id;
                type = 'Business';
            }
            else {
                // Fallback: keep targetId as place reference
                placeId = new mongoose_1.default.Types.ObjectId(targetId);
            }
        }
        const stopObj = {
            place: placeId,
            business: businessId,
            type,
            order: typeof item.order === 'number' ? item.order : index + 1,
            note: item.note || '',
        };
        // Preserve existing subdocument _id if valid
        if (item._id && mongoose_1.default.Types.ObjectId.isValid(item._id)) {
            stopObj._id = new mongoose_1.default.Types.ObjectId(item._id);
        }
        formattedStops.push(stopObj);
    }
    // Sort by order ascending
    formattedStops.sort((a, b) => a.order - b.order);
    return formattedStops;
};
const populateRoutePlan = (query) => {
    return query
        .populate({
        path: 'stops.place',
        select: 'name media address location category type rating totalReview country access entryCost',
        populate: {
            path: 'category',
            select: 'name icon',
        },
    })
        .populate({
        path: 'stops.business',
        select: 'name media location category contact',
        populate: {
            path: 'category',
            select: 'name icon',
        },
    });
};
const createRoutePlan = async (userId, payload) => {
    var _a;
    if (!userId || !mongoose_1.default.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID');
    }
    const stops = payload.stops ? await normalizeStops(payload.stops, userId) : [];
    const newRoute = await route_plan_model_1.RoutePlan.create({
        user: new mongoose_1.default.Types.ObjectId(userId),
        name: payload.name || 'Mi Roadtrip',
        description: payload.description || '',
        stops,
        isPublic: (_a = payload.isPublic) !== null && _a !== void 0 ? _a : false,
    });
    const populated = await populateRoutePlan(route_plan_model_1.RoutePlan.findById(newRoute._id));
    return populated;
};
const getMyRoutePlans = async (userId, query) => {
    if (!userId || !mongoose_1.default.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID');
    }
    const { page = 1, limit = 20, sort = '-updatedAt', searchTerm } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter = {
        user: new mongoose_1.default.Types.ObjectId(userId),
    };
    if (searchTerm && typeof searchTerm === 'string') {
        filter.name = { $regex: searchTerm.trim(), $options: 'i' };
    }
    const [data, total] = await Promise.all([
        populateRoutePlan(route_plan_model_1.RoutePlan.find(filter)
            .sort(sort)
            .skip(skip)
            .limit(Number(limit))).lean(),
        route_plan_model_1.RoutePlan.countDocuments(filter),
    ]);
    // Ensure stops inside each route are sorted by order
    data.forEach((route) => {
        if (Array.isArray(route.stops)) {
            route.stops.sort((a, b) => (a.order || 0) - (b.order || 0));
        }
    });
    const totalPage = Math.ceil(total / Number(limit));
    return {
        meta: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPage,
        },
        data,
    };
};
const getRoutePlanById = async (id, userId, userRole) => {
    if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Route ID');
    }
    const routePlan = await populateRoutePlan(route_plan_model_1.RoutePlan.findById(id));
    if (!routePlan) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Route plan not found');
    }
    const isOwner = routePlan.user.toString() === userId;
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';
    // Allow access if owner, public, or admin
    if (!isOwner && !routePlan.isPublic && !isAdmin) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You do not have permission to view this route plan');
    }
    if (Array.isArray(routePlan.stops)) {
        routePlan.stops.sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    return routePlan;
};
const updateRoutePlan = async (id, userId, payload) => {
    if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Route ID');
    }
    const existingRoute = await route_plan_model_1.RoutePlan.findOne({
        _id: id,
        user: userId,
    });
    if (!existingRoute) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Route plan not found or you are not authorized to update it');
    }
    const updateFields = {};
    if (payload.name !== undefined)
        updateFields.name = payload.name;
    if (payload.description !== undefined)
        updateFields.description = payload.description;
    if (payload.isPublic !== undefined)
        updateFields.isPublic = payload.isPublic;
    if (payload.stops !== undefined) {
        updateFields.stops = await normalizeStops(payload.stops, userId);
    }
    const updated = await populateRoutePlan(route_plan_model_1.RoutePlan.findByIdAndUpdate(id, { $set: updateFields }, { new: true }));
    if (updated && Array.isArray(updated.stops)) {
        updated.stops.sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    return updated;
};
const deleteRoutePlan = async (id, userId) => {
    if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Route ID');
    }
    const result = await route_plan_model_1.RoutePlan.findOneAndDelete({
        _id: id,
        user: userId,
    });
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Route plan not found or already deleted');
    }
    return result;
};
const clearRouteStops = async (id, userId) => {
    if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Route ID');
    }
    const result = await route_plan_model_1.RoutePlan.findOneAndUpdate({ _id: id, user: userId }, { $set: { stops: [] } }, { new: true });
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Route plan not found');
    }
    return result;
};
const addStop = async (id, userId, stopData) => {
    if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Route ID');
    }
    const routePlan = await route_plan_model_1.RoutePlan.findOne({ _id: id, user: userId });
    if (!routePlan) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Route plan not found');
    }
    const normalized = await normalizeStops([
        {
            ...stopData,
            order: typeof stopData.order === 'number'
                ? stopData.order
                : routePlan.stops.length + 1,
        },
    ], userId);
    if (!normalized.length) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid place ID');
    }
    routePlan.stops.push(normalized[0]);
    routePlan.stops.sort((a, b) => a.order - b.order);
    await routePlan.save();
    const populated = await populateRoutePlan(route_plan_model_1.RoutePlan.findById(routePlan._id));
    return populated;
};
const removeStop = async (id, stopId, userId) => {
    if (!mongoose_1.default.Types.ObjectId.isValid(id) ||
        !mongoose_1.default.Types.ObjectId.isValid(stopId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid ID');
    }
    const routePlan = await route_plan_model_1.RoutePlan.findOne({ _id: id, user: userId });
    if (!routePlan) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Route plan not found');
    }
    // Supports removing by subdoc _id, place id, or business id
    routePlan.stops = routePlan.stops.filter((s) => {
        var _a, _b, _c, _d, _e;
        const subdocId = (_a = s._id) === null || _a === void 0 ? void 0 : _a.toString();
        const placeRef = ((_b = s.place) === null || _b === void 0 ? void 0 : _b._id) ? s.place._id.toString() : (_c = s.place) === null || _c === void 0 ? void 0 : _c.toString();
        const businessRef = ((_d = s.business) === null || _d === void 0 ? void 0 : _d._id)
            ? s.business._id.toString()
            : (_e = s.business) === null || _e === void 0 ? void 0 : _e.toString();
        return (subdocId !== stopId && placeRef !== stopId && businessRef !== stopId);
    });
    // Re-index remaining stops sequentially: 1, 2, 3...
    routePlan.stops.forEach((s, idx) => {
        s.order = idx + 1;
    });
    await routePlan.save();
    const populated = await populateRoutePlan(route_plan_model_1.RoutePlan.findById(routePlan._id));
    return populated;
};
exports.RoutePlanService = {
    createRoutePlan,
    getMyRoutePlans,
    getRoutePlanById,
    updateRoutePlan,
    deleteRoutePlan,
    clearRouteStops,
    addStop,
    removeStop,
};
