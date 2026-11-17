"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FavouriteService = void 0;
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const favourite_model_1 = require("./favourite.model");
const map_model_1 = require("../map/map.model");
const place_model_1 = require("../place/place.model");
const offer_model_1 = require("../offer/offer.model");
const business_model_1 = require("../business/business.model");
const user_model_1 = require("../user/user.model");
const mongoose_1 = __importDefault(require("mongoose"));
const countryScope_1 = require("../../helpers/countryScope");
const toggleFavourite = async (userId, payload) => {
    const { type, map, place, offer, business } = payload;
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        if (type === 'Map' && map) {
            const isMapExist = await map_model_1.Map.findById(map).session(session);
            if (!isMapExist) {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found');
            }
            const isFavouriteExist = await favourite_model_1.Favourite.findOne({ user: userId, map }).session(session);
            if (isFavouriteExist) {
                await favourite_model_1.Favourite.findOneAndDelete({ user: userId, map }).session(session);
                await user_model_1.User.findByIdAndUpdate(userId, { $pull: { favoriteMaps: map } }).session(session);
                await session.commitTransaction();
                return null;
            }
            else {
                const result = await favourite_model_1.Favourite.create([{ user: userId, map, type }], { session });
                await user_model_1.User.findByIdAndUpdate(userId, { $addToSet: { favoriteMaps: map } }).session(session);
                await session.commitTransaction();
                return result[0];
            }
        }
        else if (type === 'Place' && place) {
            const isPlaceExist = await place_model_1.Place.findById(place).session(session);
            if (!isPlaceExist) {
                // Fallback: check if id exists in Business collection
                const isBusinessExist = await business_model_1.Business.findById(place).session(session);
                if (isBusinessExist) {
                    const isFavouriteExist = await favourite_model_1.Favourite.findOne({
                        user: userId,
                        $or: [{ business: place }, { place }],
                    }).session(session);
                    if (isFavouriteExist) {
                        await favourite_model_1.Favourite.findByIdAndDelete(isFavouriteExist._id).session(session);
                        await user_model_1.User.findByIdAndUpdate(userId, {
                            $pull: { favoriteBusinesses: place, favoritePlaces: place },
                        }).session(session);
                        await session.commitTransaction();
                        return null;
                    }
                    else {
                        const result = await favourite_model_1.Favourite.create([{ user: userId, business: place, type: 'Business' }], { session });
                        await user_model_1.User.findByIdAndUpdate(userId, {
                            $addToSet: { favoriteBusinesses: place },
                        }).session(session);
                        await session.commitTransaction();
                        return result[0];
                    }
                }
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
            }
            const isFavouriteExist = await favourite_model_1.Favourite.findOne({
                user: userId,
                $or: [{ place }, { business: place }],
            }).session(session);
            if (isFavouriteExist) {
                await favourite_model_1.Favourite.findByIdAndDelete(isFavouriteExist._id).session(session);
                await user_model_1.User.findByIdAndUpdate(userId, {
                    $pull: { favoritePlaces: place, favoriteBusinesses: place },
                }).session(session);
                await session.commitTransaction();
                return null;
            }
            else {
                const result = await favourite_model_1.Favourite.create([{ user: userId, place, type }], { session });
                await user_model_1.User.findByIdAndUpdate(userId, { $addToSet: { favoritePlaces: place } }).session(session);
                await session.commitTransaction();
                return result[0];
            }
        }
        else if (type === 'Offer' && offer) {
            const isOfferExist = await offer_model_1.Offer.findById(offer).session(session);
            if (!isOfferExist) {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Offer not found');
            }
            const isFavouriteExist = await favourite_model_1.Favourite.findOne({ user: userId, offer }).session(session);
            if (isFavouriteExist) {
                await favourite_model_1.Favourite.findOneAndDelete({ user: userId, offer }).session(session);
                await user_model_1.User.findByIdAndUpdate(userId, { $pull: { favoriteOffers: offer } }).session(session);
                await session.commitTransaction();
                return null;
            }
            else {
                const result = await favourite_model_1.Favourite.create([{ user: userId, offer, type }], { session });
                await user_model_1.User.findByIdAndUpdate(userId, { $addToSet: { favoriteOffers: offer } }).session(session);
                await session.commitTransaction();
                return result[0];
            }
        }
        else if (type === 'Business' && (business || place)) {
            const targetId = String(business || place);
            const isBusinessExist = await business_model_1.Business.findById(targetId).session(session);
            if (!isBusinessExist) {
                // Fallback: check if targetId is in Place collection (where type may be 'Business' or 'Regular')
                const isPlaceExist = await place_model_1.Place.findById(targetId).session(session);
                if (isPlaceExist) {
                    const isFavouriteExist = await favourite_model_1.Favourite.findOne({
                        user: userId,
                        $or: [{ place: targetId }, { business: targetId }],
                    }).session(session);
                    if (isFavouriteExist) {
                        await favourite_model_1.Favourite.findByIdAndDelete(isFavouriteExist._id).session(session);
                        await user_model_1.User.findByIdAndUpdate(userId, {
                            $pull: { favoritePlaces: targetId, favoriteBusinesses: targetId },
                        }).session(session);
                        await session.commitTransaction();
                        return null;
                    }
                    else {
                        const result = await favourite_model_1.Favourite.create([{ user: userId, place: targetId, type: isPlaceExist.type === 'Business' ? 'Business' : 'Place' }], { session });
                        await user_model_1.User.findByIdAndUpdate(userId, {
                            $addToSet: { favoritePlaces: targetId },
                        }).session(session);
                        await session.commitTransaction();
                        return result[0];
                    }
                }
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Business not found');
            }
            const isFavouriteExist = await favourite_model_1.Favourite.findOne({
                user: userId,
                $or: [{ business: targetId }, { place: targetId }],
            }).session(session);
            if (isFavouriteExist) {
                await favourite_model_1.Favourite.findByIdAndDelete(isFavouriteExist._id).session(session);
                await user_model_1.User.findByIdAndUpdate(userId, {
                    $pull: { favoriteBusinesses: targetId, favoritePlaces: targetId },
                }).session(session);
                await session.commitTransaction();
                return null;
            }
            else {
                const result = await favourite_model_1.Favourite.create([{ user: userId, business: targetId, type }], { session });
                await user_model_1.User.findByIdAndUpdate(userId, {
                    $addToSet: { favoriteBusinesses: targetId },
                }).session(session);
                await session.commitTransaction();
                return result[0];
            }
        }
        else {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid payload');
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
const getMyFavourites = async (userId, query) => {
    const { page = 1, limit = 1000, sort = '-createdAt', country, ...filterData } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const sortStr = sort;
    const sortOrder = sortStr.startsWith('-') ? -1 : 1;
    const sortField = sortStr.replace(/^-/, '');
    const matchStage = {
        ...filterData,
        // Query parameters must never override the authenticated owner.
        user: new mongoose_1.default.Types.ObjectId(userId),
    };
    if (typeof country === 'string' && country.trim()) {
        const { countries, mapIds } = await (0, countryScope_1.getCountryScope)(country);
        const [places, businesses] = await Promise.all([
            place_model_1.Place.find({ $or: [{ country: { $in: countries } }, { map: { $in: mapIds } }] }).select('_id').lean(),
            business_model_1.Business.find({ 'location.country': { $in: countries } }).select('_id').lean(),
        ]);
        const placeIds = places.map(place => place._id);
        const businessIds = businesses.map(business => business._id);
        const offers = await offer_model_1.Offer.find({ $or: [
                { place: { $in: placeIds } }, { business: { $in: businessIds } },
            ] }).select('_id').lean();
        matchStage.$and = [
            ...(Array.isArray(matchStage.$and) ? matchStage.$and : []),
            { $or: [
                    { map: { $in: mapIds } }, { place: { $in: placeIds } },
                    { business: { $in: businessIds } }, { offer: { $in: offers.map(offer => offer._id) } },
                ] },
        ];
    }
    // Paginate first, then lookup only the page of docs (list fields only)
    const pipeline = [
        { $match: matchStage },
        { $sort: { [sortField]: sortOrder } },
        { $skip: skip },
        { $limit: Number(limit) },
        {
            $lookup: {
                from: 'maps',
                localField: 'map',
                foreignField: '_id',
                pipeline: [
                    { $project: { name: 1, name_es: 1, description: 1, description_es: 1, images: 1 } },
                ],
                as: 'map',
            },
        },
        { $unwind: { path: '$map', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'places',
                localField: 'place',
                foreignField: '_id',
                pipeline: [
                    {
                        $project: {
                            name: 1,
                            name_es: 1,
                            description: 1,
                            description_es: 1,
                            media: 1,
                            type: 1,
                            map: 1,
                            category: 1,
                            address: 1,
                        },
                    },
                ],
                as: 'place',
            },
        },
        { $unwind: { path: '$place', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'offers',
                localField: 'offer',
                foreignField: '_id',
                pipeline: [
                    { $project: { title: 1, title_es: 1, name: 1, name_es: 1, description: 1, description_es: 1, image: 1, media: 1 } },
                ],
                as: 'offer',
            },
        },
        { $unwind: { path: '$offer', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'businesses',
                localField: 'business',
                foreignField: '_id',
                pipeline: [
                    {
                        $project: {
                            name: 1,
                            name_es: 1,
                            description: 1,
                            description_es: 1,
                            'media.photos': 1,
                        },
                    },
                ],
                as: 'business',
            },
        },
        { $unwind: { path: '$business', preserveNullAndEmptyArrays: true } },
    ];
    const [data, total] = await Promise.all([
        favourite_model_1.Favourite.aggregate(pipeline),
        favourite_model_1.Favourite.countDocuments(matchStage),
    ]);
    const totalPage = Math.ceil(total / Number(limit));
    return {
        meta: {
            total,
            limit: Number(limit),
            page: Number(page),
            totalPage,
        },
        data,
    };
};
const removeFavourite = async (id, userId) => {
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        const result = await favourite_model_1.Favourite.findOneAndDelete({ _id: id, user: userId }).session(session);
        if (!result) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Favourite not found');
        }
        if (result.map) {
            await user_model_1.User.findByIdAndUpdate(userId, { $pull: { favoriteMaps: result.map } }).session(session);
        }
        if (result.place) {
            await user_model_1.User.findByIdAndUpdate(userId, { $pull: { favoritePlaces: result.place } }).session(session);
        }
        if (result.offer) {
            await user_model_1.User.findByIdAndUpdate(userId, { $pull: { favoriteOffers: result.offer } }).session(session);
        }
        if (result.business) {
            await user_model_1.User.findByIdAndUpdate(userId, {
                $pull: { favoriteBusinesses: result.business },
            }).session(session);
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
exports.FavouriteService = {
    toggleFavourite,
    getMyFavourites,
    removeFavourite,
};
