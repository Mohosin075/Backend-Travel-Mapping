"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserServices = exports.getProfile = void 0;
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const user_model_1 = require("./user.model");
const mongoose_1 = require("mongoose");
const user_1 = require("../../enum/user");
const paginationHelper_1 = require("../../helpers/paginationHelper");
const config_1 = __importDefault(require("../../config"));
const user_constants_1 = require("./user.constants");
const crypto_1 = require("../../utils/crypto");
const review_model_1 = require("../review/review.model");
const emailTemplate_1 = require("../../shared/emailTemplate");
const emailHelper_1 = require("../../helpers/emailHelper");
const notification_integration_1 = require("../notification/notification.integration");
const offerRedemption_model_1 = require("../offer/offerRedemption.model");
const award_model_1 = require("../award/award.model");
require("../award/awardConfig.model");
const levelConfig_service_1 = require("../award/levelConfig.service");
const visited_model_1 = require("../visited/visited.model");
const map_model_1 = require("../map/map.model");
const place_model_1 = require("../place/place.model");
require("../business/business.model");
require("../offer/offer.model");
const localize_1 = require("../../helpers/localize");
const updateProfile = async (user, payload) => {
    console.log({ payload });
    const isUserExist = await user_model_1.User.findOne({
        _id: user.authId,
        status: { $nin: [user_1.USER_STATUS.DELETED] },
    });
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    const updateData = { ...payload };
    if (updateData.profileStatus !== undefined) {
        updateData['settings.profileStatus'] = updateData.profileStatus;
        delete updateData.profileStatus;
    }
    if (updateData.city !== undefined) {
        updateData['address.city'] = updateData.city;
        delete updateData.city;
    }
    const updatedProfile = await user_model_1.User.findOneAndUpdate({ _id: user.authId, status: { $nin: [user_1.USER_STATUS.DELETED] } }, {
        $set: updateData,
    }, { new: true });
    if (!updatedProfile) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to update profile.');
    }
    return 'Profile updated successfully.';
};
const createAdmin = async () => {
    const admin = {
        email: config_1.default.super_admin.email,
        name: config_1.default.super_admin.name,
        password: config_1.default.super_admin.password,
        role: user_1.USER_ROLES.SUPER_ADMIN,
        status: user_1.USER_STATUS.ACTIVE,
        verified: true,
        authentication: {
            oneTimeCode: null,
            restrictionLeftAt: null,
            expiresAt: null,
            latestRequestAt: new Date(),
            authType: 'createAccount',
        },
    };
    const isAdminExist = await user_model_1.User.findOne({
        email: admin.email,
        status: { $nin: [user_1.USER_STATUS.DELETED] },
    });
    if (isAdminExist) {
        console.log('Admin account already exist, skipping creation.🦥');
        return isAdminExist;
    }
    const result = await user_model_1.User.create([admin]);
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to create admin');
    }
    return result[0];
};
const getAllUsers = async (paginationOptions, filterables = {}) => {
    const { searchTerm, ...filterData } = filterables;
    const { page, skip, limit, sortBy, sortOrder } = paginationHelper_1.paginationHelper.calculatePagination(paginationOptions);
    let whereConditions = {};
    // 🔥 FIXED: Properly typed arrays
    const searchConditions = [];
    const filterConditions = [];
    // Search functionality
    if (searchTerm && searchTerm.trim() !== '') {
        searchConditions.push({
            $or: user_constants_1.userFilterableFields.map(field => ({
                [field]: {
                    $regex: searchTerm.trim(),
                    $options: 'i',
                },
            })),
        });
    }
    // Filter functionality
    if (Object.keys(filterData).length > 0) {
        Object.entries(filterData).forEach(([key, value]) => {
            if (value !== undefined && value !== '') {
                if (key !== 'status') {
                    filterConditions.push({ [key]: value });
                }
            }
        });
    }
    // Handle status filtering (allows retrieving deleted users if explicitly requested)
    if (filterData.status) {
        filterConditions.push({ status: filterData.status });
    }
    else {
        // Default: Exclude deleted and null status users if no status is specified
        filterConditions.push({
            status: { $nin: [user_1.USER_STATUS.DELETED, null] },
        });
    }
    // Combine conditions
    if (searchConditions.length > 0 && filterConditions.length > 0) {
        whereConditions = {
            $and: [...searchConditions, ...filterConditions],
        };
    }
    else if (searchConditions.length > 0) {
        whereConditions = { $and: searchConditions };
    }
    else if (filterConditions.length > 0) {
        whereConditions = { $and: filterConditions };
    }
    const [users, total] = await Promise.all([
        user_model_1.User.find(whereConditions)
            .skip(skip)
            .limit(limit)
            .sort(sortBy ? { [sortBy]: sortOrder } : { createdAt: -1 })
            .select('-password -authentication -__v')
            .lean(),
        user_model_1.User.countDocuments(whereConditions),
    ]);
    const levelConfigs = await levelConfig_service_1.LevelConfigServices.getAllLevelConfigs();
    const result = users.map(user => {
        const pts = user.points || 0;
        const revs = user.totalReviewsApproved || 0;
        const levelInfo = levelConfig_service_1.LevelConfigServices.calculateDynamicLevelFromList(pts, revs, levelConfigs);
        return {
            ...user,
            level: levelInfo.levelNumber,
            levelInfo,
        };
    });
    return {
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            totalPage: Math.ceil(total / limit),
        },
        data: result,
    };
};
const deleteUser = async (userId, actor) => {
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    const isUserExist = await user_model_1.User.findOne({
        _id: userId,
        status: { $nin: [user_1.USER_STATUS.DELETED] },
    });
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    assertCanDeleteUser(actor === null || actor === void 0 ? void 0 : actor.role, isUserExist.role);
    const deletedUser = await user_model_1.User.findOneAndUpdate({ _id: userId, status: { $nin: [user_1.USER_STATUS.DELETED] } }, { $set: { status: user_1.USER_STATUS.DELETED } }, { new: true });
    if (!deletedUser) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to delete user.');
    }
    return 'User deleted successfully.';
};
const deleteProfile = async (userId, password) => {
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    const isUserExist = await user_model_1.User.findOne({
        _id: userId,
        status: { $nin: [user_1.USER_STATUS.DELETED] },
    }).select('+password');
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    const isPasswordMatched = await user_model_1.User.isPasswordMatched(password, isUserExist.password);
    if (!isPasswordMatched) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'Password is incorrect.');
    }
    const deletedUser = await user_model_1.User.findOneAndUpdate({ _id: userId, status: { $nin: [user_1.USER_STATUS.DELETED] } }, { $set: { status: user_1.USER_STATUS.DELETED } }, { new: true });
    if (!deletedUser) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to delete profile.');
    }
    return 'Profile deleted successfully.';
};
const getUserById = async (userId) => {
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    const user = await user_model_1.User.findOne({
        _id: userId,
        status: { $nin: [user_1.USER_STATUS.DELETED] },
    })
        .select('-password -authentication -__v')
        .populate('purchasedMaps', 'name country images coverPhoto price description')
        .populate('deactivatedMaps', 'name country images coverPhoto price description')
        .populate('favoriteMaps', 'name country images')
        .populate('assignedMaps', 'name country')
        .populate('redeemedFreeMap', 'name country')
        .populate('redeemedFreeMaps', 'name country')
        .lean();
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    // Calculate dynamic level info synchronized with settings on rewards page
    const points = user.points || 0;
    const approvedReviews = user.totalReviewsApproved || 0;
    const levelInfo = await levelConfig_service_1.LevelConfigServices.getDynamicUserLevel(points, approvedReviews);
    // Keep stored user.level in sync if it differed
    if (user.level !== levelInfo.levelNumber) {
        user_model_1.User.findByIdAndUpdate(userId, {
            $set: { level: levelInfo.levelNumber },
        })
            .exec()
            .catch(() => { });
    }
    // Fetch claimed offer redemptions
    const offerRedemptions = await offerRedemption_model_1.OfferRedemption.find({ user: userId })
        .populate({
        path: 'offer',
        populate: { path: 'place business', select: 'name' },
    })
        .sort({ createdAt: -1 })
        .lean();
    // Fetch unlocked and in-progress awards/badges
    const awards = await award_model_1.Award.find({ userId })
        .populate('configId')
        .sort({ createdAt: -1 })
        .lean();
    // Fetch user's submitted reviews
    const reviews = await review_model_1.Review.find({ reviewer: userId })
        .populate('placeId', 'name')
        .populate('businessId', 'name')
        .sort({ createdAt: -1 })
        .lean();
    // Fetch user's visited places (Issue 4: places viewed/visited)
    const visitedPlaces = await visited_model_1.Visited.find({ user: userId })
        .populate('place', 'name address location media country category')
        .populate('business', 'name location')
        .sort({ visitedAt: -1 })
        .lean();
    // Compute last activity and activity summary
    const activityTimestamps = [
        user.updatedAt ? new Date(user.updatedAt).getTime() : 0,
        user.createdAt ? new Date(user.createdAt).getTime() : 0,
        ...visitedPlaces.map((v) => (v.visitedAt ? new Date(v.visitedAt).getTime() : 0)),
        ...reviews.map((r) => (r.createdAt ? new Date(r.createdAt).getTime() : 0)),
        ...offerRedemptions.map((o) => (o.redemptionTime || o.createdAt ? new Date(o.redemptionTime || o.createdAt).getTime() : 0)),
    ].filter(t => t > 0);
    const lastActivityAt = activityTimestamps.length > 0
        ? new Date(Math.max(...activityTimestamps))
        : user.updatedAt || user.createdAt;
    // Build unified chronological activity timeline
    const activityTimeline = [];
    visitedPlaces.slice(0, 20).forEach((v) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        activityTimeline.push({
            type: 'place_visit',
            title: 'Visited Place',
            name: ((_a = v.place) === null || _a === void 0 ? void 0 : _a.name)
                ? ((0, localize_1.localizeField)(v.place.name, 'en') || (0, localize_1.localizeField)(v.place.name, 'es') || (typeof v.place.name === 'string' ? v.place.name : ''))
                : ((_b = v.business) === null || _b === void 0 ? void 0 : _b.name)
                    ? ((0, localize_1.localizeField)(v.business.name, 'en') || (0, localize_1.localizeField)(v.business.name, 'es') || (typeof v.business.name === 'string' ? v.business.name : ''))
                    : 'Place',
            location: ((_c = v.place) === null || _c === void 0 ? void 0 : _c.address) || ((_d = v.place) === null || _d === void 0 ? void 0 : _d.country) || ((_f = (_e = v.business) === null || _e === void 0 ? void 0 : _e.location) === null || _f === void 0 ? void 0 : _f.city),
            media: (_h = (_g = v.place) === null || _g === void 0 ? void 0 : _g.media) === null || _h === void 0 ? void 0 : _h[0],
            targetId: ((_j = v.place) === null || _j === void 0 ? void 0 : _j._id) ? String(v.place._id) : ((_k = v.business) === null || _k === void 0 ? void 0 : _k._id) ? String(v.business._id) : undefined,
            targetType: ((_l = v.place) === null || _l === void 0 ? void 0 : _l._id) ? 'place' : 'business',
            timestamp: v.visitedAt || v.createdAt,
        });
    });
    reviews.slice(0, 15).forEach((r) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        activityTimeline.push({
            type: 'review_submitted',
            title: `Submitted a ${r.rating || 5}★ Review`,
            name: ((_a = r.placeId) === null || _a === void 0 ? void 0 : _a.name)
                ? ((0, localize_1.localizeField)(r.placeId.name, 'en') || (0, localize_1.localizeField)(r.placeId.name, 'es') || (typeof r.placeId.name === 'string' ? r.placeId.name : ''))
                : ((_b = r.businessId) === null || _b === void 0 ? void 0 : _b.name)
                    ? ((0, localize_1.localizeField)(r.businessId.name, 'en') || (0, localize_1.localizeField)(r.businessId.name, 'es') || (typeof r.businessId.name === 'string' ? r.businessId.name : ''))
                    : 'Place/Business',
            rating: r.rating,
            comment: typeof r.review === 'string' ? r.review : ((_c = r.review) === null || _c === void 0 ? void 0 : _c.en) || ((_d = r.review) === null || _d === void 0 ? void 0 : _d.es) || ((_e = r.review) === null || _e === void 0 ? void 0 : _e.comment) || '',
            targetId: ((_f = r.placeId) === null || _f === void 0 ? void 0 : _f._id) ? String(r.placeId._id) : ((_g = r.businessId) === null || _g === void 0 ? void 0 : _g._id) ? String(r.businessId._id) : undefined,
            targetType: ((_h = r.placeId) === null || _h === void 0 ? void 0 : _h._id) ? 'place' : 'business',
            timestamp: r.createdAt,
        });
    });
    offerRedemptions.slice(0, 15).forEach((o) => {
        var _a, _b, _c, _d, _e, _f;
        activityTimeline.push({
            type: 'offer_claimed',
            title: 'Claimed Special Offer',
            name: ((_a = o.offer) === null || _a === void 0 ? void 0 : _a.title)
                ? ((0, localize_1.localizeField)(o.offer.title, 'en') || (0, localize_1.localizeField)(o.offer.title, 'es') || (typeof o.offer.title === 'string' ? o.offer.title : ''))
                : 'Special Offer',
            businessName: ((_c = (_b = o.offer) === null || _b === void 0 ? void 0 : _b.business) === null || _c === void 0 ? void 0 : _c.name)
                ? ((0, localize_1.localizeField)(o.offer.business.name, 'en') || (0, localize_1.localizeField)(o.offer.business.name, 'es') || (typeof o.offer.business.name === 'string' ? o.offer.business.name : ''))
                : ((_e = (_d = o.offer) === null || _d === void 0 ? void 0 : _d.place) === null || _e === void 0 ? void 0 : _e.name)
                    ? ((0, localize_1.localizeField)(o.offer.place.name, 'en') || (0, localize_1.localizeField)(o.offer.place.name, 'es') || (typeof o.offer.place.name === 'string' ? o.offer.place.name : ''))
                    : undefined,
            targetId: ((_f = o.offer) === null || _f === void 0 ? void 0 : _f._id) ? String(o.offer._id) : undefined,
            targetType: 'offer',
            timestamp: o.redemptionTime || o.createdAt,
        });
    });
    activityTimeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const activitySummary = {
        totalPlacesVisited: visitedPlaces.length,
        totalReviewsSubmitted: reviews.length,
        totalOffersClaimed: offerRedemptions.length,
        totalMapsActivated: (user.purchasedMaps || []).length,
        lastActivityAt,
    };
    return {
        ...user,
        level: levelInfo.levelNumber,
        levelInfo,
        offerRedemptions,
        awards,
        reviews,
        visitedPlaces,
        activitySummary,
        activityTimeline,
    };
};
/** Public, shareable profile — safe fields only */
const getPublicProfile = async (userId) => {
    var _a;
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    const user = await user_model_1.User.findOne({
        _id: userId,
        status: user_1.USER_STATUS.ACTIVE,
        verified: true,
    }).select('name profile level points role createdAt website instagram description specialty settings.profileStatus visitedPlacesCount address');
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Profile not found.');
    }
    if (((_a = user.settings) === null || _a === void 0 ? void 0 : _a.profileStatus) === 'private') {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'This profile is private.');
    }
    // Fetch user's approved reviews with place/business names
    const reviews = await review_model_1.Review.find({
        reviewer: userId,
        status: 'Approved',
    })
        .populate('placeId', 'name media address')
        .populate('businessId', 'name media.photos location')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
    // Fetch approved tourist spots discovered by this user
    const discoveredPlaces = await place_model_1.Place.find({
        discoveredBy: userId,
        status: 'Published',
    })
        .select('name media address rating totalReview category map createdAt')
        .populate('category', 'name icon color')
        .populate('map', 'name country')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
    const points = user.points || 0;
    const approvedReviews = user.totalReviewsApproved || 0;
    const levelInfo = await levelConfig_service_1.LevelConfigServices.getDynamicUserLevel(points, approvedReviews);
    return {
        ...user.toObject(),
        level: levelInfo.levelNumber,
        levelInfo,
        reviews,
        discoveredPlaces,
        approvedRecommendedPlacesCount: discoveredPlaces.length,
    };
};
const updateUserStatus = async (userId, status, actor) => {
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    const isUserExist = await user_model_1.User.findOne({
        _id: userId,
        status: { $nin: [user_1.USER_STATUS.DELETED] },
    });
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    // Admin cannot change super_admin status
    if (isUserExist.role === user_1.USER_ROLES.SUPER_ADMIN &&
        (actor === null || actor === void 0 ? void 0 : actor.role) !== user_1.USER_ROLES.SUPER_ADMIN) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Only Super Admin can update Super Admin status.');
    }
    const updatedUser = await user_model_1.User.findOneAndUpdate({ _id: userId, status: { $nin: [user_1.USER_STATUS.DELETED] } }, { $set: { status } }, { new: true });
    if (!updatedUser) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to update user status.');
    }
    return 'User status updated successfully.';
};
const assertCanAssignRole = (actorRole, targetRole, existingRole) => {
    if (!actorRole) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'You are not authorized.');
    }
    // Only super_admin can create / manage super_admin
    if ((targetRole === user_1.USER_ROLES.SUPER_ADMIN ||
        existingRole === user_1.USER_ROLES.SUPER_ADMIN) &&
        actorRole !== user_1.USER_ROLES.SUPER_ADMIN) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Only Super Admin can manage Super Admin accounts.');
    }
    if (actorRole !== user_1.USER_ROLES.ADMIN &&
        actorRole !== user_1.USER_ROLES.SUPER_ADMIN) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You are not authorized.');
    }
};
const assertCanDeleteUser = (actorRole, targetRole) => {
    if (!actorRole) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'You are not authorized.');
    }
    if (!targetRole) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Target user role is missing.');
    }
    if (targetRole === user_1.USER_ROLES.SUPER_ADMIN) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Super Admin accounts cannot be deleted this way.');
    }
    if (actorRole === user_1.USER_ROLES.SUPER_ADMIN) {
        return;
    }
    if (actorRole === user_1.USER_ROLES.ADMIN) {
        // Admin can delete regular users and map editors only
        if (targetRole === user_1.USER_ROLES.USER ||
            targetRole === user_1.USER_ROLES.MAP_EDITOR) {
            return;
        }
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Admins cannot delete other admin accounts.');
    }
    throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You are not authorized.');
};
const updateUserRole = async (userId, role, assignedMaps, assignedCountries, actor) => {
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    const isUserExist = await user_model_1.User.findOne({
        _id: userId,
        status: { $nin: [user_1.USER_STATUS.DELETED] },
    });
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    assertCanAssignRole(actor === null || actor === void 0 ? void 0 : actor.role, role, isUserExist.role);
    const updateData = { role };
    if (role === user_1.USER_ROLES.MAP_EDITOR) {
        const maps = assignedMaps || [];
        const countries = assignedCountries || [];
        if (maps.length === 0 && countries.length === 0) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Map Editor must be assigned at least one map or country.');
        }
        updateData.assignedMaps = maps;
        updateData.assignedCountries = countries;
    }
    else {
        // Clear editor scope when leaving map_editor
        updateData.assignedMaps = [];
        updateData.assignedCountries = [];
    }
    const updatedUser = await user_model_1.User.findOneAndUpdate({ _id: userId, status: { $nin: [user_1.USER_STATUS.DELETED] } }, { $set: updateData }, { new: true });
    if (!updatedUser) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to update user role.');
    }
    return 'User role updated successfully.';
};
const inviteUser = async (payload, actor) => {
    const email = payload.email.toLowerCase().trim();
    assertCanAssignRole(actor === null || actor === void 0 ? void 0 : actor.role, payload.role);
    const isUserExist = await user_model_1.User.findOne({ email });
    if (isUserExist && isUserExist.verified) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'User with this email already exists and is verified.');
    }
    const otp = (0, crypto_1.generateOtp)();
    const otpExpiresIn = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for invitation
    const authentication = {
        oneTimeCode: otp,
        expiresAt: otpExpiresIn,
        latestRequestAt: new Date(),
        requestCount: 1,
        authType: 'createAccount',
    };
    const baseUpdate = {
        role: payload.role,
        status: user_1.USER_STATUS.ACTIVE,
        verified: false,
        authentication,
    };
    if (payload.role === user_1.USER_ROLES.MAP_EDITOR) {
        const maps = payload.assignedMaps || [];
        const countries = payload.assignedCountries || [];
        if (maps.length === 0 && countries.length === 0) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Map Editor must be assigned at least one map or country.');
        }
        baseUpdate.assignedMaps = maps;
        baseUpdate.assignedCountries = countries;
    }
    else {
        // Re-invite as non-editor — clear any previous editor scope
        baseUpdate.assignedMaps = [];
        baseUpdate.assignedCountries = [];
    }
    let user;
    if (isUserExist) {
        // Update existing unverified or deleted user
        user = await user_model_1.User.findOneAndUpdate({ email }, { $set: baseUpdate }, { new: true });
    }
    else {
        // Create new user
        user = await user_model_1.User.create({
            email,
            ...baseUpdate
        });
    }
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to invite user.');
    }
    // Send invitation email
    const invitationEmail = emailTemplate_1.emailTemplate.userInvitation({
        email: user.email,
        role: user.role,
        otp,
    });
    await emailHelper_1.emailHelper.sendEmail(invitationEmail);
    return 'User invited successfully.';
};
const getProfile = async (user) => {
    // --- Fetch user ---
    const isUserExist = await user_model_1.User.findOne({
        _id: user.authId,
        status: { $nin: [user_1.USER_STATUS.DELETED] },
    })
        .select('-authentication -password -__v')
        .populate('assignedMaps', 'name country')
        .populate('redeemedFreeMap', 'name country')
        .populate('redeemedFreeMaps', 'name country');
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    const points = isUserExist.points || 0;
    const approvedReviews = isUserExist.totalReviewsApproved || 0;
    const levelInfo = await levelConfig_service_1.LevelConfigServices.getDynamicUserLevel(points, approvedReviews);
    if (isUserExist.level !== levelInfo.levelNumber) {
        user_model_1.User.findByIdAndUpdate(user.authId, {
            $set: { level: levelInfo.levelNumber },
        })
            .exec()
            .catch(() => { });
    }
    const approvedRecommendedPlacesCount = await place_model_1.Place.countDocuments({
        discoveredBy: user.authId,
        $or: [
            { status: 'Published' },
            { isApproved: true },
            { pointsAwarded: { $gt: 0 } },
        ],
    });
    return {
        ...isUserExist.toObject(),
        level: levelInfo.levelNumber,
        levelInfo,
        approvedRecommendedPlacesCount,
    };
};
exports.getProfile = getProfile;
const addUserInterest = async (userId, interest) => {
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    const isUserExist = await user_model_1.User.findOne({
        _id: userId,
        status: { $nin: [user_1.USER_STATUS.DELETED] },
    });
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    const updatedUser = await user_model_1.User.findOneAndUpdate({ _id: userId, status: { $nin: [user_1.USER_STATUS.DELETED] } }, { $set: { interest } }, { new: true });
    if (!updatedUser) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to update user interest.');
    }
    return updatedUser;
};
const toggleFavoriteMap = async (userId, mapId) => {
    var _a;
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    if (!mongoose_1.Types.ObjectId.isValid(mapId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Map ID.');
    }
    const isUserExist = await user_model_1.User.findById(userId);
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    const isFavorite = (_a = isUserExist.favoriteMaps) === null || _a === void 0 ? void 0 : _a.includes(new mongoose_1.Types.ObjectId(mapId));
    const updateDoc = isFavorite
        ? {
            $pull: { favoriteMaps: mapId },
        }
        : {
            $addToSet: { favoriteMaps: mapId },
        };
    const result = await user_model_1.User.findByIdAndUpdate(userId, updateDoc, { new: true });
    return result;
};
const getFavoriteMaps = async (userId) => {
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    const user = await user_model_1.User.findById(userId)
        .populate({
        path: 'favoriteMaps',
        select: 'name country images isActive isPaid price rating totalReview createdAt description',
    })
        .lean();
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    return user.favoriteMaps || [];
};
const toggleFavoriteOffer = async (userId, offerId) => {
    var _a;
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    if (!mongoose_1.Types.ObjectId.isValid(offerId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Offer ID.');
    }
    const isUserExist = await user_model_1.User.findById(userId);
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    const isFavorite = (_a = isUserExist.favoriteOffers) === null || _a === void 0 ? void 0 : _a.includes(new mongoose_1.Types.ObjectId(offerId));
    if (isFavorite) {
        await user_model_1.User.findByIdAndUpdate(userId, {
            $pull: { favoriteOffers: offerId },
        });
        return 'Offer removed from favorites.';
    }
    else {
        await user_model_1.User.findByIdAndUpdate(userId, {
            $addToSet: { favoriteOffers: offerId },
        });
        return 'Offer added to favorites.';
    }
};
const getFavoriteOffers = async (userId) => {
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    const user = await user_model_1.User.findById(userId).populate({
        path: 'favoriteOffers',
        populate: { path: 'place' },
    });
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    return user.favoriteOffers || [];
};
const updatePointsAndLevel = async (userId, pointsToAdd) => {
    const user = await user_model_1.User.findById(userId);
    if (!user)
        return;
    const oldLevel = user.level || 0;
    const newPoints = (user.points || 0) + pointsToAdd;
    const newApprovedCount = user.totalReviewsApproved || 0;
    const levelInfo = await levelConfig_service_1.LevelConfigServices.getDynamicUserLevel(newPoints, newApprovedCount);
    const newLevel = levelInfo.levelNumber;
    await user_model_1.User.findByIdAndUpdate(userId, {
        $set: {
            points: newPoints,
            level: newLevel,
        },
    });
    if (newLevel > oldLevel) {
        notification_integration_1.NotificationIntegration.onLevelUnlocked({
            userId,
            newLevel,
            levelName: levelInfo.title || `Nivel ${newLevel}`,
            oldLevel,
        }).catch(err => console.error('Failed to notify level unlock:', err));
    }
};
const assignEditorAccess = async (userId, assignedMaps, assignedCountries) => {
    var _a, _b, _c;
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    const user = await user_model_1.User.findById(userId);
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    if (user.role !== user_1.USER_ROLES.MAP_EDITOR) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'User is not a MAP_EDITOR.');
    }
    const maps = (_b = assignedMaps !== null && assignedMaps !== void 0 ? assignedMaps : (_a = user.assignedMaps) === null || _a === void 0 ? void 0 : _a.map((id) => id.toString())) !== null && _b !== void 0 ? _b : [];
    const countries = (_c = assignedCountries !== null && assignedCountries !== void 0 ? assignedCountries : user.assignedCountries) !== null && _c !== void 0 ? _c : [];
    if (maps.length === 0 && countries.length === 0) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Map Editor must be assigned at least one map or country.');
    }
    const updateData = {};
    if (assignedMaps !== undefined) {
        updateData.assignedMaps = assignedMaps;
    }
    if (assignedCountries !== undefined) {
        updateData.assignedCountries = assignedCountries;
    }
    const updatedUser = await user_model_1.User.findByIdAndUpdate(userId, { $set: updateData }, { new: true, runValidators: true });
    return updatedUser;
};
const updateUserMapAccess = async (userId, mapId, action, actor) => {
    if (!mongoose_1.Types.ObjectId.isValid(userId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid User ID.');
    }
    if (!mongoose_1.Types.ObjectId.isValid(mapId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Map ID.');
    }
    const user = await user_model_1.User.findOne({
        _id: userId,
        status: { $nin: [user_1.USER_STATUS.DELETED] },
    });
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found.');
    }
    const map = await map_model_1.Map.findById(mapId);
    if (!map) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found.');
    }
    const mapObjectId = new mongoose_1.Types.ObjectId(mapId);
    let updateDoc = {};
    let message = '';
    if (action === 'deactivate' || action === 'remove') {
        // Remove from purchasedMaps, add to deactivatedMaps
        updateDoc = {
            $pull: { purchasedMaps: mapObjectId },
            $addToSet: { deactivatedMaps: mapObjectId },
        };
        message = 'Map access deactivated successfully.';
    }
    else if (action === 'reactivate' || action === 'grant') {
        // Add to purchasedMaps, remove from deactivatedMaps
        updateDoc = {
            $addToSet: { purchasedMaps: mapObjectId },
            $pull: { deactivatedMaps: mapObjectId },
        };
        message = 'Map access activated successfully.';
    }
    const updatedUser = await user_model_1.User.findByIdAndUpdate(userId, updateDoc, {
        new: true,
    })
        .select('-password -authentication -__v')
        .populate('purchasedMaps', 'name country images coverPhoto price description')
        .populate('deactivatedMaps', 'name country images coverPhoto price description');
    if (!updatedUser) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to update map access.');
    }
    return { message, user: updatedUser };
};
exports.UserServices = {
    updateProfile,
    createAdmin,
    getAllUsers,
    deleteUser,
    getUserById,
    getPublicProfile,
    updateUserStatus,
    updateUserRole,
    inviteUser,
    getProfile: exports.getProfile,
    deleteProfile,
    addUserInterest,
    toggleFavoriteMap,
    getFavoriteMaps,
    toggleFavoriteOffer,
    getFavoriteOffers,
    updatePointsAndLevel,
    assignEditorAccess,
    updateUserMapAccess,
};
