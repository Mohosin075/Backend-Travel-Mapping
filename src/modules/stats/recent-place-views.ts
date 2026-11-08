import { UsageView } from './usageView.model'
import { viewerPipeline } from './usage-reporting'
import { Place } from '../place/place.model'
import { Business } from '../business/business.model'
import { User } from '../user/user.model'
import { localizeField } from '../../helpers/localize'

/** Latest open per account and place. Never infer a physical visit from an open. */
export const recentPlaceViews = async (match: Record<string, any>, limit = 25) => {
  const scopedMatch = { $and: [match, {
    type: { $in: ['place', 'business'] },
    viewerKey: { $regex: '^user:[a-fA-F0-9]{24}$' },
  }] }
  const rows = await UsageView.aggregate([
    // Lifetime rows already have one latest open per viewer/entity. Read daily
    // history only for a date filter that may precede the latest open.
    ...(match.lastSeenAt ? viewerPipeline(scopedMatch) : [{ $match: scopedMatch }]),
    { $sort: { lastSeenAt: -1, entityId: 1 } },
    { $set: {
      accountId: { $convert: { input: { $substrBytes: ['$viewerKey', 5, 24] }, to: 'objectId', onError: null, onNull: null } },
      targetId: { $convert: { input: '$entityId', to: 'objectId', onError: null, onNull: null } },
    } },
    { $lookup: { from: User.collection.name, localField: 'accountId', foreignField: '_id', as: 'account' } },
    { $unwind: '$account' },
    { $match: { 'account.status': { $ne: 'deleted' } } },
    { $lookup: { from: Place.collection.name, localField: 'targetId', foreignField: '_id', as: 'place' } },
    { $lookup: { from: Business.collection.name, localField: 'targetId', foreignField: '_id', as: 'business' } },
    { $set: { target: { $cond: [{ $eq: ['$type', 'place'] }, { $arrayElemAt: ['$place', 0] }, { $arrayElemAt: ['$business', 0] }] } } },
    { $match: { 'target._id': { $exists: true } } },
    { $limit: limit },
    { $project: { entityId: 1, type: 1, lastSeenAt: 1, 'target.name': 1,
      'account._id': 1, 'account.name': 1, 'account.email': 1, 'account.profile': 1 } },
  ])
  return rows.map(row => ({
    id: `view:${row.account._id}:${row.type}:${row.entityId}`,
    type: 'view' as const,
    title: 'Viewed Place',
    userId: String(row.account._id), userName: row.account.name || 'Explorer',
    userEmail: row.account.email, userProfile: row.account.profile,
    subtitle: localizeField(row.target.name),
    targetId: row.entityId, targetType: row.type as 'place' | 'business',
    timestamp: row.lastSeenAt,
  }))
}
