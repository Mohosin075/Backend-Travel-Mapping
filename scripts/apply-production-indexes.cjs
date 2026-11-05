const fs = require('node:fs')
const path = require('node:path')
const mongoose = require('mongoose')
const plan = require('./production-index-plan.cjs')
const EXPECTED_DATABASE = 'giovafilm-roadtripeado'
const sameKey = (a, b) => JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b))
const ordinary = index => !index.unique && !index.sparse && !index.partialFilterExpression && !index.hidden && index.expireAfterSeconds === undefined

async function preflight(db) {
  if (db.databaseName !== EXPECTED_DATABASE) throw Error('Unexpected database; refusing to create indexes.')
  const collections = [...new Set(plan.map(index => index.collection))]
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name))
  const snapshots = {}, stats = {}
  for (const collection of collections) {
    if (!existing.has(collection)) throw Error(`Required collection missing: ${collection}`)
    snapshots[collection] = await db.collection(collection).listIndexes().toArray()
    const result = await db.command({ collStats: collection, scale: 1 })
    stats[collection] = { count: result.count, size: result.size, storageSize: result.storageSize, totalIndexSize: result.totalIndexSize }
    // Large collection builds need a separate capacity/scheduling review.
    if (result.size > 256 * 1024 * 1024 || result.count > 500000) throw Error(`Collection exceeds conservative online-build limits: ${collection}`)
  }
  const actions = plan.map(index => {
    const indexes = snapshots[index.collection]
    const byName = indexes.find(current => current.name === index.name)
    const byKey = indexes.find(current => sameKey(current.key, index.key))
    if (byName && (!sameKey(byName.key, index.key) || !ordinary(byName))) throw Error(`Conflicting index name/options: ${index.collection}.${index.name}`)
    if (byKey && (byKey.name !== index.name || !ordinary(byKey))) throw Error(`Existing equivalent key needs manual review: ${index.collection}.${byKey.name}`)
    return { ...index, action: byName ? 'skip_existing' : 'create' }
  })
  return { database: db.databaseName, stats, before: snapshots, actions }
}

async function applyIndexes(db, { apply = false, persist, progress = () => {}, shouldStop = () => false } = {}) {
  const report = { startedAt: new Date().toISOString(), ...(await preflight(db)), steps: [] }
  if (!apply) return { ...report, mode: 'dry_run' }
  if (typeof persist !== 'function') throw Error('A snapshot/report writer is required before applying indexes.')
  report.mode = 'apply'
  await persist(report) // Record every existing index before any mutation.
  try {
    for (const index of report.actions) {
      if (shouldStop()) throw Error('Stop requested; no further indexes will be started.')
      if (index.action === 'skip_existing') { report.steps.push({ collection: index.collection, name: index.name, action: 'skipped' }); continue }
      const collection = db.collection(index.collection)
      // Recheck immediately before each build, e.g. if another operator added an index.
      const current = await collection.listIndexes().toArray()
      const byName = current.find(row => row.name === index.name)
      const byKey = current.find(row => sameKey(row.key, index.key))
      if (byName || byKey) {
        if (!byName || byKey?.name !== index.name || !sameKey(byName.key, index.key) || !ordinary(byName)) throw Error(`Concurrent conflicting index: ${index.collection}.${index.name}`)
        report.steps.push({ collection: index.collection, name: index.name, action: 'skipped_concurrent' })
        await persist(report)
        continue
      }
      progress(`Building ${index.collection}.${index.name}`)
      const started = Date.now()
      // Await each build: never build several indexes concurrently. No drop/sync/unique/TTL operations.
      await collection.createIndex(index.key, { name: index.name, maxTimeMS: 120000, writeConcern: { w: 'majority', wtimeoutMS: 10000 } })
      const after = await collection.listIndexes().toArray()
      const created = after.find(row => row.name === index.name)
      if (!created || !sameKey(created.key, index.key) || !ordinary(created)) throw Error(`Unable to verify index: ${index.collection}.${index.name}`)
      await db.command({ ping: 1 })
      report.steps.push({ collection: index.collection, name: index.name, action: 'created', durationMs: Date.now() - started })
      await persist(report)
      progress(`Verified ${index.collection}.${index.name}`)
    }
    for (const [name, before] of Object.entries(report.before)) {
      const after = await db.collection(name).listIndexes().toArray()
      for (const index of before) {
        const retained = after.find(row => row.name === index.name)
        if (!retained || !sameKey(retained.key, index.key)) throw Error(`Existing index changed during migration: ${name}.${index.name}`)
      }
    }
    report.completedAt = new Date().toISOString()
    report.status = 'complete'
    await persist(report)
    return report
  } catch (error) {
    report.status = 'stopped'
    report.error = { name: error.name, code: error.code, message: error.message }
    await persist(report)
    // Additions already completed are retained. Never drop an index as automatic rollback.
    throw error
  }
}

async function main() {
  require('dotenv').config({ path: path.join(process.cwd(), '.env'), quiet: true })
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL missing')
  const connection = await mongoose.createConnection(process.env.DATABASE_URL, {
    autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000, socketTimeoutMS: 180000,
  }).asPromise()
  let stop = false
  process.on('SIGINT', () => { stop = true; console.log('Stopping after the current build finishes.') })
  try {
    const apply = process.argv.includes('--apply')
    const filename = path.join(process.cwd(), apply ? 'index-migration-result.json' : 'index-migration-preflight.json')
    if (apply && fs.existsSync(filename)) throw Error('Existing migration report found; preserve/review it before another apply run.')
    const report = await applyIndexes(connection.db, {
      apply, shouldStop: () => stop, progress: message => console.log(message),
      persist: data => fs.writeFileSync(filename, JSON.stringify(data, null, 2)),
    })
    if (!apply) fs.writeFileSync(filename, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ database: report.database, mode: report.mode, status: report.status,
      pending: report.actions.filter(index => index.action === 'create').length,
      stats: report.stats, steps: report.steps, report: path.basename(filename) }, null, 2))
  } finally { await connection.close() }
}
if (require.main === module) main().catch(error => { console.error('Index migration stopped:', error.name, error.code || '', error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted]')); process.exitCode = 1 })
module.exports = { plan, preflight, applyIndexes, sameKey }
