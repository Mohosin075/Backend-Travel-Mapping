"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatsService = void 0;
const recent_place_views_1 = require("./recent-place-views");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const http_status_codes_1 = require("http-status-codes");
const map_model_1 = require("../map/map.model");
const place_model_1 = require("../place/place.model");
const offer_model_1 = require("../offer/offer.model");
const offerRedemption_model_1 = require("../offer/offerRedemption.model");
const user_model_1 = require("../user/user.model");
const business_model_1 = require("../business/business.model");
const payment_model_1 = require("../payment/payment.model");
const usage_reporting_1 = require("./usage-reporting");
const visited_model_1 = require("../visited/visited.model");
const review_model_1 = require("../review/review.model");
const mongoose_1 = __importDefault(require("mongoose"));
const localize_1 = require("../../helpers/localize");
const getDashboardData = async () => {
    var _a, _b, _c;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Run DB queries in parallel
    const [totalMaps, regularPlacesCount, businessPlacesCount, activeOffers, recentMaps, recentPlaces, recentOffers, recentUsers, paymentsTotalAgg, paymentsMonthAgg,] = await Promise.all([
        map_model_1.Map.countDocuments(),
        place_model_1.Place.countDocuments(),
        business_model_1.Business.countDocuments({ status: 'Approved' }),
        offer_model_1.Offer.countDocuments({ status: { $in: ['ACTIVE', 'Active', 'active'] } }),
        map_model_1.Map.find().sort({ createdAt: -1 }).limit(3).select('name createdAt').lean(),
        place_model_1.Place.find().sort({ updatedAt: -1 }).limit(3).select('name updatedAt').lean(),
        offer_model_1.Offer.find().sort({ createdAt: -1 }).limit(3).select('title createdAt').lean(),
        user_model_1.User.find().sort({ updatedAt: -1 }).limit(3).select('name role updatedAt').lean(),
        payment_model_1.Payment.aggregate([
            { $match: { status: 'succeeded' } },
            { $group: { _id: null, total: { $sum: '$amount' }, tax: { $sum: { $ifNull: ['$taxAmount', 0] } } } },
        ]),
        payment_model_1.Payment.aggregate([
            { $match: { status: 'succeeded', createdAt: { $gte: startOfMonth } } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
    ]);
    const totalPlaces = regularPlacesCount + businessPlacesCount;
    const realTotalSales = ((_a = paymentsTotalAgg[0]) === null || _a === void 0 ? void 0 : _a.total) || 0;
    const realMonthSales = ((_b = paymentsMonthAgg[0]) === null || _b === void 0 ? void 0 : _b.total) || 0;
    // Report actual persisted revenue, including zero-sales periods.
    const totalSales = realTotalSales;
    const thisMonthRevenue = realMonthSales;
    const taxesCollected = Math.round((((_c = paymentsTotalAgg[0]) === null || _c === void 0 ? void 0 : _c.tax) || 0) * 100) / 100;
    const recentActivity = [];
    const getSafeStr = (val) => {
        if (!val)
            return 'Unknown';
        if (typeof val === 'string')
            return val;
        if (typeof val === 'object') {
            return val.en || val.es || Object.values(val)[0] || 'Unknown';
        }
        return String(val);
    };
    recentPlaces.forEach((place) => {
        recentActivity.push({
            id: place._id.toString(),
            type: 'place',
            message: `Place updated: ${getSafeStr(place.name)}`,
            timestamp: place.updatedAt,
        });
    });
    recentOffers.forEach((offer) => {
        recentActivity.push({
            id: offer._id.toString(),
            type: 'offer',
            message: `Offer published: ${getSafeStr(offer.title)}`,
            timestamp: offer.createdAt,
        });
    });
    recentMaps.forEach((map) => {
        recentActivity.push({
            id: map._id.toString(),
            type: 'map',
            message: `Map created: ${getSafeStr(map.name)}`,
            timestamp: map.createdAt,
        });
    });
    recentUsers.forEach((user) => {
        recentActivity.push({
            id: user._id.toString(),
            type: 'user',
            message: `User role changed: ${user.name || 'Unknown User'} to ${user.role}`,
            timestamp: user.updatedAt,
        });
    });
    // Sort by timestamp descending and take top 6
    recentActivity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return {
        stats: {
            totalMaps,
            totalPlaces,
            activeOffers,
            totalSales,
            thisMonthRevenue,
            taxesCollected,
        },
        recentActivity: recentActivity.slice(0, 6),
    };
};
const getDateRangeQuery = (timeFilter) => {
    const now = new Date();
    let startDate = null;
    let endDate = null;
    if (timeFilter === 'today') {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
    }
    else if (timeFilter === 'this_week') {
        startDate = new Date();
        const day = startDate.getDay();
        const diff = startDate.getDate() - day + (day === 0 ? -6 : 1); // Monday
        startDate.setDate(diff);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
    }
    else if (timeFilter === 'this_month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
    }
    else if (timeFilter === 'last_month') {
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    }
    if (startDate && endDate) {
        return { $gte: startDate, $lte: endDate };
    }
    return null;
};
const isObjectId = (id) => typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchReportEntities = async (searchTerm) => {
    const q = searchTerm === null || searchTerm === void 0 ? void 0 : searchTerm.trim();
    if (!q || q.length < 2)
        return [];
    const searchRegex = { $regex: escapeRegex(q), $options: 'i' };
    const [matchedPlaces, matchedBusinesses, matchedMaps, matchedOffers] = await Promise.all([
        place_model_1.Place.find({
            $or: [
                { name: searchRegex },
                { 'name.en': searchRegex },
                { 'name.es': searchRegex },
                { address: searchRegex },
                { 'address.en': searchRegex },
                { 'address.es': searchRegex },
                { country: searchRegex },
                { 'location.address': searchRegex },
                { 'location.city': searchRegex },
            ],
        })
            .select('name country address location')
            .limit(6)
            .lean(),
        business_model_1.Business.find({
            $or: [
                { name: searchRegex },
                { 'name.en': searchRegex },
                { 'name.es': searchRegex },
                { 'location.address': searchRegex },
                { 'location.city': searchRegex },
                { 'location.country': searchRegex },
            ],
        })
            .select('name location.country location.city location.address')
            .limit(6)
            .lean(),
        map_model_1.Map.find({
            $or: [
                { name: searchRegex },
                { 'name.en': searchRegex },
                { 'name.es': searchRegex },
                { country: searchRegex },
            ],
        })
            .select('name country')
            .limit(5)
            .lean(),
        offer_model_1.Offer.find({
            $or: [
                { title: searchRegex },
                { 'title.en': searchRegex },
                { 'title.es': searchRegex },
            ],
        })
            .select('title business place')
            .populate('business', 'name')
            .populate('place', 'name')
            .limit(5)
            .lean(),
    ]);
    return [
        ...matchedPlaces.map((p) => {
            var _a, _b;
            return ({
                type: 'place',
                id: String(p._id),
                name: (0, localize_1.localizeField)(p.name, 'en') || (0, localize_1.localizeField)(p.name, 'es') || (typeof p.name === 'string' ? p.name : ''),
                location: [
                    (0, localize_1.localizeField)(p.address, 'en') || (0, localize_1.localizeField)(p.address, 'es') || ((_a = p.location) === null || _a === void 0 ? void 0 : _a.city),
                    p.country || ((_b = p.location) === null || _b === void 0 ? void 0 : _b.country),
                ]
                    .filter(Boolean)
                    .join(', '),
            });
        }),
        ...matchedBusinesses.map((b) => {
            var _a, _b, _c, _d;
            return ({
                type: 'business',
                id: String(b._id),
                name: (0, localize_1.localizeField)(b.name, 'en') || (0, localize_1.localizeField)(b.name, 'es') || (typeof b.name === 'string' ? b.name : ''),
                location: [
                    (0, localize_1.localizeField)((_a = b.location) === null || _a === void 0 ? void 0 : _a.address, 'en') ||
                        (0, localize_1.localizeField)((_b = b.location) === null || _b === void 0 ? void 0 : _b.address, 'es') ||
                        ((_c = b.location) === null || _c === void 0 ? void 0 : _c.city),
                    (_d = b.location) === null || _d === void 0 ? void 0 : _d.country,
                ]
                    .filter(Boolean)
                    .join(', '),
            });
        }),
        ...matchedMaps.map((m) => ({
            type: 'map',
            id: String(m._id),
            name: (0, localize_1.localizeField)(m.name, 'en') || (0, localize_1.localizeField)(m.name, 'es') || (typeof m.name === 'string' ? m.name : ''),
            location: m.country || '',
        })),
        ...matchedOffers.map((o) => {
            var _a, _b;
            return ({
                type: 'offer',
                id: String(o._id),
                name: (0, localize_1.localizeField)(o.title, 'en') || (0, localize_1.localizeField)(o.title, 'es') || (typeof o.title === 'string' ? o.title : ''),
                location: ((_a = o.business) === null || _a === void 0 ? void 0 : _a.name)
                    ? ((0, localize_1.localizeField)(o.business.name, 'en') || (0, localize_1.localizeField)(o.business.name, 'es') || (typeof o.business.name === 'string' ? o.business.name : ''))
                    : ((_b = o.place) === null || _b === void 0 ? void 0 : _b.name)
                        ? ((0, localize_1.localizeField)(o.place.name, 'en') || (0, localize_1.localizeField)(o.place.name, 'es') || (typeof o.place.name === 'string' ? o.place.name : ''))
                        : '',
            });
        }),
    ];
};
const applySelectedEntity = async (query, mapFilter, placeFilter, offerFilter) => {
    const entityType = String(query.entityType || '');
    const entityId = String(query.entityId || '');
    if (!isObjectId(entityId))
        return { mapIds: [] };
    const oid = new mongoose_1.default.Types.ObjectId(entityId);
    if (entityType === 'place') {
        const place = await place_model_1.Place.findById(oid).select('map').lean();
        placeFilter._id = oid;
        offerFilter.place = oid;
        if (place === null || place === void 0 ? void 0 : place.map) {
            mapFilter._id = place.map;
            return { mapIds: [String(place.map)] };
        }
        mapFilter._id = { $in: [] };
        return { mapIds: [] };
    }
    if (entityType === 'business') {
        offerFilter.business = oid;
        placeFilter._id = { $in: [] };
        mapFilter._id = { $in: [] };
        const business = await business_model_1.Business.findById(oid).select('name viewCount').lean();
        return {
            mapIds: [],
            usagePlace: business
                ? {
                    entityType: 'business',
                    id: String(business._id),
                    name: (0, localize_1.localizeField)(business.name),
                    count: business.viewCount || 0,
                }
                : undefined,
        };
    }
    if (entityType === 'map') {
        mapFilter._id = oid;
        placeFilter.map = oid;
        const placesOnMap = await place_model_1.Place.find({ map: oid }, '_id').lean();
        offerFilter.$or = [{ place: { $in: placesOnMap.map(p => p._id) } }];
        return { mapIds: [entityId] };
    }
    if (entityType === 'offer') {
        offerFilter._id = oid;
        const offer = await offer_model_1.Offer.findById(oid).select('place business').lean();
        if (offer === null || offer === void 0 ? void 0 : offer.place) {
            placeFilter._id = offer.place;
            const place = await place_model_1.Place.findById(offer.place).select('map').lean();
            if (place === null || place === void 0 ? void 0 : place.map) {
                mapFilter._id = place.map;
                return { mapIds: [String(place.map)] };
            }
        }
        else if (offer === null || offer === void 0 ? void 0 : offer.business) {
            placeFilter._id = { $in: [] };
            mapFilter._id = { $in: [] };
            const business = await business_model_1.Business.findById(offer.business)
                .select('name viewCount')
                .lean();
            return {
                mapIds: [],
                usagePlace: business
                    ? {
                        entityType: 'business',
                        id: String(business._id),
                        name: (0, localize_1.localizeField)(business.name),
                        count: business.viewCount || 0,
                    }
                    : undefined,
            };
        }
        else {
            placeFilter._id = { $in: [] };
            mapFilter._id = { $in: [] };
        }
        return { mapIds: [] };
    }
    return { mapIds: [] };
};
const getReportsData = async (query = {}) => {
    var _a, _b, _c, _d, _e, _f;
    // 1. Parse and sanitize input filters
    const countryParam = typeof query.country === 'string' && query.country.trim() ? query.country.trim() : null;
    const countryRegex = countryParam ? new RegExp(`^${escapeRegex(countryParam)}$`, 'i') : null;
    const categoryParam = typeof query.category === 'string' && isObjectId(query.category) ? query.category : null;
    const categoryOid = categoryParam ? new mongoose_1.default.Types.ObjectId(categoryParam) : null;
    const dateRange = query.timeFilter ? getDateRangeQuery(query.timeFilter) : null;
    const hasEntity = isObjectId(String(query.entityId || '')) && !!query.entityType;
    // Construct filters for Maps, Places, Businesses, Offers
    const mapFilter = {};
    const placeFilter = {};
    const offerFilter = {};
    if (countryRegex) {
        placeFilter.country = countryRegex;
        mapFilter.country = countryRegex;
    }
    if (categoryOid) {
        placeFilter.category = categoryOid;
        const placesInCat = await place_model_1.Place.find({ category: categoryOid }, 'map').lean();
        const mapIds = Array.from(new Set(placesInCat.map(p => { var _a; return (_a = p.map) === null || _a === void 0 ? void 0 : _a.toString(); }).filter(Boolean)));
        mapFilter._id = { $in: mapIds.map(id => new mongoose_1.default.Types.ObjectId(id)) };
    }
    if (!hasEntity && (countryRegex || categoryOid)) {
        const placeConditions = {};
        if (countryRegex)
            placeConditions.country = countryRegex;
        if (categoryOid)
            placeConditions.category = categoryOid;
        const placesForOffer = await place_model_1.Place.find(placeConditions, '_id').lean();
        const businessConditions = {};
        if (countryRegex)
            businessConditions['location.country'] = countryRegex;
        if (categoryOid)
            businessConditions.category = categoryOid;
        const businessesForOffer = await business_model_1.Business.find(businessConditions, '_id').lean();
        offerFilter.$or = [
            { place: { $in: placesForOffer.map(p => p._id) } },
            { business: { $in: businessesForOffer.map(b => b._id) } },
        ];
    }
    // Selected place / business / map / offer (applied after defaults)
    const { usagePlace } = await applySelectedEntity(query, mapFilter, placeFilter, offerFilter);
    // Fetch allowed docs based on computed filters
    const allowedMapDocs = await map_model_1.Map.find(mapFilter)
        .select('_id name country places viewCount')
        .lean();
    const allowedMapIds = allowedMapDocs.map(m => m._id.toString());
    const allowedMapOids = allowedMapDocs.map(m => m._id);
    const allowedPlaceDocs = await place_model_1.Place.find(placeFilter)
        .select('_id name openCount')
        .lean();
    const allowedPlaceIds = allowedPlaceDocs.map(p => p._id.toString());
    const allowedPlaceOids = allowedPlaceDocs.map(p => p._id);
    const businessFilter = {};
    if (countryRegex)
        businessFilter['location.country'] = countryRegex;
    if (categoryOid)
        businessFilter.category = categoryOid;
    if (query.entityType === 'business' && isObjectId(query.entityId)) {
        businessFilter._id = new mongoose_1.default.Types.ObjectId(query.entityId);
    }
    const allowedBusinessDocs = await business_model_1.Business.find(businessFilter)
        .select('_id name')
        .lean();
    const allowedBusinessIds = allowedBusinessDocs.map(b => b._id.toString());
    const allowedBusinessOids = allowedBusinessDocs.map(b => b._id);
    const allowedOfferDocs = await offer_model_1.Offer.find(offerFilter).select('_id').lean();
    const allowedOfferOids = allowedOfferDocs.map(o => o._id);
    // ==================== SALES & TAXES CALCULATION ====================
    const paymentFilter = { status: 'succeeded' };
    if (dateRange)
        paymentFilter.createdAt = dateRange;
    if (allowedMapOids.length > 0) {
        paymentFilter.mapId = { $in: allowedMapOids };
    }
    else if (mapFilter._id || mapFilter.country || categoryOid || hasEntity) {
        paymentFilter.mapId = { $in: [] };
    }
    const payments = await payment_model_1.Payment.find(paymentFilter).lean();
    let totalSales = 0;
    let taxTotal = 0;
    payments.forEach(p => {
        totalSales += p.amount || 0;
        taxTotal += p.taxAmount || 0;
    });
    const taxesCollected = Math.round(taxTotal * 100) / 100;
    const netRevenue = Math.round((totalSales - taxesCollected) * 100) / 100;
    // Monthly sales & tax grouping
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyMap = {};
    const now = new Date(Math.min(Date.now(), (_b = (_a = dateRange === null || dateRange === void 0 ? void 0 : dateRange.$lte) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : Date.now()));
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        monthlyMap[label] = { totalSales: 0, taxes: 0, netRevenue: 0 };
    }
    payments.forEach(p => {
        const date = new Date(p.createdAt);
        const label = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
        if (monthlyMap[label] !== undefined) {
            monthlyMap[label].totalSales += p.amount || 0;
            monthlyMap[label].taxes += p.taxAmount || 0;
        }
    });
    const monthlyData = Object.keys(monthlyMap).map(month => {
        const data = monthlyMap[month];
        const taxes = Math.round(data.taxes * 100) / 100;
        const rev = Math.round((data.totalSales - taxes) * 100) / 100;
        return {
            month,
            totalSales: data.totalSales,
            taxes,
            netRevenue: rev,
        };
    });
    // ==================== USAGE STATS & RANKINGS ====================
    // Pre-calculate place counts for each map (Issue 5 Requirement)
    const mapPlaceCounts = await place_model_1.Place.aggregate([
        { $match: { map: { $in: allowedMapOids } } },
        { $group: { _id: '$map', count: { $sum: 1 } } },
    ]);
    const mapPlaceCountMap = new globalThis.Map(mapPlaceCounts.map(p => [String(p._id), p.count]));
    const mapDocMap = new globalThis.Map(allowedMapDocs.map(m => [String(m._id), m]));
    // Counts and viewer drilldowns use the same deduplicated records, not lifetime
    // counters that also include repeat visits and unidentifiable historical opens.
    const [mapRanks, placeRanks] = await Promise.all([
        (0, usage_reporting_1.rankedViewers)('map', allowedMapIds, dateRange),
        (0, usage_reporting_1.rankedViewers)('place', allowedPlaceIds, dateRange),
    ]);
    const rankedMapIds = new Set(mapRanks.map(r => String(r._id)));
    const mapsWithCounts = [...mapRanks, ...allowedMapDocs.filter(m => !rankedMapIds.has(String(m._id))).map(m => ({ _id: m._id, count: 0, profileCount: 0 }))]
        .sort((a, b) => (b.profileCount || 0) - (a.profileCount || 0) || b.count - a.count || String(a._id).localeCompare(String(b._id))).slice(0, 20);
    const mostViewedMaps = mapsWithCounts.map(r => {
        const doc = mapDocMap.get(String(r._id));
        return {
            id: String(r._id), name: (0, localize_1.localizeField)(doc === null || doc === void 0 ? void 0 : doc.name), count: r.count,
            placesCount: mapPlaceCountMap.get(String(r._id)) || 0, country: doc === null || doc === void 0 ? void 0 : doc.country,
            profileCount: r.profileCount || 0,
            countMetric: 'unique_viewers',
            ...(!dateRange ? { totalViews: (doc === null || doc === void 0 ? void 0 : doc.viewCount) || 0 } : {}),
        };
    });
    const placeDocMap = new globalThis.Map(allowedPlaceDocs.map(p => [String(p._id), p]));
    const rankedPlaceIds = new Set(placeRanks.map(r => String(r._id)));
    const placesWithCounts = [...placeRanks, ...allowedPlaceDocs.filter(p => !rankedPlaceIds.has(String(p._id))).map(p => ({ _id: p._id, count: 0, profileCount: 0 }))]
        .sort((a, b) => (b.profileCount || 0) - (a.profileCount || 0) || b.count - a.count || String(a._id).localeCompare(String(b._id))).slice(0, 20);
    let mostOpenedPlaces = placesWithCounts.map(r => {
        var _a, _b;
        return ({
            id: String(r._id), name: (0, localize_1.localizeField)((_a = placeDocMap.get(String(r._id))) === null || _a === void 0 ? void 0 : _a.name),
            profileCount: r.profileCount || 0,
            count: r.count, countMetric: 'unique_viewers',
            ...(!dateRange ? { totalViews: ((_b = placeDocMap.get(String(r._id))) === null || _b === void 0 ? void 0 : _b.openCount) || 0 } : {}),
        });
    });
    if (usagePlace) {
        if (usagePlace.entityType === 'business') {
            const ranks = await (0, usage_reporting_1.rankedViewers)('business', [usagePlace.id], dateRange);
            if (!dateRange)
                usagePlace.totalViews = usagePlace.count;
            usagePlace.count = ((_c = ranks[0]) === null || _c === void 0 ? void 0 : _c.count) || 0;
            usagePlace.profileCount = ((_d = ranks[0]) === null || _d === void 0 ? void 0 : _d.profileCount) || 0;
            usagePlace.countMetric = 'unique_viewers';
        }
        mostOpenedPlaces = [usagePlace];
    }
    // Rankings and drilldowns use redemption records, never the legacy cached counter.
    const scopedOffers = await offer_model_1.Offer.find(offerFilter)
        .select('_id title business place')
        .populate('business', 'name').populate('place', 'name').lean();
    const redemptionRanks = await offerRedemption_model_1.OfferRedemption.aggregate([
        { $match: { offer: { $in: scopedOffers.map(o => o._id) }, ...(dateRange ? { redemptionTime: dateRange } : {}) } },
        { $lookup: { from: user_model_1.User.collection.name, localField: 'user', foreignField: '_id',
                pipeline: [{ $match: { status: { $ne: 'deleted' } } }, { $project: { _id: 1 } }], as: 'account' } },
        { $group: { _id: '$offer', count: { $sum: 1 }, accountIds: { $addToSet: { $arrayElemAt: ['$account._id', 0] } } } },
        { $project: { count: 1, profileCount: { $size: { $filter: { input: '$accountIds', as: 'id', cond: { $ne: ['$$id', null] } } } } } },
    ]);
    const redemptionRankMap = new globalThis.Map(redemptionRanks.map(r => [String(r._id), r]));
    const mostRedeemedOffers = scopedOffers.map((o) => {
        var _a, _b, _c, _d, _e, _f;
        return ({
            id: String(o._id), name: (0, localize_1.localizeField)(o.title),
            businessName: ((_a = o.business) === null || _a === void 0 ? void 0 : _a.name) ? (0, localize_1.localizeField)(o.business.name) : ((_b = o.place) === null || _b === void 0 ? void 0 : _b.name) ? (0, localize_1.localizeField)(o.place.name) : undefined,
            businessId: ((_c = o.business) === null || _c === void 0 ? void 0 : _c._id) ? String(o.business._id) : undefined,
            placeId: ((_d = o.place) === null || _d === void 0 ? void 0 : _d._id) ? String(o.place._id) : undefined,
            count: ((_e = redemptionRankMap.get(String(o._id))) === null || _e === void 0 ? void 0 : _e.count) || 0,
            profileCount: ((_f = redemptionRankMap.get(String(o._id))) === null || _f === void 0 ? void 0 : _f.profileCount) || 0,
        });
    }).sort((a, b) => (b.profileCount || 0) - (a.profileCount || 0) || b.count - a.count || a.id.localeCompare(b.id)).slice(0, 20);
    // ==================== USER ACTIVITY & ENGAGEMENT ====================
    // Build scoped filters for Visited, Review, and OfferRedemption
    const visitedFilter = {};
    const reviewFilter = {};
    const redemptionFilter = {};
    if (dateRange) {
        visitedFilter.visitedAt = dateRange;
        reviewFilter.createdAt = dateRange;
        redemptionFilter.redemptionTime = dateRange;
    }
    if (query.entityType === 'place' && isObjectId(query.entityId)) {
        const oid = new mongoose_1.default.Types.ObjectId(query.entityId);
        visitedFilter.place = oid;
        reviewFilter.placeId = oid;
        redemptionFilter.offer = { $in: allowedOfferOids };
    }
    else if (query.entityType === 'business' && isObjectId(query.entityId)) {
        const oid = new mongoose_1.default.Types.ObjectId(query.entityId);
        visitedFilter.business = oid;
        reviewFilter.businessId = oid;
        redemptionFilter.offer = { $in: allowedOfferOids };
    }
    else if (query.entityType === 'map' && isObjectId(query.entityId)) {
        visitedFilter.place = { $in: allowedPlaceOids };
        reviewFilter.placeId = { $in: allowedPlaceOids };
        redemptionFilter.offer = { $in: allowedOfferOids };
    }
    else if (query.entityType === 'offer' && isObjectId(query.entityId)) {
        const oid = new mongoose_1.default.Types.ObjectId(query.entityId);
        redemptionFilter.offer = oid;
        if (placeFilter._id) {
            visitedFilter.place = placeFilter._id;
            reviewFilter.placeId = placeFilter._id;
        }
        else if (offerFilter.business) {
            visitedFilter.business = offerFilter.business;
            reviewFilter.businessId = offerFilter.business;
        }
    }
    else if (countryRegex || categoryOid) {
        const targetPlaceConditions = [];
        const targetReviewConditions = [];
        if (allowedPlaceOids.length > 0) {
            targetPlaceConditions.push({ place: { $in: allowedPlaceOids } });
            targetReviewConditions.push({ placeId: { $in: allowedPlaceOids } });
        }
        if (allowedBusinessOids.length > 0) {
            targetPlaceConditions.push({ business: { $in: allowedBusinessOids } });
            targetReviewConditions.push({ businessId: { $in: allowedBusinessOids } });
        }
        if (targetPlaceConditions.length > 0) {
            visitedFilter.$or = targetPlaceConditions;
            reviewFilter.$or = targetReviewConditions;
        }
        else {
            visitedFilter._id = { $in: [] };
            reviewFilter._id = { $in: [] };
        }
        if (allowedOfferOids.length > 0) {
            redemptionFilter.offer = { $in: allowedOfferOids };
        }
        else {
            redemptionFilter._id = { $in: [] };
        }
    }
    // Active user distinct query filters
    const activityEnd = Math.min(Date.now(), (_f = (_e = dateRange === null || dateRange === void 0 ? void 0 : dateRange.$lte) === null || _e === void 0 ? void 0 : _e.getTime()) !== null && _f !== void 0 ? _f : Date.now());
    const activityStart = (days) => {
        var _a, _b;
        return new Date(Math.max(activityEnd - days * 24 * 60 * 60 * 1000, (_b = (_a = dateRange === null || dateRange === void 0 ? void 0 : dateRange.$gte) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : 0));
    };
    const oneDayAgo = activityStart(1);
    const sevenDaysAgo = activityStart(7);
    const thirtyDaysAgo = activityStart(30);
    const usageEntityMatch = {};
    if (hasEntity) {
        if (['map', 'place', 'business'].includes(query.entityType)) {
            usageEntityMatch.type = query.entityType;
            usageEntityMatch.entityId = String(query.entityId);
        }
        else {
            usageEntityMatch._id = { $in: [] };
        }
    }
    else if (countryRegex || categoryOid) {
        const orConditions = [];
        if (allowedMapIds.length > 0) {
            orConditions.push({ type: 'map', entityId: { $in: allowedMapIds } });
        }
        if (allowedPlaceIds.length > 0) {
            orConditions.push({ type: 'place', entityId: { $in: allowedPlaceIds } });
        }
        if (allowedBusinessIds.length > 0) {
            orConditions.push({ type: 'business', entityId: { $in: allowedBusinessIds } });
        }
        if (orConditions.length > 0) {
            usageEntityMatch.$or = orConditions;
        }
        else {
            usageEntityMatch._id = { $in: [] };
        }
    }
    const visitedTimeMatch = (threshold) => ({
        ...visitedFilter,
        visitedAt: { $gte: threshold, ...((dateRange === null || dateRange === void 0 ? void 0 : dateRange.$lte) ? { $lte: dateRange.$lte } : {}) },
    });
    const reviewTimeMatch = (threshold) => ({
        ...reviewFilter,
        createdAt: { $gte: threshold, ...((dateRange === null || dateRange === void 0 ? void 0 : dateRange.$lte) ? { $lte: dateRange.$lte } : {}) },
    });
    const redemptionTimeMatch = (threshold) => ({
        ...redemptionFilter,
        redemptionTime: { $gte: threshold, ...((dateRange === null || dateRange === void 0 ? void 0 : dateRange.$lte) ? { $lte: dateRange.$lte } : {}) },
    });
    const usageTimeMatch = (threshold) => ({
        ...usageEntityMatch,
        lastSeenAt: { $gte: threshold, ...((dateRange === null || dateRange === void 0 ? void 0 : dateRange.$lte) ? { $lte: dateRange.$lte } : {}) },
    });
    // User registered filtering
    const userCountFilter = { status: { $ne: 'deleted' } };
    if (countryRegex) {
        userCountFilter['address.country'] = countryRegex;
    }
    const totalRegisteredUsers = await user_model_1.User.countDocuments(userCountFilter);
    const [usageKeysToday, usageKeysWeek, usageKeysMonth, visitedUsersToday, visitedUsersWeek, visitedUsersMonth, reviewUsersToday, reviewUsersWeek, reviewUsersMonth, redemptionUsersToday, redemptionUsersWeek, redemptionUsersMonth, updatedUsersToday, updatedUsersWeek, updatedUsersMonth, totalPlacesVisited, totalOffersRedeemed, totalReviews, recentVisits, recentReviews, recentRedemptions, recentUsers,] = await Promise.all([
        (0, usage_reporting_1.distinctViewers)(usageTimeMatch(oneDayAgo)),
        (0, usage_reporting_1.distinctViewers)(usageTimeMatch(sevenDaysAgo)),
        (0, usage_reporting_1.distinctViewers)(usageTimeMatch(thirtyDaysAgo)),
        visited_model_1.Visited.distinct('user', visitedTimeMatch(oneDayAgo)),
        visited_model_1.Visited.distinct('user', visitedTimeMatch(sevenDaysAgo)),
        visited_model_1.Visited.distinct('user', visitedTimeMatch(thirtyDaysAgo)),
        review_model_1.Review.distinct('reviewer', reviewTimeMatch(oneDayAgo)),
        review_model_1.Review.distinct('reviewer', reviewTimeMatch(sevenDaysAgo)),
        review_model_1.Review.distinct('reviewer', reviewTimeMatch(thirtyDaysAgo)),
        offerRedemption_model_1.OfferRedemption.distinct('user', redemptionTimeMatch(oneDayAgo)),
        offerRedemption_model_1.OfferRedemption.distinct('user', redemptionTimeMatch(sevenDaysAgo)),
        offerRedemption_model_1.OfferRedemption.distinct('user', redemptionTimeMatch(thirtyDaysAgo)),
        hasEntity || categoryOid ? Promise.resolve([]) : user_model_1.User.distinct('_id', { lastActiveAt: { $gte: oneDayAgo, $lte: new Date(activityEnd) }, ...userCountFilter }),
        hasEntity || categoryOid ? Promise.resolve([]) : user_model_1.User.distinct('_id', { lastActiveAt: { $gte: sevenDaysAgo, $lte: new Date(activityEnd) }, ...userCountFilter }),
        hasEntity || categoryOid ? Promise.resolve([]) : user_model_1.User.distinct('_id', { lastActiveAt: { $gte: thirtyDaysAgo, $lte: new Date(activityEnd) }, ...userCountFilter }),
        visited_model_1.Visited.countDocuments(visitedFilter),
        offerRedemption_model_1.OfferRedemption.countDocuments(redemptionFilter),
        review_model_1.Review.countDocuments(reviewFilter),
        visited_model_1.Visited.find(visitedFilter)
            .sort({ visitedAt: -1 })
            .limit(10)
            .populate('user', 'name email profile')
            .populate('place', 'name')
            .populate('business', 'name')
            .lean(),
        review_model_1.Review.find(reviewFilter)
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('reviewer', 'name email profile')
            .populate('placeId', 'name')
            .populate('businessId', 'name')
            .lean(),
        offerRedemption_model_1.OfferRedemption.find(redemptionFilter)
            .sort({ redemptionTime: -1 })
            .limit(10)
            .populate('user', 'name email profile')
            .populate('offer', 'title')
            .lean(),
        hasEntity
            ? Promise.resolve([])
            : user_model_1.User.find({ ...userCountFilter, ...(dateRange ? { createdAt: dateRange } : {}) })
                .sort({ createdAt: -1 })
                .limit(8)
                .select('name email profile createdAt role')
                .lean(),
    ]);
    const activeTodaySet = new Set();
    usageKeysToday.forEach((k) => activeTodaySet.add(String(k)));
    visitedUsersToday.forEach((u) => activeTodaySet.add(`user:${String(u)}`));
    reviewUsersToday.forEach((u) => activeTodaySet.add(`user:${String(u)}`));
    redemptionUsersToday.forEach((u) => activeTodaySet.add(`user:${String(u)}`));
    updatedUsersToday.forEach((u) => activeTodaySet.add(`user:${String(u)}`));
    const activeWeekSet = new Set();
    usageKeysWeek.forEach((k) => activeWeekSet.add(String(k)));
    visitedUsersWeek.forEach((u) => activeWeekSet.add(`user:${String(u)}`));
    reviewUsersWeek.forEach((u) => activeWeekSet.add(`user:${String(u)}`));
    redemptionUsersWeek.forEach((u) => activeWeekSet.add(`user:${String(u)}`));
    updatedUsersWeek.forEach((u) => activeWeekSet.add(`user:${String(u)}`));
    const activeMonthSet = new Set();
    usageKeysMonth.forEach((k) => activeMonthSet.add(String(k)));
    visitedUsersMonth.forEach((u) => activeMonthSet.add(`user:${String(u)}`));
    reviewUsersMonth.forEach((u) => activeMonthSet.add(`user:${String(u)}`));
    redemptionUsersMonth.forEach((u) => activeMonthSet.add(`user:${String(u)}`));
    updatedUsersMonth.forEach((u) => activeMonthSet.add(`user:${String(u)}`));
    const viewedPlaceScope = hasEntity && query.entityType === 'map'
        ? { type: 'place', entityId: { $in: allowedPlaceIds } }
        : hasEntity && query.entityType === 'offer'
            ? { $or: [
                    { type: 'place', entityId: { $in: allowedPlaceIds } },
                    { type: 'business', entityId: (usagePlace === null || usagePlace === void 0 ? void 0 : usagePlace.id) || '' },
                ] }
            : usageEntityMatch;
    const recentActivities = await (0, recent_place_views_1.recentPlaceViews)({
        ...viewedPlaceScope, ...(dateRange ? { lastSeenAt: dateRange } : {}),
    });
    recentVisits.forEach((v) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        recentActivities.push({
            id: String(v._id),
            type: 'visit',
            userId: ((_a = v.user) === null || _a === void 0 ? void 0 : _a._id) ? String(v.user._id) : (v.user ? String(v.user) : undefined),
            userName: ((_b = v.user) === null || _b === void 0 ? void 0 : _b.name) || 'Explorer',
            userEmail: (_c = v.user) === null || _c === void 0 ? void 0 : _c.email,
            userProfile: (_d = v.user) === null || _d === void 0 ? void 0 : _d.profile,
            title: 'Visited Place',
            subtitle: ((_e = v.place) === null || _e === void 0 ? void 0 : _e.name)
                ? (0, localize_1.localizeField)(v.place.name)
                : ((_f = v.business) === null || _f === void 0 ? void 0 : _f.name)
                    ? (0, localize_1.localizeField)(v.business.name)
                    : undefined,
            targetId: ((_g = v.place) === null || _g === void 0 ? void 0 : _g._id) ? String(v.place._id) : ((_h = v.business) === null || _h === void 0 ? void 0 : _h._id) ? String(v.business._id) : undefined,
            targetType: ((_j = v.place) === null || _j === void 0 ? void 0 : _j._id) ? 'place' : 'business',
            timestamp: v.visitedAt || v.createdAt,
        });
    });
    recentReviews.forEach((r) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        recentActivities.push({
            id: String(r._id),
            type: 'review',
            userId: ((_a = r.reviewer) === null || _a === void 0 ? void 0 : _a._id) ? String(r.reviewer._id) : (r.reviewer ? String(r.reviewer) : undefined),
            userName: ((_b = r.reviewer) === null || _b === void 0 ? void 0 : _b.name) || 'Explorer',
            userEmail: (_c = r.reviewer) === null || _c === void 0 ? void 0 : _c.email,
            userProfile: (_d = r.reviewer) === null || _d === void 0 ? void 0 : _d.profile,
            title: `Submitted a ${r.rating || 5}★ Review`,
            subtitle: ((_e = r.placeId) === null || _e === void 0 ? void 0 : _e.name)
                ? (0, localize_1.localizeField)(r.placeId.name)
                : ((_f = r.businessId) === null || _f === void 0 ? void 0 : _f.name)
                    ? (0, localize_1.localizeField)(r.businessId.name)
                    : undefined,
            targetId: ((_g = r.placeId) === null || _g === void 0 ? void 0 : _g._id) ? String(r.placeId._id) : ((_h = r.businessId) === null || _h === void 0 ? void 0 : _h._id) ? String(r.businessId._id) : undefined,
            targetType: ((_j = r.placeId) === null || _j === void 0 ? void 0 : _j._id) ? 'place' : 'business',
            timestamp: r.createdAt,
        });
    });
    recentRedemptions.forEach((red) => {
        var _a, _b, _c, _d, _e, _f;
        recentActivities.push({
            id: String(red._id),
            type: 'redemption',
            userId: ((_a = red.user) === null || _a === void 0 ? void 0 : _a._id) ? String(red.user._id) : (red.user ? String(red.user) : undefined),
            userName: ((_b = red.user) === null || _b === void 0 ? void 0 : _b.name) || 'Explorer',
            userEmail: (_c = red.user) === null || _c === void 0 ? void 0 : _c.email,
            userProfile: (_d = red.user) === null || _d === void 0 ? void 0 : _d.profile,
            title: 'Redeemed Special Offer',
            subtitle: ((_e = red.offer) === null || _e === void 0 ? void 0 : _e.title) ? (0, localize_1.localizeField)(red.offer.title) : undefined,
            targetId: ((_f = red.offer) === null || _f === void 0 ? void 0 : _f._id) ? String(red.offer._id) : undefined,
            targetType: 'offer',
            timestamp: red.redemptionTime || red.createdAt,
        });
    });
    recentUsers.forEach((u) => {
        recentActivities.push({
            id: String(u._id),
            type: 'registration',
            userId: String(u._id),
            userName: u.name || 'New Explorer',
            userEmail: u.email,
            userProfile: u.profile,
            title: 'Joined Roadtripeado',
            subtitle: u.role ? `Role: ${u.role}` : undefined,
            timestamp: u.createdAt,
        });
    });
    recentActivities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    // Query active users to enable profile inspection on statistics page
    const todayUserIds = new Set();
    usageKeysToday.forEach((key) => {
        const id = String(key).startsWith('user:') ? String(key).slice(5) : '';
        if (mongoose_1.default.Types.ObjectId.isValid(id))
            todayUserIds.add(id);
    });
    visitedUsersToday.forEach((u) => u && todayUserIds.add(String(u)));
    reviewUsersToday.forEach((u) => u && todayUserIds.add(String(u)));
    redemptionUsersToday.forEach((u) => u && todayUserIds.add(String(u)));
    updatedUsersToday.forEach((u) => u && todayUserIds.add(String(u)));
    const weekUserIds = new Set();
    usageKeysWeek.forEach((key) => {
        const id = String(key).startsWith('user:') ? String(key).slice(5) : '';
        if (mongoose_1.default.Types.ObjectId.isValid(id))
            weekUserIds.add(id);
    });
    visitedUsersWeek.forEach((u) => u && weekUserIds.add(String(u)));
    reviewUsersWeek.forEach((u) => u && weekUserIds.add(String(u)));
    redemptionUsersWeek.forEach((u) => u && weekUserIds.add(String(u)));
    updatedUsersWeek.forEach((u) => u && weekUserIds.add(String(u)));
    const monthUserIds = new Set();
    usageKeysMonth.forEach((key) => {
        const id = String(key).startsWith('user:') ? String(key).slice(5) : '';
        if (mongoose_1.default.Types.ObjectId.isValid(id))
            monthUserIds.add(id);
    });
    visitedUsersMonth.forEach((u) => u && monthUserIds.add(String(u)));
    reviewUsersMonth.forEach((u) => u && monthUserIds.add(String(u)));
    redemptionUsersMonth.forEach((u) => u && monthUserIds.add(String(u)));
    updatedUsersMonth.forEach((u) => u && monthUserIds.add(String(u)));
    // Inherit subsets: today is part of week, week is part of month
    todayUserIds.forEach((id) => {
        weekUserIds.add(id);
        monthUserIds.add(id);
    });
    weekUserIds.forEach((id) => {
        monthUserIds.add(id);
    });
    const allActiveUserIds = new Set([
        ...Array.from(monthUserIds),
        ...Array.from(weekUserIds),
        ...Array.from(todayUserIds),
    ]);
    const validObjectIds = Array.from(allActiveUserIds)
        .filter((id) => mongoose_1.default.Types.ObjectId.isValid(id))
        .map((id) => new mongoose_1.default.Types.ObjectId(id));
    let activeUsersDocs = [];
    if (validObjectIds.length > 0) {
        activeUsersDocs = await user_model_1.User.find({ _id: { $in: validObjectIds }, status: { $ne: 'deleted' } })
            .select('name email profile role level points lastActiveAt updatedAt createdAt')
            .sort({ lastActiveAt: -1, updatedAt: -1 })
            .lean();
    }
    const formatUserSummary = (u) => {
        const id = String(u._id);
        const isToday = todayUserIds.has(id);
        const isWeek = isToday || weekUserIds.has(id);
        const isMonth = isWeek || monthUserIds.has(id);
        const periods = ['all'];
        if (isMonth)
            periods.push('month');
        if (isWeek)
            periods.push('week');
        if (isToday)
            periods.push('today');
        return {
            _id: id,
            name: u.name || 'Explorer',
            email: u.email || '',
            profile: u.profile || '',
            role: u.role || 'user',
            level: u.level || 0,
            points: u.points || 0,
            lastActive: u.lastActiveAt || u.updatedAt || u.createdAt || new Date(),
            isActiveToday: isToday,
            isActiveWeek: isWeek,
            isActiveMonth: isMonth,
            periods,
        };
    };
    const activeUsersList = activeUsersDocs.map(formatUserSummary);
    const activeTodayList = activeUsersList.filter((u) => u.isActiveToday);
    const activeWeekList = activeUsersList.filter((u) => u.isActiveWeek);
    const activeMonthList = activeUsersList.filter((u) => u.isActiveMonth);
    const userActivity = {
        activeUsersToday: activeTodayList.length,
        guestVisitorsToday: [...activeTodaySet].filter(key => !key.startsWith('user:')).length,
        guestVisitorsThisWeek: [...activeWeekSet].filter(key => !key.startsWith('user:')).length,
        guestVisitorsThisMonth: [...activeMonthSet].filter(key => !key.startsWith('user:')).length,
        activeUsersThisWeek: activeWeekList.length,
        activeUsersThisMonth: activeMonthList.length,
        totalRegisteredUsers,
        totalPlacesVisited,
        totalOffersRedeemed,
        totalReviews,
        recentActivities: recentActivities.slice(0, 25),
        activeUsersList,
        activeTodayList,
        activeWeekList,
        activeMonthList,
    };
    return {
        salesAndTaxes: {
            totalSales,
            taxesCollected,
            netRevenue,
            monthlyData,
        },
        usage: {
            mostViewedMaps,
            mostOpenedPlaces,
            mostRedeemedOffers,
        },
        userActivity,
    };
};
const getEntityUsers = async (type, id, timeFilter) => {
    if (!mongoose_1.default.isValidObjectId(id) || !['place', 'business', 'map', 'offer'].includes(type)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid report entity');
    }
    const dateRange = timeFilter ? getDateRangeQuery(timeFilter) : null;
    const normType = String(type || '').trim().toLowerCase();
    if (normType === 'place' || normType === 'business' || normType === 'map') {
        const viewList = await (0, usage_reporting_1.entityViewers)(normType, id, dateRange);
        const authViewerIds = viewList
            .filter((v) => v.viewerKey && v.viewerKey.startsWith('user:'))
            .map((v) => v.viewerKey.replace('user:', ''))
            .filter((viewerId) => mongoose_1.default.isValidObjectId(viewerId));
        const guestCount = viewList.filter((v) => !v.viewerKey || !v.viewerKey.startsWith('user:')).length;
        const userMap = new globalThis.Map();
        if (authViewerIds.length > 0) {
            const viewerUsers = await user_model_1.User.find({ _id: { $in: authViewerIds }, status: { $ne: 'deleted' } })
                .select('name email profile role level points')
                .lean();
            const viewerUserMap = new globalThis.Map(viewerUsers.map(u => [String(u._id), u]));
            viewList.forEach((v) => {
                if (v.viewerKey && v.viewerKey.startsWith('user:')) {
                    const uId = v.viewerKey.replace('user:', '');
                    if (!userMap.has(uId) && viewerUserMap.has(uId)) {
                        const u = viewerUserMap.get(uId);
                        userMap.set(uId, {
                            _id: uId,
                            name: u.name || 'Anonymous User',
                            email: u.email,
                            profile: u.profile,
                            role: u.role,
                            level: u.level || 1,
                            points: u.points || 0,
                            date: v.lastSeenAt || v.updatedAt,
                            action: 'Viewed',
                        });
                    }
                }
            });
        }
        const users = Array.from(userMap.values());
        return {
            users,
            totalCount: viewList.length,
            profileCount: users.length,
            countMetric: 'unique_viewers',
            unavailableCount: new Set(viewList.filter((v) => { var _a; return (_a = v.viewerKey) === null || _a === void 0 ? void 0 : _a.startsWith('user:'); }).map((v) => v.viewerKey)).size - users.length,
            guestCount,
        };
    }
    if (normType === 'offer') {
        const redemptions = await offerRedemption_model_1.OfferRedemption.find({ offer: id, ...(dateRange ? { redemptionTime: dateRange } : {}) })
            .populate({ path: 'user', select: 'name email profile role level points', match: { status: { $ne: 'deleted' } } })
            .sort({ redemptionTime: -1, createdAt: -1 })
            .lean();
        const users = redemptions
            .filter((r) => r.user && r.user._id)
            .map((r) => ({
            _id: String(r.user._id),
            name: r.user.name || 'Anonymous User',
            email: r.user.email,
            profile: r.user.profile,
            role: r.user.role,
            level: r.user.level || 1,
            points: r.user.points || 0,
            date: r.redemptionTime || r.createdAt,
            action: 'Redeemed',
        }));
        // Redemptions are newest first; retain each person's latest redemption.
        const uniqueUsers = new globalThis.Map();
        users.forEach(user => {
            if (!uniqueUsers.has(user._id))
                uniqueUsers.set(user._id, { ...user, redemptionCount: 0 });
            const summary = uniqueUsers.get(user._id);
            summary.redemptionCount += 1;
        });
        return {
            users: Array.from(uniqueUsers.values()),
            totalCount: redemptions.length,
            profileCount: uniqueUsers.size,
            unavailableRedemptions: redemptions.filter((r) => !r.user).length,
            countMetric: 'redemptions',
            guestCount: 0,
        };
    }
    return { users: [], totalCount: 0, guestCount: 0 };
};
// Separate paginated query keeps the report response bounded without hiding accounts.
const getRegisteredUsers = async (query) => {
    const page = Math.max(1, Math.min(1000000, Math.floor(Number(query.page) || 1)));
    const limit = 25;
    const filter = { status: { $ne: 'deleted' } };
    if (typeof query.country === 'string' && query.country.trim()) {
        filter['address.country'] = new RegExp(`^${escapeRegex(query.country.trim())}$`, 'i');
    }
    if (typeof query.search === 'string' && query.search.trim()) {
        const search = new RegExp(escapeRegex(query.search.trim().slice(0, 200)), 'i');
        filter.$or = [{ name: search }, { email: search }, { role: search }];
    }
    const [total, users] = await Promise.all([
        user_model_1.User.countDocuments(filter),
        user_model_1.User.find(filter).select('name email profile role level points lastActiveAt createdAt')
            .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    return { users: users.map(u => ({ ...u, name: u.name || 'Explorer', email: u.email || '', lastActive: u.lastActiveAt || u.createdAt })),
        page, limit, total, totalPages: Math.ceil(total / limit) };
};
exports.StatsService = {
    getRegisteredUsers,
    getDashboardData,
    getReportsData,
    searchReportEntities,
    getEntityUsers,
};
