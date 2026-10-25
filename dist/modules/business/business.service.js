"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessService = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const place_model_1 = require("../place/place.model");
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const business_model_1 = require("./business.model");
const offer_model_1 = require("../offer/offer.model");
const offerRedemption_model_1 = require("../offer/offerRedemption.model");
const usageView_model_1 = require("../stats/usageView.model");
const visited_model_1 = require("../visited/visited.model");
const dateHelper_1 = require("../../helpers/dateHelper");
const QueryBuilder_1 = __importDefault(require("../../builder/QueryBuilder"));
const business_constants_1 = require("./business.constants");
const offer_1 = require("../../enum/offer");
const subscription_model_1 = require("../subscription/subscription.model");
const autoTranslate_1 = require("../../utils/autoTranslate");
const user_1 = require("../../enum/user");
const mapAccessHelper_1 = require("../../helpers/mapAccessHelper");
const resolveUserRole = (user) => { var _a, _b; return (user === null || user === void 0 ? void 0 : user.role) || ((_a = user === null || user === void 0 ? void 0 : user.user) === null || _a === void 0 ? void 0 : _a.role) || ((_b = user === null || user === void 0 ? void 0 : user.data) === null || _b === void 0 ? void 0 : _b.role); };
const isAdminRole = (role) => !!role && [user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN].includes(role);
const getBusinessOwnerId = (business) => {
    if (!(business === null || business === void 0 ? void 0 : business.user))
        return null;
    return (business.user._id || business.user).toString();
};
const stripPrivateInfo = (business) => {
    if (!business)
        return business;
    const obj = typeof business.toObject === 'function' ? business.toObject() : { ...business };
    delete obj.privateInfo;
    delete obj.adminReview;
    return obj;
};
const processBusinessTranslations = async (payload) => {
    if (payload.name) {
        if (typeof payload.name === 'string') {
            const trimmed = payload.name.trim();
            payload.name = { en: trimmed, es: trimmed };
        }
        else if (typeof payload.name === 'object' && payload.name !== null) {
            const enVal = (payload.name.en || '').trim();
            const esVal = (payload.name.es || '').trim();
            if (enVal && esVal) {
                payload.name = { en: enVal, es: esVal };
            }
            else {
                const fallback = enVal || esVal || '';
                payload.name = { en: enVal || fallback, es: esVal || fallback };
            }
        }
    }
    if (payload.description)
        payload.description = await (0, autoTranslate_1.autoTranslateField)(payload.description);
};
const createBusiness = async (payload, userId) => {
    const businessData = {
        ...payload,
        user: userId || payload.user,
    };
    if (payload.images) {
        if (!businessData.media)
            businessData.media = {};
        businessData.media.photos = Array.isArray(payload.images)
            ? payload.images
            : [payload.images];
    }
    if (payload.documents) {
        if (!businessData.media)
            businessData.media = {};
        businessData.media.menu = Array.isArray(payload.documents)
            ? payload.documents[0]
            : payload.documents;
    }
    await processBusinessTranslations(businessData);
    businessData.status = 'Pending'; // Always start as pending until admin approves
    businessData.hasActiveSubscription = false; // Explicitly start with no active subscription
    const result = await business_model_1.Business.create(businessData);
    return result;
};
/**
 * Retrieves all businesses with support for queries (search, filter, sort, pagination).
 * Strips private admin info for non-owner/non-admin users.
 */
const getAllBusinesses = async (query, authHeader) => {
    const queryObj = { ...query };
    // If requesting specifically for the map, enforce active subscription and approved status
    if (queryObj.mapView === 'true') {
        queryObj.hasActiveSubscription = true;
        queryObj.status = 'Approved';
        delete queryObj.mapView;
    }
    const businessQuery = new QueryBuilder_1.default(business_model_1.Business.find()
        .populate('user', 'name email profile')
        .populate('category', 'name color icon status')
        .lean(), queryObj)
        .search(business_constants_1.businessSearchableFields)
        .filter()
        .sort()
        .paginate()
        .fields();
    const [user, result, meta] = await Promise.all([
        (0, mapAccessHelper_1.getUserFromToken)(authHeader),
        businessQuery.modelQuery,
        businessQuery.getPaginationInfo(),
    ]);
    const data = result.map((biz) => {
        const ownerId = getBusinessOwnerId(biz);
        const canSeePrivate = isAdminRole(user === null || user === void 0 ? void 0 : user.role) || (user && ownerId === user._id.toString());
        return canSeePrivate ? biz : stripPrivateInfo(biz);
    });
    return {
        meta,
        data,
    };
};
/**
 * Retrieves businesses belonging to the authenticated user.
 * @param userId The user's ID
 * @param query The query parameters from the request
 * @returns Paginated list of businesses and metadata
 */
const getMyBusinesses = async (userId, query) => {
    const businessQuery = new QueryBuilder_1.default(business_model_1.Business.find({ user: userId })
        .populate('user', 'name email profile')
        .populate('category', 'name color icon status')
        .lean(), query)
        .search(business_constants_1.businessSearchableFields)
        .filter()
        .sort()
        .paginate()
        .fields();
    const result = await businessQuery.modelQuery;
    const meta = await businessQuery.getPaginationInfo();
    const unpaidIds = result
        .filter((business) => !business.hasActiveSubscription)
        .map((business) => business._id);
    if (unpaidIds.length > 0) {
        const paidSubs = await subscription_model_1.Subscription.find({
            businessId: { $in: unpaidIds },
            status: { $in: ['active', 'trialing'] },
        })
            .select('businessId planId')
            .lean();
        if (paidSubs.length > 0) {
            const paidByBusiness = new Map(paidSubs.map((sub) => [String(sub.businessId), sub]));
            await Promise.all(paidSubs.map((sub) => business_model_1.Business.findByIdAndUpdate(sub.businessId, {
                hasActiveSubscription: true,
                ...(sub.planId ? { plan: sub.planId } : {}),
            })));
            for (const business of result) {
                const paid = paidByBusiness.get(String(business._id));
                if (paid) {
                    business.hasActiveSubscription = true;
                    if (paid.planId)
                        business.plan = paid.planId;
                }
            }
        }
    }
    const timeFilter = typeof query.timeFilter === 'string' ? query.timeFilter : undefined;
    const dateRange = (0, dateHelper_1.getTimeFilterQuery)(timeFilter);
    // Populate offer information, views, and discounts redeemed count for each business
    const businessIds = result.map((business) => business._id);
    let overallTotalViews = 0;
    let overallTotalRedemptions = 0;
    if (businessIds.length > 0) {
        const offers = await offer_model_1.Offer.find({ business: { $in: businessIds } })
            .select('_id business redemptionsCount title discountType discountValue')
            .lean();
        const offersByBusiness = new Map();
        for (const off of offers) {
            const bId = String(off.business);
            if (!offersByBusiness.has(bId))
                offersByBusiness.set(bId, []);
            offersByBusiness.get(bId).push(off);
        }
        // Get views and visits for each business (including any matching places with same name)
        const businessNames = [];
        for (const b of result) {
            if (typeof b.name === 'object') {
                if (b.name.en)
                    businessNames.push(b.name.en);
                if (b.name.es)
                    businessNames.push(b.name.es);
            }
            else if (typeof b.name === 'string' && b.name.trim()) {
                businessNames.push(b.name.trim());
            }
        }
        const linkedPlaces = businessNames.length > 0
            ? await place_model_1.Place.find({
                $or: [
                    { name: { $in: businessNames } },
                    { 'name.en': { $in: businessNames } },
                    { 'name.es': { $in: businessNames } },
                ],
            })
                .select('_id name')
                .lean()
            : [];
        const linkedPlaceIds = linkedPlaces.map((p) => p._id);
        const linkedPlaceIdStrings = linkedPlaceIds.map(String);
        // Map place ID to business ID
        const placeIdToBusinessId = new Map();
        for (const p of linkedPlaces) {
            const pName = (typeof p.name === 'object' ? `${p.name.en || ''} ${p.name.es || ''}` : p.name || '').toLowerCase().trim();
            for (const b of result) {
                const bName = (typeof b.name === 'object' ? `${b.name.en || ''} ${b.name.es || ''}` : b.name || '').toLowerCase().trim();
                if (pName && bName && (pName.includes(bName) || bName.includes(pName))) {
                    placeIdToBusinessId.set(String(p._id), String(b._id));
                }
            }
        }
        const viewsByBusiness = new Map();
        const visitedByBusiness = new Map();
        const allEntityIds = [...businessIds.map(String), ...linkedPlaceIdStrings];
        const viewMatch = {
            $or: [
                { type: 'business', entityId: { $in: businessIds.map(String) } },
                { entityId: { $in: allEntityIds } },
            ],
        };
        if (dateRange)
            viewMatch.lastSeenAt = dateRange;
        const visitedMatch = {
            $or: [
                { type: 'Business', business: { $in: businessIds } },
                { business: { $in: businessIds } },
                ...(linkedPlaceIds.length > 0 ? [{ place: { $in: linkedPlaceIds } }] : []),
            ],
        };
        if (dateRange)
            visitedMatch.visitedAt = dateRange;
        const [viewAgg, visitedAgg] = await Promise.all([
            usageView_model_1.UsageView.aggregate([
                { $match: viewMatch },
                {
                    $group: {
                        _id: '$entityId',
                        count: { $sum: 1 },
                    },
                },
            ]),
            visited_model_1.Visited.aggregate([
                { $match: visitedMatch },
                {
                    $group: {
                        _id: { $ifNull: ['$business', '$place'] },
                        count: { $sum: 1 },
                    },
                },
            ]),
        ]);
        for (const item of viewAgg) {
            const idStr = String(item._id);
            const mappedBizId = placeIdToBusinessId.get(idStr) || idStr;
            viewsByBusiness.set(mappedBizId, (viewsByBusiness.get(mappedBizId) || 0) + item.count);
        }
        for (const item of visitedAgg) {
            const idStr = String(item._id);
            const mappedBizId = placeIdToBusinessId.get(idStr) || idStr;
            visitedByBusiness.set(mappedBizId, (visitedByBusiness.get(mappedBizId) || 0) + item.count);
        }
        // Get redemptions for all offers
        const offerIds = offers.map((o) => o._id);
        const redemptionsByOffer = new Map();
        if (offerIds.length > 0) {
            const redemptQuery = { offer: { $in: offerIds } };
            if (dateRange)
                redemptQuery.createdAt = dateRange;
            const redemptAgg = await offerRedemption_model_1.OfferRedemption.aggregate([
                { $match: redemptQuery },
                {
                    $group: {
                        _id: '$offer',
                        count: { $sum: 1 },
                    },
                },
            ]);
            for (const item of redemptAgg) {
                redemptionsByOffer.set(String(item._id), item.count);
            }
        }
        for (const business of result) {
            const bOffers = offersByBusiness.get(String(business._id)) || [];
            business.offer = bOffers[0] || null;
            let bRedemptions = 0;
            for (const off of bOffers) {
                const rCount = redemptionsByOffer.get(String(off._id));
                if (rCount !== undefined) {
                    bRedemptions += rCount;
                }
                else if (!dateRange) {
                    bRedemptions += off.redemptionsCount || 0;
                }
            }
            business.discountsRedeemed = bRedemptions;
            overallTotalRedemptions += bRedemptions;
            const uViews = viewsByBusiness.get(String(business._id)) || 0;
            const vCount = visitedByBusiness.get(String(business._id)) || 0;
            const effectiveVisits = dateRange
                ? Math.max(uViews, vCount)
                : Math.max(business.viewCount || 0, uViews, vCount);
            business.viewCount = effectiveVisits;
            business.visitsCount = effectiveVisits;
            overallTotalViews += effectiveVisits;
        }
    }
    meta.stats = {
        totalBusinesses: result.length,
        totalViews: overallTotalViews,
        totalVisits: overallTotalViews,
        totalDiscountsRedeemed: overallTotalRedemptions,
        activeBusinesses: result.filter((b) => b.hasActiveSubscription && (b.status === 'Approved' || b.status === 'approved')).length,
        timeFilter: timeFilter || 'all_time',
    };
    return {
        meta,
        data: result,
    };
};
/**
 * Retrieves a single business by its ID.
 * Strips private admin info for non-owner/non-admin users.
 */
const getBusinessById = async (id, authHeader) => {
    const [user, result] = await Promise.all([
        (0, mapAccessHelper_1.getUserFromToken)(authHeader),
        business_model_1.Business.findById(id).populate('user category'),
    ]);
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Business not found');
    }
    const ownerId = getBusinessOwnerId(result);
    const canSeePrivate = isAdminRole(user === null || user === void 0 ? void 0 : user.role) || (user && ownerId === user._id.toString());
    return canSeePrivate ? result : stripPrivateInfo(result);
};
/**
 * Updates an existing business listing with permission and status enforcement.
 */
const updateBusiness = async (id, payload, authUser) => {
    var _a, _b, _c;
    const existing = await business_model_1.Business.findById(id);
    if (!existing) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Business not found');
    }
    const ownerId = getBusinessOwnerId(existing);
    const admin = isAdminRole(resolveUserRole(authUser));
    const currentUserId = (_a = ((authUser === null || authUser === void 0 ? void 0 : authUser.authId) || (authUser === null || authUser === void 0 ? void 0 : authUser._id) || (authUser === null || authUser === void 0 ? void 0 : authUser.id) || '')) === null || _a === void 0 ? void 0 : _a.toString();
    if (!admin && ownerId !== currentUserId) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You are not authorized to update this business');
    }
    const businessData = { ...payload };
    // Users cannot self-approve, self-verify, or toggle subscription
    if (!admin) {
        delete businessData.status;
        delete businessData.hasActiveSubscription;
        delete businessData.isAccuracyVerified;
        delete businessData.adminReview;
    }
    const existingReview = existing.adminReview &&
        typeof existing.adminReview === 'object'
        ? existing.adminReview
        : {};
    if (businessData.adminReview) {
        businessData.adminReview = {
            ...existingReview,
            ...businessData.adminReview,
        };
        if (typeof businessData.adminReview.locationPinVerified === 'boolean') {
            businessData.isAccuracyVerified =
                businessData.adminReview.locationPinVerified;
        }
    }
    if (typeof businessData.isAccuracyVerified === 'boolean') {
        businessData.adminReview = {
            ...existingReview,
            ...businessData.adminReview,
            locationPinVerified: businessData.isAccuracyVerified,
        };
    }
    // Handle image upload from disk storage
    if (payload.images) {
        if (!businessData.media)
            businessData.media = {};
        const newPhotos = Array.isArray(payload.images)
            ? payload.images
            : [payload.images];
        const existingPhotos = Array.isArray(businessData.media.photos)
            ? businessData.media.photos
            : Array.isArray((_b = existing.media) === null || _b === void 0 ? void 0 : _b.photos)
                ? existing.media.photos
                : [];
        businessData.media.photos = [...existingPhotos, ...newPhotos];
    }
    // Handle menu/document upload from disk storage
    if (payload.documents) {
        if (!businessData.media)
            businessData.media = {};
        businessData.media.menu = Array.isArray(payload.documents)
            ? payload.documents[0]
            : payload.documents;
    }
    if (businessData.media && ((_c = existing.media) === null || _c === void 0 ? void 0 : _c.menu) && !businessData.media.menu) {
        businessData.media.menu = existing.media.menu;
    }
    await processBusinessTranslations(businessData);
    const result = await business_model_1.Business.findByIdAndUpdate(id, businessData, {
        new: true,
        runValidators: true,
    }).populate('user category');
    return result;
};
/**
 * Updates the approval status of a business listing (e.g., Pending, Approved, Rejected).
 * @param id The business document ID
 * @param status The new status value
 * @returns The updated business document
 */
const updateBusinessStatus = async (id, status) => {
    const isExist = await business_model_1.Business.findById(id);
    if (!isExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Business not found');
    }
    const result = await business_model_1.Business.findByIdAndUpdate(id, { status }, {
        new: true,
        runValidators: true,
    }).populate('user category');
    return result;
};
/**
 * Deletes a business listing permanently with permission check.
 */
const deleteBusiness = async (id, authUser) => {
    var _a;
    const existing = await business_model_1.Business.findById(id);
    if (!existing) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Business not found');
    }
    const ownerId = getBusinessOwnerId(existing);
    const admin = isAdminRole(resolveUserRole(authUser));
    if (!admin && ownerId !== ((_a = authUser === null || authUser === void 0 ? void 0 : authUser.authId) === null || _a === void 0 ? void 0 : _a.toString())) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You are not authorized to delete this business');
    }
    const result = await business_model_1.Business.findByIdAndDelete(id);
    return result;
};
const getBusinessStats = async (businessId, timeFilter) => {
    const business = await business_model_1.Business.findById(businessId);
    if (!business) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Business not found');
    }
    const dateRange = (0, dateHelper_1.getTimeFilterQuery)(timeFilter);
    // Get all offers for this business and sum their redemptions
    const offers = await offer_model_1.Offer.find({ business: businessId }).select('_id status redemptionsCount');
    const offerIds = offers.map((o) => o._id);
    let totalOfferRedemptions = 0;
    if (offerIds.length > 0) {
        const redemptionQuery = { offer: { $in: offerIds } };
        if (dateRange) {
            redemptionQuery.createdAt = dateRange;
        }
        const redemptionsCount = await offerRedemption_model_1.OfferRedemption.countDocuments(redemptionQuery);
        if (!dateRange && redemptionsCount === 0) {
            totalOfferRedemptions = offers.reduce((acc, offer) => acc + (offer.redemptionsCount || 0), 0);
        }
        else {
            totalOfferRedemptions = redemptionsCount;
        }
    }
    // Views and visits from UsageView and Visited (including any duplicate or linked Place entries)
    const businessName = typeof business.name === 'object'
        ? business.name.en || business.name.es || ''
        : business.name || '';
    const matchingPlace = businessName
        ? await place_model_1.Place.findOne({
            $or: [
                { name: businessName },
                { 'name.en': businessName },
                { 'name.es': businessName },
            ],
        })
            .select('_id')
            .lean()
        : null;
    const targetIds = [businessId];
    if (matchingPlace) {
        targetIds.push(String(matchingPlace._id));
    }
    let viewCount = 0;
    const viewQuery = {
        $or: [
            { type: 'business', entityId: businessId },
            { entityId: { $in: targetIds } },
        ],
    };
    const visitedQuery = {
        $or: [
            { business: businessId },
            { type: 'Business', business: businessId },
            ...(matchingPlace ? [{ place: matchingPlace._id }] : []),
        ],
    };
    if (dateRange) {
        viewQuery.lastSeenAt = dateRange;
        visitedQuery.visitedAt = dateRange;
        const [trackedViews, visitedCount] = await Promise.all([
            usageView_model_1.UsageView.countDocuments(viewQuery),
            visited_model_1.Visited.countDocuments(visitedQuery),
        ]);
        viewCount = Math.max(trackedViews, visitedCount);
    }
    else {
        const [trackedViews, visitedCount] = await Promise.all([
            usageView_model_1.UsageView.countDocuments(viewQuery),
            visited_model_1.Visited.countDocuments(visitedQuery),
        ]);
        viewCount = Math.max(trackedViews, visitedCount, business.viewCount || 0);
    }
    return {
        viewCount,
        visitsCount: viewCount,
        totalOfferRedemptions,
        activeOffersCount: offers.filter((o) => o.status === offer_1.OFFER_STATUS.ACTIVE).length,
        timeFilter: timeFilter || 'all_time',
    };
};
const incrementViewCount = async (id, userId) => {
    if (!mongoose_1.default.Types.ObjectId.isValid(id))
        return null;
    const business = await business_model_1.Business.findByIdAndUpdate(id, { $inc: { viewCount: 1 } }, { new: true });
    if (userId) {
        try {
            await usageView_model_1.UsageView.findOneAndUpdate({ viewerKey: `user:${userId}`, type: 'business', entityId: String(id) }, { $set: { lastSeenAt: new Date() } }, { upsert: true });
        }
        catch (_a) {
            // Ignore unique index collision
        }
    }
    return business;
};
exports.BusinessService = {
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
