"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distinctViewers = exports.entityViewers = exports.rankedViewers = exports.viewerPipeline = void 0;
const usageView_model_1 = require("./usageView.model");
const user_model_1 = require("../user/user.model");
/** Both rankings and drilldowns count the same distinct recorded viewers.
 * Legacy last-seen records remain available; missing historical visits cannot be inferred.
 */
const viewerPipeline = (match) => [
    { $match: match },
    { $unionWith: { coll: 'usageviewdays', pipeline: [{ $match: match }] } },
    { $group: {
            _id: { type: '$type', entityId: '$entityId', viewerKey: '$viewerKey' },
            lastSeenAt: { $max: '$lastSeenAt' },
        } },
    { $project: {
            _id: 0, type: '$_id.type', entityId: '$_id.entityId',
            viewerKey: '$_id.viewerKey', lastSeenAt: 1,
        } },
];
exports.viewerPipeline = viewerPipeline;
const rankedViewers = (type, ids, dateRange) => usageView_model_1.UsageView.aggregate([
    ...(0, exports.viewerPipeline)({ type, entityId: { $in: ids }, ...(dateRange ? { lastSeenAt: dateRange } : {}) }),
    { $group: { _id: '$entityId', count: { $sum: 1 }, viewerKeys: { $addToSet: '$viewerKey' } } },
    // Resolve profiles once per ranked entity rather than once per recorded view.
    { $set: { accountIds: { $map: {
                    input: { $filter: { input: '$viewerKeys', as: 'key', cond: {
                                $regexMatch: { input: { $ifNull: ['$$key', ''] }, regex: '^user:[a-fA-F0-9]{24}$' },
                            } } }, as: 'key', in: { $toObjectId: { $substrBytes: ['$$key', 5, 24] } },
                } } } },
    { $lookup: { from: user_model_1.User.collection.name, localField: 'accountIds', foreignField: '_id',
            pipeline: [{ $match: { status: { $ne: 'deleted' } } }, { $project: { _id: 1 } }], as: 'accounts' } },
    { $project: { count: 1, profileCount: { $size: '$accounts' } } },
    // Rank by identified profiles before limiting so guest-heavy entities
    // cannot hide an entity with more registered profiles.
    { $sort: { profileCount: -1, count: -1, _id: 1 } },
    { $limit: 20 },
]);
exports.rankedViewers = rankedViewers;
const entityViewers = (type, id, dateRange) => usageView_model_1.UsageView.aggregate([
    ...(0, exports.viewerPipeline)({ type, entityId: id, ...(dateRange ? { lastSeenAt: dateRange } : {}) }),
    { $sort: { lastSeenAt: -1, viewerKey: 1 } },
]);
exports.entityViewers = entityViewers;
const distinctViewers = async (match) => {
    const rows = await usageView_model_1.UsageView.aggregate([
        ...(0, exports.viewerPipeline)(match),
        { $group: { _id: '$viewerKey' } },
    ]);
    return rows.map(row => String(row._id));
};
exports.distinctViewers = distinctViewers;
