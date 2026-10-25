"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AwardServices = void 0;
const mongoose_1 = require("mongoose");
const award_model_1 = require("./award.model");
const user_model_1 = require("../user/user.model");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const http_status_codes_1 = require("http-status-codes");
const awardConfig_model_1 = require("./awardConfig.model");
const awardConfig_service_1 = require("./awardConfig.service");
const notification_integration_1 = require("../notification/notification.integration");
const getMyAwards = async (userId) => {
    const user = await user_model_1.User.findById(userId);
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found');
    }
    // Seed default configs if missing
    await awardConfig_service_1.AwardConfigServices.seedAwardConfigs();
    // Fetch configs and existing awards
    const configs = await awardConfig_model_1.AwardConfig.find({}).populate('mapId');
    const existingAwards = await award_model_1.Award.find({ userId });
    const awards = [];
    for (const config of configs) {
        const found = existingAwards.find(a => (a.configId && a.configId.toString() === config._id.toString()) ||
            (a.type === config.type && a.target === config.target));
        const userPoints = Number(user.points) || 0;
        // Every reward and badge tracks user points against the target requirement set by admin in dashboard.
        // If the award has a custom action progress (e.g. approved reviews), we take the highest progress.
        const progress = Math.max(userPoints, (found === null || found === void 0 ? void 0 : found.progress) || 0);
        const isUnlocked = progress >= config.target;
        if (!found) {
            const newAward = await award_model_1.Award.create({
                userId,
                configId: config._id,
                type: config.type,
                target: config.target,
                progress,
                isUnlocked,
            });
            if (isUnlocked) {
                const rewardTitle = typeof config.title === 'object'
                    ? config.title.en || config.title.es || config.type
                    : config.title || config.type;
                notification_integration_1.NotificationIntegration.onRewardEarned({
                    userId,
                    rewardTitle,
                    rewardType: config.type,
                    awardId: newAward._id,
                }).catch(err => console.error('Failed to notify award earned:', err));
            }
            // Attach config properties for frontend
            const awardObj = newAward.toObject();
            awardObj.config = config;
            awards.push(awardObj);
        }
        else {
            // Update target, progress, isUnlocked if they differ
            const wasUnlocked = Boolean(found.isUnlocked);
            const updates = {
                configId: config._id,
                target: config.target,
                progress,
                isUnlocked,
            };
            if (!wasUnlocked && updates.isUnlocked) {
                const rewardTitle = typeof config.title === 'object'
                    ? config.title.en || config.title.es || config.type
                    : config.title || config.type;
                notification_integration_1.NotificationIntegration.onRewardEarned({
                    userId,
                    rewardTitle,
                    rewardType: config.type,
                    awardId: found._id,
                }).catch(err => console.error('Failed to notify award earned:', err));
            }
            const updatedAward = await award_model_1.Award.findByIdAndUpdate(found._id, { $set: updates }, { new: true });
            const awardObj = updatedAward.toObject();
            awardObj.config = config;
            awards.push(awardObj);
        }
    }
    return awards.sort((a, b) => (a.target || 0) - (b.target || 0));
};
const updateAwardProgress = async (userId, type, progressIncrement) => {
    const user = await user_model_1.User.findById(userId).select('points');
    const userPoints = Number(user === null || user === void 0 ? void 0 : user.points) || 0;
    const awards = await award_model_1.Award.find({ userId, type });
    for (const award of awards) {
        const wasUnlocked = Boolean(award.isUnlocked);
        const actionProgress = (award.progress || 0) + progressIncrement;
        const newProgress = Math.max(userPoints, actionProgress);
        const isUnlocked = newProgress >= award.target;
        await award_model_1.Award.updateOne({ _id: award._id }, { $set: { progress: newProgress, isUnlocked } });
        if (!wasUnlocked && isUnlocked) {
            notification_integration_1.NotificationIntegration.onRewardEarned({
                userId,
                rewardTitle: type,
                rewardType: type,
                awardId: award._id,
            }).catch(err => console.error('Failed to notify award earned:', err));
        }
    }
};
const redeemFreeMap = async (userId, mapId) => {
    const user = await user_model_1.User.findById(userId);
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found');
    }
    // Ensure awards and unlock states are synchronized based on user points
    await getMyAwards(userId);
    // Find all unlocked Free Map awards for this user
    const freeMapAwards = await award_model_1.Award.find({ userId, type: 'Free Map', isUnlocked: true }).populate('configId');
    if (!freeMapAwards || freeMapAwards.length === 0) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Free Map award is not unlocked yet');
    }
    // Calculate total free maps allowed across all unlocked awards
    const totalAllowed = freeMapAwards.reduce((acc, award) => {
        var _a;
        const count = Number((_a = award.configId) === null || _a === void 0 ? void 0 : _a.mapCount) || 1;
        return acc + count;
    }, 0);
    // Determine currently redeemed maps
    const currentRedeemed = Array.isArray(user.redeemedFreeMaps) && user.redeemedFreeMaps.length > 0
        ? user.redeemedFreeMaps
        : (user.redeemedFreeMap ? [user.redeemedFreeMap] : []);
    if (currentRedeemed.length >= totalAllowed) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'You have already redeemed all your free map rewards');
    }
    // Check if map already redeemed
    if (currentRedeemed.some(m => m.toString() === mapId.toString())) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'You have already redeemed this specific map');
    }
    // Update user: set redeemedFreeMap and add to redeemedFreeMaps & purchasedMaps
    const result = await user_model_1.User.findByIdAndUpdate(userId, {
        $set: { redeemedFreeMap: new mongoose_1.Types.ObjectId(mapId) },
        $addToSet: {
            redeemedFreeMaps: new mongoose_1.Types.ObjectId(mapId),
            purchasedMaps: new mongoose_1.Types.ObjectId(mapId),
        },
    }, { new: true });
    return result;
};
exports.AwardServices = {
    getMyAwards,
    updateAwardProgress,
    redeemFreeMap,
};
