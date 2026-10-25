"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfferService = exports.getOfferRecurrenceWindowMs = void 0;
const mongoose_1 = require("mongoose");
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const offer_model_1 = require("./offer.model");
const offerRedemption_model_1 = require("./offerRedemption.model");
const dateHelper_1 = require("../../helpers/dateHelper");
const QueryBuilder_1 = __importDefault(require("../../builder/QueryBuilder"));
const offer_1 = require("../../enum/offer");
const business_model_1 = require("../business/business.model");
const place_model_1 = require("../place/place.model");
const autoTranslate_1 = require("../../utils/autoTranslate");
const mapAccessHelper_1 = require("../../helpers/mapAccessHelper");
const user_1 = require("../../enum/user");
const notification_integration_1 = require("../notification/notification.integration");
const processOfferTranslations = async (payload) => {
    if (payload.title)
        payload.title = await (0, autoTranslate_1.autoTranslateField)(payload.title);
    if (payload.description)
        payload.description = await (0, autoTranslate_1.autoTranslateField)(payload.description);
    if (payload.buttonLabel)
        payload.buttonLabel = await (0, autoTranslate_1.autoTranslateField)(payload.buttonLabel);
};
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Strip paid-only fields from locked list items; keep teaser fields for cards. */
const sanitizeLockedOffer = (offer) => {
    const { description: _description, redemptionRules: _redemptionRules, ...safe } = offer;
    return {
        ...safe,
        description: undefined,
        redemptionRules: undefined,
        isLocked: true,
    };
};
const assertUserOwnsBusiness = async (user, businessId) => {
    var _a, _b, _c;
    if (!businessId) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'You can only manage offers for your own business');
    }
    const business = await business_model_1.Business.findById(businessId);
    if (!business) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Business not found');
    }
    const ownerId = ((_b = (_a = business.user) === null || _a === void 0 ? void 0 : _a._id) === null || _b === void 0 ? void 0 : _b.toString()) || ((_c = business.user) === null || _c === void 0 ? void 0 : _c.toString());
    if (ownerId !== user._id.toString()) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You can only manage offers for your own business');
    }
    return business;
};
const createOffer = async (payload, authHeader) => {
    var _a, _b;
    const { images, ...offerData } = payload;
    const user = await (0, mapAccessHelper_1.getUserFromToken)(authHeader);
    if (user && user.role === user_1.USER_ROLES.USER) {
        await assertUserOwnsBusiness(user, offerData.business);
        delete offerData.place;
    }
    // Verify access for Map Editors
    if (user && user.role === user_1.USER_ROLES.MAP_EDITOR) {
        if (offerData.place) {
            const place = await place_model_1.Place.findById(offerData.place);
            if (!place)
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
            const mapId = ((_a = place.map) === null || _a === void 0 ? void 0 : _a._id) || place.map;
            if (mapId) {
                await (0, mapAccessHelper_1.verifyEditorEditAccess)(user, mapId.toString());
            }
        }
        else if (offerData.business) {
            const business = await business_model_1.Business.findById(offerData.business);
            if (!business)
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Business not found');
            await (0, mapAccessHelper_1.verifyEditorBusinessAccess)(user, (_b = business.location) === null || _b === void 0 ? void 0 : _b.country);
        }
    }
    // Handle image upload from disk storage
    if (images) {
        offerData.photo = Array.isArray(images) ? images[0] : images;
    }
    await processOfferTranslations(offerData);
    if (offerData.discountType === offer_1.DISCOUNT_TYPE.BOGO && !offerData.bogoSecondType) {
        offerData.bogoSecondType = offer_1.BOGO_SECOND_TYPE.FREE;
    }
    const status = offerData.status || offer_1.OFFER_STATUS.ACTIVE;
    if (status === offer_1.OFFER_STATUS.ACTIVE && (offerData.place || offerData.business)) {
        const query = [];
        if (offerData.place)
            query.push({ place: offerData.place });
        if (offerData.business)
            query.push({ business: offerData.business });
        if (query.length > 0) {
            const existingActiveOffer = await offer_model_1.Offer.findOne({
                $or: query,
                status: offer_1.OFFER_STATUS.ACTIVE,
            });
            if (existingActiveOffer) {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'An active offer already exists for this place or business');
            }
        }
    }
    const result = await offer_model_1.Offer.create(offerData);
    if (result.status === offer_1.OFFER_STATUS.ACTIVE) {
        notification_integration_1.NotificationIntegration.onNewOffer(result).catch(err => console.error('Failed to dispatch new offer notification:', err));
    }
    return result;
};
const getAllOffers = async (query, authHeader) => {
    const queryObj = { ...query };
    // Extract custom query filters before QueryBuilder.filter() runs
    const country = typeof queryObj.country === 'string' ? queryObj.country.trim() : '';
    const searchTerm = typeof queryObj.searchTerm === 'string' ? queryObj.searchTerm.trim() : '';
    delete queryObj.country;
    delete queryObj.searchTerm;
    // Find all approved businesses with active subscriptions
    const activeBusinesses = await business_model_1.Business.find({
        status: 'Approved',
        hasActiveSubscription: true,
    }).select('_id').lean();
    const activeBusinessIds = activeBusinesses.map(b => b._id);
    // Filter offers: must either belong to a place or to an active/approved business
    const filterConditions = [
        {
            $or: [
                { place: { $exists: true, $ne: null } },
                { business: { $in: activeBusinessIds } },
            ],
        },
    ];
    // Filter by country if provided
    if (country) {
        const countryRegex = new RegExp(`^${escapeRegex(country)}$`, 'i');
        const [matchingPlaces, matchingBusinesses] = await Promise.all([
            place_model_1.Place.find({ country: countryRegex }).select('_id').lean(),
            business_model_1.Business.find({
                $or: [
                    { 'location.country': countryRegex },
                    { country: countryRegex },
                ],
            }).select('_id').lean(),
        ]);
        const placeIds = matchingPlaces.map(p => p._id);
        const businessIds = matchingBusinesses.map(b => b._id);
        filterConditions.push({
            $or: [
                { place: { $in: placeIds } },
                { business: { $in: businessIds } },
            ],
        });
    }
    // Search by offer title/description, place name/address/municipality/region, or business name/address/city
    if (searchTerm) {
        const searchRegex = new RegExp(escapeRegex(searchTerm), 'i');
        const [matchingPlaces, matchingBusinesses] = await Promise.all([
            place_model_1.Place.find({
                $or: [
                    { name: searchRegex },
                    { address: searchRegex },
                    { country: searchRegex },
                ],
            }).select('_id').lean(),
            business_model_1.Business.find({
                $or: [
                    { name: searchRegex },
                    { 'location.address': searchRegex },
                    { 'location.city': searchRegex },
                    { 'location.country': searchRegex },
                ],
            }).select('_id').lean(),
        ]);
        const placeIds = matchingPlaces.map(p => p._id);
        const businessIds = matchingBusinesses.map(b => b._id);
        const searchOr = [
            { title: searchRegex },
            { description: searchRegex },
        ];
        if (placeIds.length > 0) {
            searchOr.push({ place: { $in: placeIds } });
        }
        if (businessIds.length > 0) {
            searchOr.push({ business: { $in: businessIds } });
        }
        filterConditions.push({ $or: searchOr });
    }
    const finalFilter = filterConditions.length > 1
        ? { $and: filterConditions }
        : filterConditions[0];
    const offerQuery = new QueryBuilder_1.default(offer_model_1.Offer.find(finalFilter)
        .populate('business', 'name location media status category map country')
        .populate('place', 'name location media status category map country address')
        .lean(), queryObj)
        .filter()
        .sort()
        .paginate()
        .fields();
    // Concurrently run query, pagination, and user authentication
    const [user, rawData, meta] = await Promise.all([
        (0, mapAccessHelper_1.getUserFromToken)(authHeader),
        offerQuery.modelQuery,
        offerQuery.getPaginationInfo(),
    ]);
    const isPremium = user && ([user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.MAP_EDITOR].includes(user.role));
    const accessibleMapIds = await (0, mapAccessHelper_1.getAccessibleMapIds)(user);
    const countries = rawData
        .map((offer) => { var _a, _b, _c; return ((_b = (_a = offer.business) === null || _a === void 0 ? void 0 : _a.location) === null || _b === void 0 ? void 0 : _b.country) || ((_c = offer.business) === null || _c === void 0 ? void 0 : _c.country); })
        .filter(Boolean);
    const countryLookup = await (0, mapAccessHelper_1.buildCountryToMapIdLookup)(countries);
    const updatedData = rawData.map((offer) => {
        const placeMapId = (0, mapAccessHelper_1.resolveOfferMapId)(offer, countryLookup);
        const isLocked = !isPremium && (!placeMapId || !accessibleMapIds.includes(placeMapId));
        if (isLocked) {
            return sanitizeLockedOffer({ ...offer, isLocked: true });
        }
        return {
            ...offer,
            isLocked: false,
        };
    });
    return {
        meta,
        data: updatedData,
    };
};
const getOfferRecurrenceWindowMs = (offer) => {
    const freq = String((offer === null || offer === void 0 ? void 0 : offer.redemptionFrequency) || '').toLowerCase();
    if (freq === 'once')
        return null;
    if (freq === 'daily')
        return 24 * 60 * 60 * 1000;
    if (freq === 'weekly')
        return 7 * 24 * 60 * 60 * 1000;
    if (freq === 'monthly')
        return 30 * 24 * 60 * 60 * 1000;
    const duration = Number(offer === null || offer === void 0 ? void 0 : offer.redemptionDuration) || 0;
    if (duration >= 525600)
        return null; // 1 year / once
    if (duration === 1440)
        return 24 * 60 * 60 * 1000;
    if (duration === 10080)
        return 7 * 24 * 60 * 60 * 1000;
    if (duration === 43200)
        return 30 * 24 * 60 * 60 * 1000;
    if (duration > 0 && duration < 525600)
        return duration * 60 * 1000;
    return 24 * 60 * 60 * 1000; // Default to daily (24 hours) for recurring offers
};
exports.getOfferRecurrenceWindowMs = getOfferRecurrenceWindowMs;
const getOfferById = async (id, authHeader) => {
    const [user, rawResult] = await Promise.all([
        (0, mapAccessHelper_1.getUserFromToken)(authHeader),
        offer_model_1.Offer.findById(id)
            .populate('place', 'name location media status category map country address')
            .populate('business', 'name location media status category'),
    ]);
    if (!rawResult) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Offer not found');
    }
    const isPremium = user && ([user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.MAP_EDITOR].includes(user.role));
    if (!isPremium) {
        const accessibleMapIds = await (0, mapAccessHelper_1.getAccessibleMapIds)(user);
        const placeMapId = await (0, mapAccessHelper_1.resolveOfferMapIdAsync)(rawResult);
        if (!placeMapId || !accessibleMapIds.includes(placeMapId)) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'This information and these benefits can be unlocked by purchasing your favorite map.');
        }
    }
    let result = rawResult;
    if (user) {
        const recurrenceWindowMs = (0, exports.getOfferRecurrenceWindowMs)(rawResult);
        const redemptionFilter = {
            user: user._id,
            offer: id,
        };
        if (recurrenceWindowMs !== null) {
            const windowStart = new Date(Date.now() - recurrenceWindowMs);
            redemptionFilter.$or = [
                { createdAt: { $gte: windowStart } },
                { redemptionTime: { $gte: windowStart } },
            ];
        }
        const [activeRedemption, userRedemptionCount] = await Promise.all([
            offerRedemption_model_1.OfferRedemption.findOne({
                user: user._id,
                offer: id,
                expiresAt: { $gt: new Date() },
            }),
            offerRedemption_model_1.OfferRedemption.countDocuments(redemptionFilter),
        ]);
        let nextAvailableAt = null;
        const maxRedemptions = rawResult.maxRedemptions || 1;
        if (recurrenceWindowMs !== null && userRedemptionCount >= maxRedemptions) {
            const oldestInWindow = await offerRedemption_model_1.OfferRedemption.findOne(redemptionFilter).sort({
                createdAt: 1,
                redemptionTime: 1,
            });
            const oldestTime = (oldestInWindow === null || oldestInWindow === void 0 ? void 0 : oldestInWindow.createdAt) || (oldestInWindow === null || oldestInWindow === void 0 ? void 0 : oldestInWindow.redemptionTime);
            if (oldestTime) {
                nextAvailableAt = new Date(new Date(oldestTime).getTime() + recurrenceWindowMs);
            }
        }
        const offerObj = typeof result.toObject === 'function' ? result.toObject() : result;
        result = {
            ...offerObj,
            activeRedemption,
            userRedemptionCount,
            isRecurring: recurrenceWindowMs !== null,
            recurrenceWindowMs,
            nextAvailableAt,
        };
    }
    return result;
};
const updateOffer = async (id, payload, authHeader) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const existingOffer = await offer_model_1.Offer.findById(id);
    if (!existingOffer) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Offer not found');
    }
    const { images, ...offerData } = payload;
    const user = await (0, mapAccessHelper_1.getUserFromToken)(authHeader);
    // getOfferById / raw model populates place/business — always resolve raw ids
    const existingPlaceId = ((_b = (_a = existingOffer.place) === null || _a === void 0 ? void 0 : _a._id) === null || _b === void 0 ? void 0 : _b.toString()) ||
        ((_c = existingOffer.place) === null || _c === void 0 ? void 0 : _c.toString()) ||
        null;
    const existingBusinessId = ((_e = (_d = existingOffer.business) === null || _d === void 0 ? void 0 : _d._id) === null || _e === void 0 ? void 0 : _e.toString()) ||
        ((_f = existingOffer.business) === null || _f === void 0 ? void 0 : _f.toString()) ||
        null;
    if (user && user.role === user_1.USER_ROLES.USER) {
        await assertUserOwnsBusiness(user, existingBusinessId || offerData.business);
        delete offerData.business;
        delete offerData.place;
    }
    if (user && user.role === user_1.USER_ROLES.MAP_EDITOR) {
        // Check existing offer's place/business
        if (existingPlaceId) {
            const place = await place_model_1.Place.findById(existingPlaceId);
            if (place) {
                const mapId = ((_g = place.map) === null || _g === void 0 ? void 0 : _g._id) || place.map;
                if (mapId) {
                    await (0, mapAccessHelper_1.verifyEditorEditAccess)(user, mapId.toString());
                }
            }
        }
        else if (existingBusinessId) {
            const business = await business_model_1.Business.findById(existingBusinessId);
            if (business) {
                await (0, mapAccessHelper_1.verifyEditorBusinessAccess)(user, (_h = business.location) === null || _h === void 0 ? void 0 : _h.country);
            }
        }
        // Check new place/business if they are being updated
        if (offerData.place && offerData.place !== existingPlaceId) {
            const place = await place_model_1.Place.findById(offerData.place);
            if (place) {
                const mapId = ((_j = place.map) === null || _j === void 0 ? void 0 : _j._id) || place.map;
                if (mapId) {
                    await (0, mapAccessHelper_1.verifyEditorEditAccess)(user, mapId.toString());
                }
            }
        }
        else if (offerData.business && offerData.business !== existingBusinessId) {
            const business = await business_model_1.Business.findById(offerData.business);
            if (business) {
                await (0, mapAccessHelper_1.verifyEditorBusinessAccess)(user, (_k = business.location) === null || _k === void 0 ? void 0 : _k.country);
            }
        }
    }
    // Handle image upload from disk storage
    if (images) {
        offerData.photo = Array.isArray(images) ? images[0] : images;
    }
    await processOfferTranslations(offerData);
    const targetStatus = offerData.status || existingOffer.status;
    const targetPlace = offerData.place || existingOffer.place;
    const targetBusiness = offerData.business || existingOffer.business;
    if (offerData.discountType === offer_1.DISCOUNT_TYPE.BOGO && !offerData.bogoSecondType) {
        offerData.bogoSecondType = existingOffer.bogoSecondType || offer_1.BOGO_SECOND_TYPE.FREE;
    }
    if (targetStatus === offer_1.OFFER_STATUS.ACTIVE && (targetPlace || targetBusiness)) {
        const query = [];
        if (targetPlace)
            query.push({ place: targetPlace });
        if (targetBusiness)
            query.push({ business: targetBusiness });
        if (query.length > 0) {
            const existingActiveOffer = await offer_model_1.Offer.findOne({
                _id: { $ne: id },
                $or: query,
                status: offer_1.OFFER_STATUS.ACTIVE,
            });
            if (existingActiveOffer) {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'An active offer already exists for this place or business');
            }
        }
    }
    const result = await offer_model_1.Offer.findByIdAndUpdate(id, offerData, {
        new: true,
        runValidators: true,
    }).populate('place');
    if (existingOffer.status !== offer_1.OFFER_STATUS.ACTIVE &&
        result &&
        result.status === offer_1.OFFER_STATUS.ACTIVE) {
        notification_integration_1.NotificationIntegration.onNewOffer(result).catch(err => console.error('Failed to dispatch new offer notification:', err));
    }
    return result;
};
const getOffersByPlaceOrBusinessId = async (id, authHeader) => {
    const [user, result] = await Promise.all([
        (0, mapAccessHelper_1.getUserFromToken)(authHeader),
        offer_model_1.Offer.findOne({
            $or: [{ place: id }, { business: id }],
        }).populate('place business'),
    ]);
    const isPremium = user && ([user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.MAP_EDITOR].includes(user.role));
    let offerObj = null;
    if (result) {
        offerObj = typeof result.toObject === 'function' ? result.toObject() : result;
        const actualRedemptionsCount = await offerRedemption_model_1.OfferRedemption.countDocuments({ offer: offerObj._id });
        offerObj.redemptionsCount = Math.max(Number(offerObj.redemptionsCount) || 0, actualRedemptionsCount);
        const accessibleMapIds = await (0, mapAccessHelper_1.getAccessibleMapIds)(user);
        const placeMapId = await (0, mapAccessHelper_1.resolveOfferMapIdAsync)(offerObj);
        offerObj.isLocked = !isPremium && (!placeMapId || !accessibleMapIds.includes(placeMapId));
        if (user) {
            const recurrenceWindowMs = (0, exports.getOfferRecurrenceWindowMs)(offerObj);
            const redemptionFilter = {
                user: user._id,
                offer: offerObj._id,
            };
            if (recurrenceWindowMs !== null) {
                const windowStart = new Date(Date.now() - recurrenceWindowMs);
                redemptionFilter.$or = [
                    { createdAt: { $gte: windowStart } },
                    { redemptionTime: { $gte: windowStart } },
                ];
            }
            const [activeRedemption, userRedemptionCount] = await Promise.all([
                offerRedemption_model_1.OfferRedemption.findOne({
                    user: user._id,
                    offer: offerObj._id,
                    expiresAt: { $gt: new Date() },
                }),
                offerRedemption_model_1.OfferRedemption.countDocuments(redemptionFilter),
            ]);
            let nextAvailableAt = null;
            const maxRedemptions = offerObj.maxRedemptions || 1;
            if (recurrenceWindowMs !== null && userRedemptionCount >= maxRedemptions) {
                const oldestInWindow = await offerRedemption_model_1.OfferRedemption.findOne(redemptionFilter).sort({
                    createdAt: 1,
                    redemptionTime: 1,
                });
                const oldestTime = (oldestInWindow === null || oldestInWindow === void 0 ? void 0 : oldestInWindow.createdAt) || (oldestInWindow === null || oldestInWindow === void 0 ? void 0 : oldestInWindow.redemptionTime);
                if (oldestTime) {
                    nextAvailableAt = new Date(new Date(oldestTime).getTime() + recurrenceWindowMs);
                }
            }
            offerObj.activeRedemption = activeRedemption;
            offerObj.userRedemptionCount = userRedemptionCount;
            offerObj.isRecurring = recurrenceWindowMs !== null;
            offerObj.recurrenceWindowMs = recurrenceWindowMs;
            offerObj.nextAvailableAt = nextAvailableAt;
        }
    }
    return offerObj;
};
const getOfferRedemptions = async (id, authHeader, timeFilter) => {
    const [user, offer] = await Promise.all([
        (0, mapAccessHelper_1.getUserFromToken)(authHeader),
        offer_model_1.Offer.findOne({
            $or: [
                ...(mongoose_1.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
                { place: id },
                { business: id },
            ],
        }).lean(),
    ]);
    if (!offer) {
        return { count: 0, redemptions: [] };
    }
    const dateRange = (0, dateHelper_1.getTimeFilterQuery)(timeFilter);
    const redemptQuery = { offer: offer._id };
    if (dateRange) {
        redemptQuery.createdAt = dateRange;
    }
    const [actualCount, redemptions] = await Promise.all([
        offerRedemption_model_1.OfferRedemption.countDocuments(redemptQuery),
        offerRedemption_model_1.OfferRedemption.find(redemptQuery)
            .populate('user', 'name profile.avatar profile.photo email')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean(),
    ]);
    return {
        count: dateRange
            ? actualCount
            : Math.max(actualCount, Number(offer.redemptionsCount) || 0),
        redemptions,
        timeFilter: timeFilter || 'all_time',
    };
};
const deleteOffer = async (id) => {
    const isExist = await offer_model_1.Offer.findById(id);
    if (!isExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Offer not found');
    }
    const result = await offer_model_1.Offer.findByIdAndDelete(id);
    return result;
};
const calculateDiscount = async (id, price, authHeader) => {
    if (price === undefined || isNaN(Number(price)) || Number(price) < 0) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Valid price must be provided');
    }
    const [user, offer] = await Promise.all([
        (0, mapAccessHelper_1.getUserFromToken)(authHeader),
        offer_model_1.Offer.findById(id),
    ]);
    if (!offer) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Offer not found');
    }
    const isPremium = user && ([user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.MAP_EDITOR].includes(user.role));
    if (!isPremium) {
        const accessibleMapIds = await (0, mapAccessHelper_1.getAccessibleMapIds)(user);
        const placeMapId = await (0, mapAccessHelper_1.resolveOfferMapIdAsync)(offer);
        if (!placeMapId || !accessibleMapIds.includes(placeMapId)) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'This information and these benefits can be unlocked by purchasing your favorite map.');
        }
    }
    let discountAmount = 0;
    if (offer.discountType === offer_1.DISCOUNT_TYPE.PERCENTAGE) {
        const percentage = Number(offer.discountValue);
        if (!isNaN(percentage))
            discountAmount = (price * percentage) / 100;
    }
    else if (offer.discountType === offer_1.DISCOUNT_TYPE.FLAT) {
        const flat = Number(offer.discountValue);
        if (!isNaN(flat))
            discountAmount = flat > price ? price : flat;
    }
    const finalPrice = Math.max(0, price - discountAmount);
    return { originalPrice: price, discountAmount, finalPrice };
};
const redeemOffer = async (id, userId, authHeader) => {
    const [user, offer] = await Promise.all([
        (0, mapAccessHelper_1.getUserFromToken)(authHeader),
        offer_model_1.Offer.findById(id),
    ]);
    if (!offer) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Offer not found');
    }
    const isPremium = user && ([user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.MAP_EDITOR].includes(user.role));
    if (!isPremium) {
        const accessibleMapIds = await (0, mapAccessHelper_1.getAccessibleMapIds)(user);
        const placeMapId = await (0, mapAccessHelper_1.resolveOfferMapIdAsync)(offer);
        if (!placeMapId || !accessibleMapIds.includes(placeMapId)) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'This information and these benefits can be unlocked by purchasing your favorite map.');
        }
    }
    if (offer.status !== offer_1.OFFER_STATUS.ACTIVE) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Offer is not active');
    }
    // Optional cap across every user
    if (offer.totalRedemptionLimit &&
        offer.redemptionsCount >= offer.totalRedemptionLimit) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Offer redemption limit reached');
    }
    // maxRedemptions is evaluated within the recurrence window (e.g. daily = 24 hours)
    if (offer.maxRedemptions) {
        const recurrenceWindowMs = (0, exports.getOfferRecurrenceWindowMs)(offer);
        let userRedemptionsQuery = {
            user: userId,
            offer: id,
        };
        if (recurrenceWindowMs !== null) {
            const windowStart = new Date(Date.now() - recurrenceWindowMs);
            userRedemptionsQuery = {
                user: userId,
                offer: id,
                $or: [
                    { createdAt: { $gte: windowStart } },
                    { redemptionTime: { $gte: windowStart } },
                ],
            };
        }
        const userRedemptions = await offerRedemption_model_1.OfferRedemption.countDocuments(userRedemptionsQuery);
        if (userRedemptions >= offer.maxRedemptions) {
            const freq = String(offer.redemptionFrequency || '').toLowerCase();
            const freqLabel = freq === 'daily' || recurrenceWindowMs === 24 * 60 * 60 * 1000
                ? 'today'
                : freq === 'weekly' || recurrenceWindowMs === 7 * 24 * 60 * 60 * 1000
                    ? 'this week'
                    : freq === 'monthly' || recurrenceWindowMs === 30 * 24 * 60 * 60 * 1000
                        ? 'this month'
                        : '';
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, offer.maxRedemptions === 1
                ? `You have already redeemed this offer${freqLabel ? ` ${freqLabel}` : ''}`
                : `You can redeem this offer only ${offer.maxRedemptions} times${freqLabel ? ` ${freqLabel}` : ''}`);
        }
    }
    // Check expiration date
    const now = new Date();
    if (offer.noExpiration !== true) {
        if (offer.validFrom && now < new Date(offer.validFrom)) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Offer is not yet valid');
        }
        if (offer.validUntil && now > new Date(offer.validUntil)) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Offer has expired');
        }
    }
    // Check if there is an active redemption (timer still running)
    const activeRedemption = await offerRedemption_model_1.OfferRedemption.findOne({
        user: userId,
        offer: id,
        expiresAt: { $gt: new Date() },
    });
    if (activeRedemption) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'You already have an active redemption for this offer');
    }
    // Active session countdown timer for customer to show staff (configured by admin on offer, default 15 mins)
    const durationInMinutes = Number(offer.redemptionDuration) && Number(offer.redemptionDuration) > 0
        ? Number(offer.redemptionDuration)
        : 15;
    const expiresAt = new Date(Date.now() + durationInMinutes * 60 * 1000);
    const redemption = await offerRedemption_model_1.OfferRedemption.create({
        user: userId,
        offer: id,
        redemptionTime: new Date(),
        expiresAt,
    });
    // Increment redemption count
    await offer_model_1.Offer.findByIdAndUpdate(id, { $inc: { redemptionsCount: 1 } });
    return redemption;
};
exports.OfferService = {
    createOffer,
    getAllOffers,
    getOfferById,
    updateOffer,
    deleteOffer,
    calculateDiscount,
    redeemOffer,
    getOffersByPlaceOrBusinessId,
    getOfferRedemptions,
};
