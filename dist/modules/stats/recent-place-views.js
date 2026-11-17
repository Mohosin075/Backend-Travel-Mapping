"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recentPlaceViews = void 0;
const usageView_model_1 = require("./usageView.model");
const usage_reporting_1 = require("./usage-reporting");
const place_model_1 = require("../place/place.model");
const business_model_1 = require("../business/business.model");
const user_model_1 = require("../user/user.model");
const localize_1 = require("../../helpers/localize");
/** Latest open per account and place. Never infer a physical visit from an open. */
const recentPlaceViews = async (match, limit = 25) => {
    const scopedMatch = { $and: [match, {
                type: { $in: ['place', 'business'] },
                viewerKey: { $regex: '^user:[a-fA-F0-9]{24}$' },
            }] };
    const rows = await usageView_model_1.UsageView.aggregate([
        // Lifetime rows already have one latest open per viewer/entity. Read daily
        // history only for a date filter that may precede the latest open.
        ...(match.lastSeenAt ? (0, usage_reporting_1.viewerPipeline)(scopedMatch) : [{ $match: scopedMatch }]),
        { $sort: { lastSeenAt: -1, entityId: 1 } },
        { $set: {
                accountId: { $convert: { input: { $substrBytes: ['$viewerKey', 5, 24] }, to: 'objectId', onError: null, onNull: null } },
                targetId: { $convert: { input: '$entityId', to: 'objectId', onError: null, onNull: null } },
            } },
        { $lookup: { from: user_model_1.User.collection.name, localField: 'accountId', foreignField: '_id', as: 'account' } },
        { $unwind: '$account' },
        { $match: { 'account.status': { $ne: 'deleted' } } },
        { $lookup: { from: place_model_1.Place.collection.name, localField: 'targetId', foreignField: '_id', as: 'place' } },
        { $lookup: { from: business_model_1.Business.collection.name, localField: 'targetId', foreignField: '_id', as: 'business' } },
        { $set: { target: { $cond: [{ $eq: ['$type', 'place'] }, { $arrayElemAt: ['$place', 0] }, { $arrayElemAt: ['$business', 0] }] } } },
        { $match: { 'target._id': { $exists: true } } },
        { $limit: limit },
        { $project: { entityId: 1, type: 1, lastSeenAt: 1, 'target.name': 1,
                'account._id': 1, 'account.name': 1, 'account.email': 1, 'account.profile': 1 } },
    ]);
    return rows.map(row => ({
        id: `view:${row.account._id}:${row.type}:${row.entityId}`,
        type: 'view',
        title: 'Viewed Place',
        userId: String(row.account._id), userName: row.account.name || 'Explorer',
        userEmail: row.account.email, userProfile: row.account.profile,
        subtitle: (0, localize_1.localizeField)(row.target.name),
        targetId: row.entityId, targetType: row.type,
        timestamp: row.lastSeenAt,
    }));
};
exports.recentPlaceViews = recentPlaceViews;
