// Read-only: no models are initialized, documents changed, or indexes created/dropped.
const fs = require('node:fs')
const path = require('node:path')
const mongoose = require('mongoose')

async function main() {
  require('dotenv').config({ path: path.join(process.cwd(), '.env'), quiet: true })
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL missing')
  const connection = await mongoose.createConnection(process.env.DATABASE_URL, {
    autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 8000,
  }).asPromise()
  try {
    const db = connection.db
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name)
    const indexes = {}
    for (const name of names.sort()) {
      indexes[name] = (await db.collection(name).listIndexes().toArray()).map(index => ({
        name: index.name, key: index.key, unique: index.name === '_id_' || index.unique === true,
        ...(index.partialFilterExpression ? { partial: index.partialFilterExpression } : {}),
        ...(index.expireAfterSeconds !== undefined ? { expireAfterSeconds: index.expireAfterSeconds } : {}),
      }))
    }
    const oid = new mongoose.Types.ObjectId('000000000000000000000001')
    const since = new Date(Date.now() - 86400000)
    const cases = [
      ['favorites_by_user', 'favourites', { user: oid }, { createdAt: -1 }],
      ['own_reviews', 'reviews', { reviewer: oid }, { createdAt: -1 }],
      ['place_public_reviews', 'reviews', { placeId: oid, status: 'Approved' }, { createdAt: -1 }],
      ['active_users', 'users', { lastActiveAt: { $gte: since } }],
      ['usage_global_recent', 'usageviews', { lastSeenAt: { $gte: since } }],
      ['usage_daily_global_recent', 'usageviewdays', { lastSeenAt: { $gte: since } }],
      ['entity_viewers', 'usageviews', { type: 'place', entityId: String(oid) }, { lastSeenAt: -1 }],
      ['sales_reports', 'payments', { status: 'succeeded', createdAt: { $gte: since } }],
      ['offer_redeemers', 'offerredemptions', { offer: oid }, { redemptionTime: -1 }],
      ['published_map_places', 'places', { map: oid, status: 'Published' }],
      ['own_routes', 'routeplans', { user: oid }, { updatedAt: -1 }],
      ['published_map_places_sorted', 'places', { map: oid, status: 'Published' }, { createdAt: -1 }],
      ['published_map_catalog', 'maps', { status: 'Published', isActive: true }, { createdAt: -1 }],
      ['business_public_reviews', 'reviews', { businessId: oid, status: 'Approved' }, { createdAt: -1 }],
      ['place_reviews_signed_in', 'reviews', { placeId: oid, $or: [{ status: 'Approved' }, { reviewer: oid }] }, { createdAt: -1 }],
      ['business_reviews_signed_in', 'reviews', { businessId: oid, $or: [{ status: 'Approved' }, { reviewer: oid }] }, { createdAt: -1 }],
      ['sales_map_reports', 'payments', { mapId: oid, status: 'succeeded', createdAt: { $gte: since } }],
      ['offer_recent_activity', 'offerredemptions', { redemptionTime: { $gte: since } }],
    ]
    const plans = []
    function summary(value, out = { stages: [], indexes: [] }) {
      if (!value || typeof value !== 'object') return out
      if (value.stage && !out.stages.includes(value.stage)) out.stages.push(value.stage)
      if (value.indexName && !out.indexes.includes(value.indexName)) out.indexes.push(value.indexName)
      for (const child of Object.values(value)) if (child && typeof child === 'object') summary(child, out)
      return out
    }
    for (const [label, collection, filter, sort] of cases) {
      if (!names.includes(collection)) { plans.push({ label, collection, missingCollection: true }); continue }
      try {
        let cursor = db.collection(collection).find(filter).limit(10).maxTimeMS(4000)
        if (sort) cursor = cursor.sort(sort)
        const result = await cursor.explain('queryPlanner') // Does NOT execute the query.
        plans.push({ label, collection, ...summary(result.queryPlanner?.winningPlan || result) })
      } catch (error) { plans.push({ label, collection, error: error.codeName || error.name }) }
    }
    const report = { database: db.databaseName, checkedAt: new Date().toISOString(),
      note: 'Read-only metadata and queryPlanner explains with representative filters; no executionStats or user documents.', indexes, plans }
    fs.writeFileSync(path.join(process.cwd(), 'index-audit.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally { await connection.close() }
}
const watchdog = setTimeout(() => { console.error('Read-only index audit timed out before completion.'); process.exit(1) }, 45000)
main().catch(error => { console.error('Read-only index audit failed:', error.name, error.code || ''); process.exitCode = 1 }).finally(() => clearTimeout(watchdog))
