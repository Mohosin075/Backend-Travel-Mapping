"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewService = void 0;
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const review_model_1 = require("./review.model");
const mongoose_1 = __importDefault(require("mongoose"));
const user_model_1 = require("../user/user.model");
const place_model_1 = require("../place/place.model");
const business_model_1 = require("../business/business.model");
const map_model_1 = require("../map/map.model");
const user_1 = require("../../enum/user");
const paginationHelper_1 = require("../../helpers/paginationHelper");
const award_service_1 = require("../award/award.service");
const notification_integration_1 = require("../notification/notification.integration");
const autoTranslate_1 = require("../../utils/autoTranslate");
const levelConfig_service_1 = require("../award/levelConfig.service");
const ratingIncPipeline = (rating) => [
    {
        $set: {
            totalReview: { $add: [{ $ifNull: ['$totalReview', 0] }, 1] },
            rating: {
                $divide: [
                    {
                        $add: [
                            {
                                $multiply: [
                                    { $ifNull: ['$rating', 0] },
                                    { $ifNull: ['$totalReview', 0] },
                                ],
                            },
                            rating,
                        ],
                    },
                    { $add: [{ $ifNull: ['$totalReview', 0] }, 1] },
                ],
            },
        },
    },
];
const ratingDecPipeline = (rating) => [
    {
        $set: {
            rating: {
                $cond: [
                    { $lte: ['$totalReview', 1] },
                    0,
                    {
                        $divide: [
                            {
                                $subtract: [
                                    { $multiply: ['$rating', '$totalReview'] },
                                    rating,
                                ],
                            },
                            { $subtract: ['$totalReview', 1] },
                        ],
                    },
                ],
            },
            totalReview: {
                $cond: [
                    { $lte: ['$totalReview', 1] },
                    0,
                    { $subtract: ['$totalReview', 1] },
                ],
            },
        },
    },
];
const createReview = async (user, payload) => {
    payload.reviewer = user.authId;
    // Force review status to Pending on creation
    payload.status = 'Pending';
    payload.isVerified = false;
    payload.pointsEarned = 0;
    if (payload.review) {
        payload.review = await (0, autoTranslate_1.autoTranslateField)(payload.review);
    }
    const isUserExist = await user_model_1.User.findById(user.authId);
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found');
    }
    if (payload.placeId) {
        const isPlaceExist = await place_model_1.Place.findById(payload.placeId);
        if (!isPlaceExist) {
            // Fallback: Check if this ID is a Business (similar to PlaceService.getPlaceById fallback)
            const isBusinessExist = await business_model_1.Business.findById(payload.placeId);
            if (isBusinessExist) {
                payload.businessId = payload.placeId;
                delete payload.placeId;
                if (isBusinessExist.status !== 'Approved') {
                    throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Only approved businesses can be reviewed.');
                }
            }
            else {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
            }
        }
    }
    else if (payload.businessId) {
        const isBusinessExist = await business_model_1.Business.findById(payload.businessId);
        if (!isBusinessExist) {
            // Fallback: Check if this ID is a Place
            const isPlaceExist = await place_model_1.Place.findById(payload.businessId);
            if (isPlaceExist) {
                payload.placeId = payload.businessId;
                delete payload.businessId;
            }
            else {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Business not found');
            }
        }
        else {
            if (isBusinessExist.status !== 'Approved') {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Only approved businesses can be reviewed.');
            }
        }
    }
    else {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Either placeId or businessId is required');
    }
    const result = await review_model_1.Review.create(payload);
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to create Review, please try again later.');
    }
    return result;
};
const getAllReviews = async (paginationOptions, filter = {}) => {
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper_1.paginationHelper.calculatePagination(paginationOptions);
    const [result, total] = await Promise.all([
        review_model_1.Review.find(filter)
            .populate('reviewer', 'name profile level purchasedMaps')
            .populate({
            path: 'placeId',
            select: 'name media map address category country',
            populate: { path: 'map', select: 'name country' },
        })
            .populate('businessId', 'name media location')
            .skip(skip)
            .limit(limit)
            .sort({ [sortBy]: sortOrder }),
        review_model_1.Review.countDocuments(filter),
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
const getReviewsByPlace = async (placeId, paginationOptions, userId) => {
    // If this ID is a Business, automatically query by businessId
    const isBusiness = await business_model_1.Business.exists({ _id: placeId });
    const targetFilter = isBusiness ? { businessId: placeId } : { placeId };
    const filter = {
        ...targetFilter,
        $or: [
            { status: 'Approved' },
            ...(userId ? [{ reviewer: userId }] : []),
        ],
    };
    return await getAllReviews(paginationOptions, filter);
};
const getReviewsByBusiness = async (businessId, paginationOptions, userId) => {
    // If this ID is a Place, automatically query by placeId
    const isPlace = await place_model_1.Place.exists({ _id: businessId });
    const targetFilter = isPlace ? { placeId: businessId } : { businessId };
    const filter = {
        ...targetFilter,
        $or: [
            { status: 'Approved' },
            ...(userId ? [{ reviewer: userId }] : []),
        ],
    };
    return await getAllReviews(paginationOptions, filter);
};
const updateReview = async (user, id, payload) => {
    var _a;
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        const existingReview = await review_model_1.Review.findById(id).session(session);
        if (!existingReview) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Review not found.');
        }
        if ((existingReview === null || existingReview === void 0 ? void 0 : existingReview.reviewer.toString()) !== user.authId) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'You are not authorized to update this review.');
        }
        const oldRating = existingReview.rating;
        const newRating = (_a = payload.rating) !== null && _a !== void 0 ? _a : oldRating;
        // If review body or rating changes, reset status to Pending to trigger admin re-verification
        if (payload.review !== undefined || payload.rating !== undefined || payload.media !== undefined) {
            payload.status = 'Pending';
            payload.isVerified = false;
            payload.pointsEarned = 0;
        }
        if (payload.review !== undefined) {
            payload.review = await (0, autoTranslate_1.autoTranslateField)(payload.review);
        }
        // Update place/business stats and user points if the review was Approved but is now going back to Pending (due to edit)
        if (existingReview.status === 'Approved' && (payload.review !== undefined || payload.rating !== undefined || payload.media !== undefined)) {
            const rating = existingReview.rating;
            if (existingReview.placeId) {
                await place_model_1.Place.findByIdAndUpdate(existingReview.placeId, ratingDecPipeline(rating), { session, new: true });
            }
            else if (existingReview.businessId) {
                await business_model_1.Business.findByIdAndUpdate(existingReview.businessId, ratingDecPipeline(rating), { session, new: true });
            }
            // Deduct points from user
            const reviewerId = existingReview.reviewer.toString();
            const pointsToDeduct = existingReview.pointsEarned || 0;
            const reviewer = await user_model_1.User.findById(reviewerId).session(session);
            if (reviewer) {
                const newPoints = Math.max(0, (reviewer.points || 0) - pointsToDeduct);
                const newApprovedCount = Math.max(0, (reviewer.totalReviewsApproved || 0) - 1);
                const levelInfo = await levelConfig_service_1.LevelConfigServices.getDynamicUserLevel(newPoints, newApprovedCount);
                const newLevel = levelInfo.levelNumber;
                await user_model_1.User.findByIdAndUpdate(reviewerId, { $set: { points: newPoints, totalReviewsApproved: newApprovedCount, level: newLevel } }, { session });
            }
        }
        const result = await review_model_1.Review.findByIdAndUpdate(id, payload, {
            new: true,
            session,
        });
        await session.commitTransaction();
        return result;
    }
    catch (error) {
        await session.abortTransaction();
        throw error;
    }
    finally {
        await session.endSession();
    }
};
const deleteReview = async (user, id) => {
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        const existingReview = await review_model_1.Review.findById(id).session(session);
        if (!existingReview) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Review not found.');
        }
        if (user.role !== 'admin' &&
            user.role !== 'super_admin' &&
            existingReview.reviewer.toString() !== user.authId) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'You are not authorized to delete this review.');
        }
        // If the review was approved, we need to update the place/business ratings/stats and reduce user points
        if (existingReview.status === 'Approved') {
            const rating = existingReview.rating;
            if (existingReview.placeId) {
                await place_model_1.Place.findByIdAndUpdate(existingReview.placeId, ratingDecPipeline(rating), { session, new: true });
            }
            else if (existingReview.businessId) {
                await business_model_1.Business.findByIdAndUpdate(existingReview.businessId, ratingDecPipeline(rating), { session, new: true });
            }
            // Deduct points from user
            const reviewerId = existingReview.reviewer.toString();
            const pointsToDeduct = existingReview.pointsEarned || 0;
            const reviewer = await user_model_1.User.findById(reviewerId).session(session);
            if (reviewer) {
                const newPoints = Math.max(0, (reviewer.points || 0) - pointsToDeduct);
                const newApprovedCount = Math.max(0, (reviewer.totalReviewsApproved || 0) - 1);
                const levelInfo = await levelConfig_service_1.LevelConfigServices.getDynamicUserLevel(newPoints, newApprovedCount);
                const newLevel = levelInfo.levelNumber;
                await user_model_1.User.findByIdAndUpdate(reviewerId, { $set: { points: newPoints, totalReviewsApproved: newApprovedCount, level: newLevel } }, { session });
            }
        }
        const result = await review_model_1.Review.findByIdAndDelete(id, { session });
        await session.commitTransaction();
        return result;
    }
    catch (error) {
        await session.abortTransaction();
        throw error;
    }
    finally {
        await session.endSession();
    }
};
const getSingleReview = async (id) => {
    const result = await review_model_1.Review.findById(id).populate('reviewer', 'name profile');
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Review not found.');
    }
    return result;
};
const getMyReviews = async (user, paginationOptions) => {
    return await getAllReviews(paginationOptions, { reviewer: user.authId });
};
const approveReview = async (id) => {
    var _a, _b, _c;
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        const existingReview = await review_model_1.Review.findById(id).session(session);
        if (!existingReview) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Review not found');
        }
        if (existingReview.status === 'Approved') {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Review is already approved');
        }
        // 1. Calculate potential points based on new point rules:
        // 1. Star rating: +1 point
        // 2. Review text: +4 points
        // 3. Review >= 200 characters: +5 bonus points (total 10 points)
        let potentialPoints = 1;
        const reviewContent = typeof existingReview.review === 'object' && existingReview.review !== null
            ? (existingReview.review.es || existingReview.review.en || '')
            : (typeof existingReview.review === 'string' ? existingReview.review : '');
        if (reviewContent && reviewContent.trim() !== '') {
            potentialPoints += 4;
            if (reviewContent.trim().length >= 200) {
                potentialPoints += 5;
            }
        }
        // 2. Check if reviewer has purchased the map for this review
        // Points are earned ONLY for reviews of maps they have actually purchased.
        const reviewerId = existingReview.reviewer.toString();
        const reviewer = await user_model_1.User.findById(reviewerId).session(session);
        let isMapPurchased = false;
        if (reviewer) {
            if ([user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN].includes(reviewer.role)) {
                isMapPurchased = true;
            }
            else {
                const userPurchasedMapIds = (reviewer.purchasedMaps || []).map((m) => m ? (m._id ? m._id.toString() : m.toString()) : '');
                if (existingReview.placeId) {
                    const place = await place_model_1.Place.findById(existingReview.placeId).session(session);
                    const rawMap = place === null || place === void 0 ? void 0 : place.map;
                    const mapId = rawMap ? (rawMap._id ? rawMap._id.toString() : rawMap.toString()) : null;
                    if (mapId && userPurchasedMapIds.includes(mapId)) {
                        isMapPurchased = true;
                    }
                }
                else if (existingReview.businessId) {
                    const business = await business_model_1.Business.findById(existingReview.businessId).session(session);
                    const bizCountry = (_a = business === null || business === void 0 ? void 0 : business.location) === null || _a === void 0 ? void 0 : _a.country;
                    if (bizCountry) {
                        const countryMap = await map_model_1.Map.findOne({
                            country: { $regex: new RegExp(`^${bizCountry.trim()}$`, 'i') },
                        }).session(session);
                        if (countryMap && userPurchasedMapIds.includes(countryMap._id.toString())) {
                            isMapPurchased = true;
                        }
                    }
                }
            }
        }
        // Award the full calculated points upon admin approval (1pt rating, +4pts text, +5pts 200+ chars)
        const points = potentialPoints;
        // Update review status
        const updatedReview = await review_model_1.Review.findByIdAndUpdate(id, { $set: { status: 'Approved', isVerified: true, pointsEarned: points } }, { session, new: true });
        // 3. Update user points, approved review count, and recalculate level
        let levelUnlockedData = null;
        if (reviewer) {
            const oldLevel = reviewer.level || 0;
            const newPoints = (reviewer.points || 0) + points;
            const newApprovedCount = (reviewer.totalReviewsApproved || 0) + 1;
            const levelInfo = await levelConfig_service_1.LevelConfigServices.getDynamicUserLevel(newPoints, newApprovedCount);
            const newLevel = levelInfo.levelNumber;
            if (newLevel > oldLevel) {
                levelUnlockedData = {
                    newLevel,
                    levelName: levelInfo.title || `Nivel ${newLevel}`,
                    oldLevel,
                };
            }
            await user_model_1.User.findByIdAndUpdate(reviewerId, { $set: { points: newPoints, totalReviewsApproved: newApprovedCount, level: newLevel } }, { session });
            // Award update
            await award_service_1.AwardServices.updateAwardProgress(reviewerId, 'Top Reviewer', 1);
        }
        // 3. Update the place/business rating and total reviews
        if (existingReview.placeId) {
            await place_model_1.Place.findByIdAndUpdate(existingReview.placeId, ratingIncPipeline(existingReview.rating), { session, new: true });
        }
        else if (existingReview.businessId) {
            await business_model_1.Business.findByIdAndUpdate(existingReview.businessId, ratingIncPipeline(existingReview.rating), { session, new: true });
        }
        await session.commitTransaction();
        // Send notifications to reviewer
        try {
            const targetName = existingReview.placeId
                ? (_b = (await place_model_1.Place.findById(existingReview.placeId).select('name').lean())) === null || _b === void 0 ? void 0 : _b.name
                : (_c = (await business_model_1.Business.findById(existingReview.businessId).select('name').lean())) === null || _c === void 0 ? void 0 : _c.name;
            const resolvedTargetName = typeof targetName === 'object' && targetName !== null
                ? targetName.es || targetName.en || 'lugar'
                : targetName || 'lugar';
            // Send review approval notification
            await notification_integration_1.NotificationIntegration.onReviewApproved({
                reviewerId,
                targetName: resolvedTargetName,
                points,
                placeId: existingReview.placeId,
                businessId: existingReview.businessId,
            });
            // Send level unlock notification if user leveled up
            if (levelUnlockedData) {
                await notification_integration_1.NotificationIntegration.onLevelUnlocked({
                    userId: reviewerId,
                    newLevel: levelUnlockedData.newLevel,
                    levelName: levelUnlockedData.levelName,
                    oldLevel: levelUnlockedData.oldLevel,
                });
            }
        }
        catch (notifErr) {
            console.error('Failed to send review approval/level notifications:', notifErr);
        }
        return updatedReview;
    }
    catch (error) {
        await session.abortTransaction();
        throw error;
    }
    finally {
        await session.endSession();
    }
};
const rejectReview = async (id) => {
    var _a, _b;
    const existingReview = await review_model_1.Review.findById(id);
    if (!existingReview) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Review not found');
    }
    if (existingReview.status === 'Approved') {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Cannot reject an already approved review');
    }
    const result = await review_model_1.Review.findByIdAndUpdate(id, { $set: { status: 'Rejected', isVerified: false, pointsEarned: 0 } }, { new: true });
    // Send in-app notification to reviewer
    try {
        const targetName = existingReview.placeId
            ? (_a = (await place_model_1.Place.findById(existingReview.placeId).select('name').lean())) === null || _a === void 0 ? void 0 : _a.name
            : (_b = (await business_model_1.Business.findById(existingReview.businessId).select('name').lean())) === null || _b === void 0 ? void 0 : _b.name;
        const resolvedTargetName = typeof targetName === 'object' && targetName !== null
            ? targetName.es || targetName.en || 'lugar'
            : targetName || 'lugar';
        await notification_integration_1.NotificationIntegration.onReviewRejected({
            reviewerId: existingReview.reviewer.toString(),
            targetName: resolvedTargetName,
            placeId: existingReview.placeId,
            businessId: existingReview.businessId,
        });
    }
    catch (notifErr) {
        console.error('Failed to send review rejection notification:', notifErr);
    }
    return result;
};
exports.ReviewService = {
    createReview,
    getAllReviews,
    getReviewsByPlace,
    getReviewsByBusiness,
    updateReview,
    deleteReview,
    getSingleReview,
    getMyReviews,
    approveReview,
    rejectReview,
};
