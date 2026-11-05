import { PipelineStage } from 'mongoose'
import { UsageView } from './usageView.model'

/** Both rankings and drilldowns count the same distinct recorded viewers.
 * Legacy last-seen records remain available; missing historical visits cannot be inferred.
 */
export const viewerPipeline = (match: Record<string, any>): PipelineStage[] => [
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
]

export const rankedViewers = (type: string, ids: string[], dateRange: any) =>
  UsageView.aggregate([
    ...viewerPipeline({ type, entityId: { $in: ids }, ...(dateRange ? { lastSeenAt: dateRange } : {}) }),
    { $group: { _id: '$entityId', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 20 },
  ])

export const entityViewers = (type: string, id: string, dateRange: any) =>
  UsageView.aggregate([
    ...viewerPipeline({ type, entityId: id, ...(dateRange ? { lastSeenAt: dateRange } : {}) }),
    { $sort: { lastSeenAt: -1, viewerKey: 1 } },
  ])

export const distinctViewers = async (match: Record<string, any>): Promise<string[]> => {
  const rows = await UsageView.aggregate([
    ...viewerPipeline(match),
    { $group: { _id: '$viewerKey' } },
  ])
  return rows.map(row => String(row._id))
}
