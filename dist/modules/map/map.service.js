"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapService = void 0;
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const map_model_1 = require("./map.model");
const QueryBuilder_1 = __importDefault(require("../../builder/QueryBuilder"));
const user_model_1 = require("../user/user.model");
const place_model_1 = require("../place/place.model");
const business_model_1 = require("../business/business.model");
const mongoose_1 = __importDefault(require("mongoose"));
const map_constants_1 = require("./map.constants");
const place_constants_1 = require("../place/place.constants");
const business_constants_1 = require("../business/business.constants");
const autoTranslate_1 = require("../../utils/autoTranslate");
const notification_integration_1 = require("../notification/notification.integration");
const processMapTranslations = async (payload) => {
    if (payload.name) {
        if (typeof payload.name === 'string') {
            const trimmed = payload.name.trim();
            payload.name = { en: trimmed, es: trimmed };
        }
        else if (typeof payload.name === 'object' && payload.name !== null) {
            const enVal = (payload.name.en || '').trim();
            const esVal = (payload.name.es || '').trim();
            const fallback = enVal || esVal || '';
            payload.name = { en: enVal || fallback, es: esVal || fallback };
        }
    }
    if (payload.description)
        payload.description = await (0, autoTranslate_1.autoTranslateField)(payload.description);
};
const createMap = async (payload) => {
    await processMapTranslations(payload);
    const result = await map_model_1.Map.create(payload);
    if (result.status === 'Published' || result.isActive) {
        notification_integration_1.NotificationIntegration.onNewMap(result).catch(err => console.error('Failed to notify new map:', err));
    }
    return result;
};
const getAllMaps = async (query) => {
    let mapIds = [];
    // If category filter is provided, find maps that contain places with those categories
    if (query.category) {
        const categoryIds = query.category.split(',');
        const places = await place_model_1.Place.find({
            category: { $in: categoryIds },
        }).select('map');
        mapIds = places.map(place => place.map);
        // If no places found for these categories, we should return no maps
        if (mapIds.length === 0) {
            return {
                meta: {
                    page: Number(query.page) || 1,
                    limit: Number(query.limit) || 10,
                    total: 0,
                    totalPage: 0,
                },
                data: [],
            };
        }
        // Add map ID filtering to the query
        query._id = { $in: mapIds };
        delete query.category; // Remove category from query as it's not a field in Map model
    }
    // Select only the fields needed for the list view — do NOT populate places (it's huge)
    // rating and totalReview are stored on the Map document itself and updated by review hooks
    const mapQuery = new QueryBuilder_1.default(map_model_1.Map.find().select('-places'), query)
        .search(map_constants_1.mapSearchableFields)
        .filter()
        .sort()
        .paginate()
        .fields();
    const result = await mapQuery.modelQuery;
    const meta = await mapQuery.getPaginationInfo();
    // Fetch only the place counts for these maps in a single aggregation (no full populate)
    const fetchedMapIds = result.map((m) => m._id);
    const placeCounts = await place_model_1.Place.aggregate([
        { $match: { map: { $in: fetchedMapIds }, status: 'Published' } },
        { $group: { _id: '$map', count: { $sum: 1 } } },
    ]);
    const placeCountMap = {};
    placeCounts.forEach((pc) => { placeCountMap[pc._id.toString()] = pc.count; });
    const populatedData = result.map((map) => {
        const mapObj = typeof map.toObject === 'function' ? map.toObject() : map;
        mapObj.placeCount = placeCountMap[mapObj._id.toString()] || 0;
        return mapObj;
    });
    return {
        meta,
        data: populatedData,
    };
};
const getMapById = async (id) => {
    // Catalog / purchase UI only needs map summary — places come from discovery
    const result = await map_model_1.Map.findById(id).select('-places').lean();
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found');
    }
    return result;
};
const incrementViewCount = async (id) => {
    const result = await map_model_1.Map.findByIdAndUpdate(id, { $inc: { viewCount: 1 } }, { new: true }).select('name viewCount');
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found');
    }
    return result;
};
const updateMap = async (id, payload) => {
    const isExist = await map_model_1.Map.findById(id);
    if (!isExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found');
    }
    await processMapTranslations(payload);
    const result = await map_model_1.Map.findByIdAndUpdate(id, payload, {
        new: true,
        runValidators: true,
    });
    if (isExist.status !== 'Published' &&
        result &&
        (result.status === 'Published' || (payload.isActive === true && !isExist.isActive))) {
        notification_integration_1.NotificationIntegration.onNewMap(result).catch(err => console.error('Failed to notify new map:', err));
    }
    return result;
};
const deleteMap = async (id) => {
    const isExist = await map_model_1.Map.findById(id);
    if (!isExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found');
    }
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        // 1. Delete the Map
        const result = await map_model_1.Map.findByIdAndDelete(id).session(session);
        // 2. Delete all Places associated with this Map
        await place_model_1.Place.deleteMany({ map: id }).session(session);
        // 3. Remove this map from all users' purchased list
        await user_model_1.User.updateMany({ purchasedMaps: id }, { $pull: { purchasedMaps: id } }, { session });
        await session.commitTransaction();
        return result;
    }
    catch (error) {
        await session.abortTransaction();
        throw error;
    }
    finally {
        session.endSession();
    }
};
const purchaseMap = async (userId, mapId) => {
    var _a;
    const isMapExist = await map_model_1.Map.findById(mapId);
    if (!isMapExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found');
    }
    // Paid maps are unlocked only via Stripe checkout / award redeem — not this route
    if (isMapExist.isPaid) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Paid maps must be purchased through checkout');
    }
    const user = await user_model_1.User.findById(userId);
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found');
    }
    // Check if already purchased
    const alreadyPurchased = (_a = user.purchasedMaps) === null || _a === void 0 ? void 0 : _a.some(id => id.toString() === mapId);
    if (alreadyPurchased) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Map already purchased');
    }
    const result = await user_model_1.User.findByIdAndUpdate(userId, { $push: { purchasedMaps: mapId } }, { new: true });
    return result;
};
const getPurchasedMaps = async (userId) => {
    const user = await user_model_1.User.findById(userId)
        .select('purchasedMaps')
        .populate({
        path: 'purchasedMaps',
        select: 'name country images isActive isPaid price rating totalReview createdAt description',
    })
        .lean();
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found');
    }
    return user.purchasedMaps || [];
};
const getAvailableCountries = async () => {
    const placeCountries = await place_model_1.Place.distinct('country', { status: 'Published' });
    const mapCountries = await map_model_1.Map.distinct('country');
    const combined = Array.from(new Set([...placeCountries, ...mapCountries]));
    return combined.filter((country) => typeof country === 'string' && country !== 'Unknown' && country.trim() !== '');
};
// Marker/list preview fields — includes media & description for instant, smooth location dialog previews, plus createdAt for newly added locations
const DISCOVERY_PLACE_FIELDS = 'name type status category map country address rating totalReview location media description entryCost hikeTime difficulty atmosphere schedules createdAt';
const DISCOVERY_BUSINESS_FIELDS = 'name status category location rating totalReview hasActiveSubscription media description createdAt';
const DISCOVERY_MAX_FETCH = 2000;
const getDiscoveryData = async (query, lockedMapIds, isAdminOrEditor = false, preloadedMapObj) => {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    // Prepare separate queries because Place and Business have different schemas
    const placeQueryObj = { ...query };
    // Business has its own status vocabulary (Approved/Pending/Rejected) — never inherit the Place status from query
    const { status: _ignoredStatus, ...businessQueryObjBase } = query;
    const businessQueryObj = { ...businessQueryObjBase };
    // 1. Handle "map" filter (Only applicable for Places, map businesses by their country)
    if (businessQueryObj.map) {
        const mapObj = preloadedMapObj ||
            (await map_model_1.Map.findById(businessQueryObj.map).select('name country').lean());
        if (mapObj) {
            businessQueryObj['location.country'] = mapObj.country || mapObj.name;
        }
        delete businessQueryObj.map;
    }
    // 2. Handle "country" filter (Business uses location.country)
    if (businessQueryObj.country) {
        businessQueryObj['location.country'] = businessQueryObj.country;
        delete businessQueryObj.country;
    }
    // 3. Always set status independently for Place and Business
    if (!isAdminOrEditor) {
        placeQueryObj.status = 'Published';
        businessQueryObj.status = 'Approved';
    }
    else {
        if (!placeQueryObj.status) {
            placeQueryObj.status = { $in: ['Draft', 'Published'] };
        }
        if (!businessQueryObj.status) {
            businessQueryObj.status = { $in: ['Pending', 'Approved', 'Rejected'] };
        }
    }
    // 4. Enforce that businesses must have an active subscription to show on the map
    if (!isAdminOrEditor) {
        businessQueryObj.hasActiveSubscription = true;
    }
    // Marker/list fields only — detail (media/hours/privateInfo) comes from place/business by id
    const placeQuery = new QueryBuilder_1.default(place_model_1.Place.find()
        .select(DISCOVERY_PLACE_FIELDS)
        .populate('category', 'name color icon status')
        .lean(), placeQueryObj)
        .search(place_constants_1.placeSearchableFields)
        .filter();
    if (query.sort) {
        placeQuery.sort();
    }
    const businessQuery = new QueryBuilder_1.default(business_model_1.Business.find()
        .select(DISCOVERY_BUSINESS_FIELDS)
        .populate('category', 'name color icon status')
        .lean(), businessQueryObj)
        .search(business_constants_1.businessSearchableFields)
        .filter();
    if (query.sort) {
        businessQuery.sort();
    }
    // Honor requested limit (maps page uses ~1000); cap to avoid unbounded scans
    const fetchLimit = Math.min(Math.max(limit, 1), DISCOVERY_MAX_FETCH);
    placeQuery.modelQuery.limit(fetchLimit);
    businessQuery.modelQuery.limit(fetchLimit);
    const [places, businesses] = await Promise.all([
        placeQuery.modelQuery,
        businessQuery.modelQuery,
    ]);
    // Map to include type and isLocked.
    // Keep original Place.type (Business|Regular) as placeType — `type` is overwritten
    // to 'place' so the client can tell Place vs Business collection entities apart.
    const formattedPlaces = places.map(place => {
        var _a;
        const mapId = ((_a = place.map) === null || _a === void 0 ? void 0 : _a._id) || place.map;
        const isLocked = mapId && lockedMapIds && lockedMapIds.includes(mapId.toString()) && place.type !== 'Business';
        return {
            ...place,
            ...(isLocked ? { entryCost: undefined, hikeTime: undefined, difficulty: undefined, atmosphere: undefined, schedules: undefined } : {}),
            media: Array.isArray(place.media) ? place.media.filter(Boolean) : [],
            placeType: place.type,
            type: 'place',
            isLocked: !!isLocked,
        };
    });
    const formattedBusinesses = businesses.map(business => {
        var _a, _b, _c, _d, _e;
        const rawPhotos = ((_a = business.media) === null || _a === void 0 ? void 0 : _a.photos) || [];
        return {
            ...business,
            type: 'business',
            placeType: 'Business',
            media: Array.isArray(rawPhotos) ? rawPhotos.filter(Boolean) : [],
            description: business.description || '',
            location: {
                ...(business.location || {}),
                type: 'Point',
                coordinates: ((_c = (_b = business.location) === null || _b === void 0 ? void 0 : _b.mapLocation) === null || _c === void 0 ? void 0 : _c.coordinates) || [],
            },
            address: ((_d = business.location) === null || _d === void 0 ? void 0 : _d.address) || '',
            country: ((_e = business.location) === null || _e === void 0 ? void 0 : _e.country) || '',
        };
    });
    // Deduplicate and combine results (Issue 6: Prevent duplicate location records like Bai Picnic)
    const getAllNormalizedNames = (item) => {
        const names = [];
        const norm = (s) => String(s || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
        if (typeof (item === null || item === void 0 ? void 0 : item.name) === 'string') {
            names.push(norm(item.name));
        }
        else if ((item === null || item === void 0 ? void 0 : item.name) && typeof item.name === 'object') {
            if (item.name.en)
                names.push(norm(item.name.en));
            if (item.name.es)
                names.push(norm(item.name.es));
            for (const val of Object.values(item.name)) {
                if (typeof val === 'string')
                    names.push(norm(val));
            }
        }
        return Array.from(new Set(names.filter(Boolean)));
    };
    const getCoordsKey = (item) => {
        var _a, _b, _c;
        const coords = ((_a = item === null || item === void 0 ? void 0 : item.location) === null || _a === void 0 ? void 0 : _a.coordinates) ||
            ((_c = (_b = item === null || item === void 0 ? void 0 : item.location) === null || _b === void 0 ? void 0 : _b.mapLocation) === null || _c === void 0 ? void 0 : _c.coordinates) ||
            (item === null || item === void 0 ? void 0 : item.coordinates);
        if (Array.isArray(coords) && coords.length >= 2) {
            const lng = Number(coords[0]);
            const lat = Number(coords[1]);
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
                return `${lng.toFixed(4)},${lat.toFixed(4)}`;
            }
        }
        return null;
    };
    const businessNameSet = new Set();
    const businessCoordSet = new Set();
    const deduplicatedBusinesses = [];
    for (const b of formattedBusinesses) {
        const bNames = getAllNormalizedNames(b);
        const coordKey = getCoordsKey(b);
        if (bNames.some(n => businessNameSet.has(n)))
            continue;
        if (coordKey && businessCoordSet.has(coordKey) && bNames.length > 0)
            continue;
        bNames.forEach(n => businessNameSet.add(n));
        if (coordKey)
            businessCoordSet.add(coordKey);
        deduplicatedBusinesses.push(b);
    }
    const placeNameSet = new Set();
    const placeCoordSet = new Set();
    const deduplicatedPlaces = [];
    for (const p of formattedPlaces) {
        const pNames = getAllNormalizedNames(p);
        const coordKey = getCoordsKey(p);
        // Check if this place matches an existing registered Business (by name or coords + similarity)
        const matchesBusinessByName = pNames.some(n => businessNameSet.has(n));
        const matchesBusinessByCoord = Boolean(coordKey &&
            businessCoordSet.has(coordKey) &&
            deduplicatedBusinesses.some(b => {
                const bNames = getAllNormalizedNames(b);
                return bNames.some(bn => pNames.some(pn => pn.includes(bn) || bn.includes(pn)));
            }));
        if (matchesBusinessByName || matchesBusinessByCoord) {
            const matchingBusiness = deduplicatedBusinesses.find(b => {
                const bNames = getAllNormalizedNames(b);
                return (bNames.some(bn => pNames.includes(bn)) ||
                    (coordKey && getCoordsKey(b) === coordKey));
            });
            if (matchingBusiness) {
                if (!matchingBusiness.category && p.category)
                    matchingBusiness.category = p.category;
                if (!matchingBusiness.map && p.map)
                    matchingBusiness.map = p.map;
            }
            continue;
        }
        if (pNames.some(n => placeNameSet.has(n)))
            continue;
        if (coordKey && placeCoordSet.has(coordKey) && pNames.length > 0)
            continue;
        pNames.forEach(n => placeNameSet.add(n));
        if (coordKey)
            placeCoordSet.add(coordKey);
        deduplicatedPlaces.push(p);
    }
    let result = [...deduplicatedPlaces, ...deduplicatedBusinesses];
    // If there's a searchTerm, we might want to sort by relevance or alphabetically
    if (query.searchTerm) {
        result.sort((a, b) => a.name.localeCompare(b.name));
    }
    else if (query.sort) {
        // Basic sorting on combined results if needed
        const isDesc = query.sort.startsWith('-');
        const sortField = query.sort.replace('-', '');
        result.sort((a, b) => {
            if (a[sortField] < b[sortField])
                return isDesc ? 1 : -1;
            if (a[sortField] > b[sortField])
                return isDesc ? -1 : 1;
            return 0;
        });
    }
    // Apply pagination on the combined data
    const total = result.length;
    const totalPage = Math.ceil(total / limit);
    const skip = (page - 1) * limit;
    result = result.slice(skip, skip + limit);
    return {
        meta: {
            page,
            limit,
            total,
            totalPage,
        },
        data: result,
    };
};
exports.MapService = {
    createMap,
    getAllMaps,
    getMapById,
    incrementViewCount,
    updateMap,
    deleteMap,
    purchaseMap,
    getPurchasedMaps,
    getAvailableCountries,
    getDiscoveryData,
};
