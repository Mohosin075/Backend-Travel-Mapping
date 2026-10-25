"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisitedService = void 0;
const http_status_codes_1 = require("http-status-codes");
const mongoose_1 = __importDefault(require("mongoose"));
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const visited_model_1 = require("./visited.model");
const place_model_1 = require("../place/place.model");
const business_model_1 = require("../business/business.model");
const user_model_1 = require("../user/user.model");
const levelConfig_service_1 = require("../award/levelConfig.service");
const toggleVisited = async (userId, payload) => {
    var _a, _b;
    const targetId = payload.placeId || payload.place || payload.business || payload.id;
    if (!targetId || !mongoose_1.default.Types.ObjectId.isValid(targetId)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'A valid location ID is required');
    }
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        // 1. Determine whether targetId belongs to Place or Business
        let locationType = payload.type || 'Place';
        const isPlaceExist = await place_model_1.Place.findById(targetId).session(session);
        let isBusinessExist = null;
        if (!isPlaceExist) {
            isBusinessExist = await business_model_1.Business.findById(targetId).session(session);
            if (isBusinessExist) {
                locationType = 'Business';
            }
            else {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Location not found');
            }
        }
        else {
            locationType = isPlaceExist.type === 'Business' ? 'Business' : 'Place';
        }
        // 2. Check if already marked as visited
        const existing = await visited_model_1.Visited.findOne({
            user: userId,
            $or: [{ place: targetId }, { business: targetId }],
        }).session(session);
        if (existing) {
            // Unmark visited
            await visited_model_1.Visited.findByIdAndDelete(existing._id).session(session);
            if (existing.type === 'Business' || existing.business) {
                const bId = existing.business || targetId;
                await business_model_1.Business.findByIdAndUpdate(bId, { $inc: { viewCount: -1 } }, { session });
            }
            const pointsToDeduct = Number(isPlaceExist === null || isPlaceExist === void 0 ? void 0 : isPlaceExist.pointsAwarded) > 0 ? Number(isPlaceExist === null || isPlaceExist === void 0 ? void 0 : isPlaceExist.pointsAwarded) : 10;
            const userDoc = await user_model_1.User.findById(userId).session(session);
            const currentPoints = Number(userDoc === null || userDoc === void 0 ? void 0 : userDoc.points) || 0;
            const newPoints = Math.max(0, currentPoints - pointsToDeduct);
            const levelInfo = await levelConfig_service_1.LevelConfigServices.getDynamicUserLevel(newPoints, (userDoc === null || userDoc === void 0 ? void 0 : userDoc.totalReviewsApproved) || 0);
            const updatedUser = await user_model_1.User.findByIdAndUpdate(userId, {
                $pull: { visitedPlaces: targetId },
                $set: { points: newPoints, level: levelInfo.levelNumber },
            }, { new: true, session });
            // Sync count based on actual length
            const actualCount = (updatedUser === null || updatedUser === void 0 ? void 0 : updatedUser.visitedPlaces) ? updatedUser.visitedPlaces.length : 0;
            await user_model_1.User.findByIdAndUpdate(userId, { $set: { visitedPlacesCount: actualCount } }, { session });
            await session.commitTransaction();
            return { isVisited: false, visitedCount: actualCount };
        }
        else {
            // Mark as visited
            const newRecord = await visited_model_1.Visited.create([
                {
                    user: userId,
                    ...(locationType === 'Business' ? { business: targetId } : { place: targetId }),
                    type: locationType,
                    visitedAt: new Date(),
                },
            ], { session });
            if (locationType === 'Business') {
                await business_model_1.Business.findByIdAndUpdate(targetId, { $inc: { viewCount: 1 } }, { session });
            }
            else if (isPlaceExist) {
                const placeName = (typeof isPlaceExist.name === 'object'
                    ? ((_a = isPlaceExist.name) === null || _a === void 0 ? void 0 : _a.es) || ((_b = isPlaceExist.name) === null || _b === void 0 ? void 0 : _b.en)
                    : isPlaceExist.name) || isPlaceExist.name_es || '';
                if (placeName) {
                    const matchingBiz = await business_model_1.Business.findOne({
                        $or: [
                            { name: placeName },
                            { 'name.en': placeName },
                            { 'name.es': placeName },
                        ],
                    }).session(session);
                    if (matchingBiz) {
                        await business_model_1.Business.findByIdAndUpdate(matchingBiz._id, { $inc: { viewCount: 1 } }, { session });
                    }
                }
            }
            const pointsToAdd = Number(isPlaceExist === null || isPlaceExist === void 0 ? void 0 : isPlaceExist.pointsAwarded) > 0 ? Number(isPlaceExist === null || isPlaceExist === void 0 ? void 0 : isPlaceExist.pointsAwarded) : 10;
            const userDoc = await user_model_1.User.findById(userId).session(session);
            const currentPoints = Number(userDoc === null || userDoc === void 0 ? void 0 : userDoc.points) || 0;
            const newPoints = currentPoints + pointsToAdd;
            const levelInfo = await levelConfig_service_1.LevelConfigServices.getDynamicUserLevel(newPoints, (userDoc === null || userDoc === void 0 ? void 0 : userDoc.totalReviewsApproved) || 0);
            const updatedUser = await user_model_1.User.findByIdAndUpdate(userId, {
                $addToSet: { visitedPlaces: targetId },
                $set: { points: newPoints, level: levelInfo.levelNumber },
            }, { new: true, session });
            const actualCount = (updatedUser === null || updatedUser === void 0 ? void 0 : updatedUser.visitedPlaces) ? updatedUser.visitedPlaces.length : 1;
            await user_model_1.User.findByIdAndUpdate(userId, { $set: { visitedPlacesCount: actualCount } }, { session });
            await session.commitTransaction();
            return {
                isVisited: true,
                visitedCount: actualCount,
                data: newRecord[0],
            };
        }
    }
    catch (error) {
        await session.abortTransaction();
        throw error;
    }
    finally {
        session.endSession();
    }
};
const getMyVisitedPlaces = async (userId, query) => {
    var _a, _b, _c;
    const { page = 1, limit = 20, sort = '-visitedAt', searchTerm, type } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const sortStr = typeof sort === 'string' ? sort : '-visitedAt';
    const sortOrder = sortStr.startsWith('-') ? -1 : 1;
    const sortField = sortStr.replace(/^-/, '');
    const matchStage = {
        user: new mongoose_1.default.Types.ObjectId(userId),
    };
    if (type && ['Place', 'Business'].includes(type)) {
        matchStage.type = type;
    }
    const pipeline = [
        { $match: matchStage },
        {
            $lookup: {
                from: 'places',
                localField: 'place',
                foreignField: '_id',
                pipeline: [
                    {
                        $lookup: {
                            from: 'categories',
                            localField: 'category',
                            foreignField: '_id',
                            as: 'category',
                        },
                    },
                    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
                    {
                        $lookup: {
                            from: 'maps',
                            localField: 'map',
                            foreignField: '_id',
                            as: 'map',
                        },
                    },
                    { $unwind: { path: '$map', preserveNullAndEmptyArrays: true } },
                    {
                        $project: {
                            name: 1,
                            name_es: 1,
                            description: 1,
                            description_es: 1,
                            media: 1,
                            type: 1,
                            address: 1,
                            location: 1,
                            rating: 1,
                            totalReview: 1,
                            entryCost: 1,
                            difficulty: 1,
                            category: { name: 1, color: 1, icon: 1 },
                            map: { name: 1, country: 1 },
                        },
                    },
                ],
                as: 'place',
            },
        },
        { $unwind: { path: '$place', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'businesses',
                localField: 'business',
                foreignField: '_id',
                pipeline: [
                    {
                        $lookup: {
                            from: 'categories',
                            localField: 'category',
                            foreignField: '_id',
                            as: 'category',
                        },
                    },
                    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
                    {
                        $project: {
                            name: 1,
                            name_es: 1,
                            description: 1,
                            description_es: 1,
                            'media.photos': 1,
                            location: 1,
                            rating: 1,
                            totalReview: 1,
                            category: { name: 1, color: 1, icon: 1 },
                        },
                    },
                ],
                as: 'business',
            },
        },
        { $unwind: { path: '$business', preserveNullAndEmptyArrays: true } },
        {
            $match: {
                $or: [
                    { place: { $exists: true, $ne: null } },
                    { business: { $exists: true, $ne: null } },
                ],
            },
        },
    ];
    // Optional search by name or address across place/business
    if (searchTerm && typeof searchTerm === 'string' && searchTerm.trim()) {
        const searchRegex = new RegExp(searchTerm.trim(), 'i');
        pipeline.push({
            $match: {
                $or: [
                    { 'place.name': searchRegex },
                    { 'place.name.en': searchRegex },
                    { 'place.name.es': searchRegex },
                    { 'place.address': searchRegex },
                    { 'business.name': searchRegex },
                    { 'business.name.en': searchRegex },
                    { 'business.name.es': searchRegex },
                ],
            },
        });
    }
    const limitNum = Number(limit);
    const dataPipeline = [{ $sort: { [sortField]: sortOrder } }];
    if (skip > 0) {
        dataPipeline.push({ $skip: skip });
    }
    if (limitNum > 0) {
        dataPipeline.push({ $limit: limitNum });
    }
    pipeline.push({
        $facet: {
            data: dataPipeline,
            totalCount: [{ $count: 'count' }],
        },
    });
    const aggregateResult = await visited_model_1.Visited.aggregate(pipeline);
    const rawData = ((_a = aggregateResult[0]) === null || _a === void 0 ? void 0 : _a.data) || [];
    const data = rawData.map((item) => ({
        ...item,
        isVisited: true,
    }));
    const total = ((_c = (_b = aggregateResult[0]) === null || _b === void 0 ? void 0 : _b.totalCount[0]) === null || _c === void 0 ? void 0 : _c.count) || 0;
    const totalPage = limitNum > 0 ? Math.ceil(total / limitNum) : 1;
    return {
        meta: {
            total,
            limit: limitNum > 0 ? limitNum : total,
            page: Number(page),
            totalPage,
        },
        data,
    };
};
const getVisitedCount = async (userId) => {
    var _a;
    const user = await user_model_1.User.findById(userId).select('visitedPlacesCount visitedPlaces');
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found');
    }
    const validCountAggregate = await visited_model_1.Visited.aggregate([
        { $match: { user: new mongoose_1.default.Types.ObjectId(userId) } },
        {
            $lookup: {
                from: 'places',
                localField: 'place',
                foreignField: '_id',
                as: 'p',
            },
        },
        {
            $lookup: {
                from: 'businesses',
                localField: 'business',
                foreignField: '_id',
                as: 'b',
            },
        },
        {
            $match: {
                $or: [
                    { 'p.0': { $exists: true } },
                    { 'b.0': { $exists: true } },
                ],
            },
        },
        { $count: 'count' },
    ]);
    const count = ((_a = validCountAggregate[0]) === null || _a === void 0 ? void 0 : _a.count) || 0;
    if (user.visitedPlacesCount !== count) {
        await user_model_1.User.findByIdAndUpdate(userId, { $set: { visitedPlacesCount: count } });
    }
    return { visitedPlacesCount: count };
};
const removeVisited = async (id, userId) => {
    if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'A valid visited record ID is required');
    }
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        const result = await visited_model_1.Visited.findOneAndDelete({ _id: id, user: userId }).session(session);
        if (!result) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Visited record not found');
        }
        const placeId = result.place || result.business;
        if (placeId) {
            const updatedUser = await user_model_1.User.findByIdAndUpdate(userId, { $pull: { visitedPlaces: placeId } }, { new: true, session });
            const actualCount = (updatedUser === null || updatedUser === void 0 ? void 0 : updatedUser.visitedPlaces) ? updatedUser.visitedPlaces.length : 0;
            await user_model_1.User.findByIdAndUpdate(userId, { $set: { visitedPlacesCount: actualCount } }, { session });
        }
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
exports.VisitedService = {
    toggleVisited,
    getMyVisitedPlaces,
    getVisitedCount,
    removeVisited,
};
