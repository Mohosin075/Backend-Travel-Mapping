const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')
const { plan, preflight, applyIndexes } = require('../scripts/apply-production-indexes.cjs')

function database() {
  const rows = Object.fromEntries([...new Set(plan.map(row => row.collection))].map(name => [name, [{ name: '_id_', key: { _id: 1 }, unique: true }]]))
  const writes = []
  let pending = 0, maxPending = 0
  const db = {
    databaseName: 'giovafilm-roadtripeado',
    listCollections: () => ({ toArray: async () => Object.keys(rows).map(name => ({ name })) }),
    command: async command => command.ping ? { ok: 1 } : { count: 100, size: 10000 },
    collection: name => ({
      listIndexes: () => ({ toArray: async () => rows[name].map(index => ({ ...index })) }),
      createIndex: async (key, options) => {
        pending++; maxPending = Math.max(maxPending, pending)
        await new Promise(resolve => setImmediate(resolve))
        writes.push({ name, key, options }); rows[name].push({ name: options.name, key })
        pending--; return options.name
      },
    }),
  }
  return { db, rows, writes, maxPending: () => maxPending }
}

test('dry-run inspects all planned indexes without modifying any collection', async () => {
  const fixture = database()
  const report = await applyIndexes(fixture.db)
  assert.equal(report.mode, 'dry_run')
  assert.equal(report.actions.length, 13)
  assert.equal(fixture.writes.length, 0)
})

test('index additions are serial, snapshot precedes writes, and retry is idempotent', async () => {
  const fixture = database(), snapshots = []
  const result = await applyIndexes(fixture.db, { apply: true, persist: report => {
    if (!snapshots.length) assert.equal(fixture.writes.length, 0)
    snapshots.push(JSON.parse(JSON.stringify(report)))
  } })
  assert.equal(result.status, 'complete')
  assert.equal(fixture.writes.length, 13)
  assert.equal(fixture.maxPending(), 1)
  for (const write of fixture.writes) {
    assert.equal(write.options.unique, undefined)
    assert.equal(write.options.expireAfterSeconds, undefined)
    assert.equal(write.options.partialFilterExpression, undefined)
  }
  for (const rows of Object.values(fixture.rows)) assert.equal(rows[0].name, '_id_')
  const again = await applyIndexes(fixture.db, { apply: true, persist() {} })
  assert.equal(again.steps.every(step => step.action === 'skipped'), true)
  assert.equal(fixture.writes.length, 13)
})

test('wrong database, index conflicts and large collections abort before any build', async () => {
  for (const mode of ['database', 'key', 'options', 'large']) {
    const fixture = database()
    if (mode === 'database') fixture.db.databaseName = 'other-database'
    if (mode === 'key') fixture.rows.users.push({ name: plan[0].name, key: { different: 1 } })
    if (mode === 'options') fixture.rows.users.push({ name: plan[0].name, key: plan[0].key, unique: true })
    if (mode === 'large') fixture.db.command = async () => ({ count: 999999, size: 1 })
    await assert.rejects(preflight(fixture.db))
    assert.equal(fixture.writes.length, 0)
  }
})

test('a build failure stops later additions and does not drop completed indexes', async () => {
  const fixture = database(), collection = fixture.db.collection
  fixture.db.collection = name => {
    const handle = collection(name)
    if (name === 'usageviews') handle.createIndex = async () => { throw Error('build failed') }
    return handle
  }
  const reports = []
  await assert.rejects(applyIndexes(fixture.db, { apply: true, persist: report => reports.push(JSON.parse(JSON.stringify(report))) }))
  assert.equal(fixture.writes.length, 1)
  assert.ok(fixture.rows.users.some(index => index.name === 'lastActiveAt_-1'))
  assert.equal(reports.at(-1).status, 'stopped')
})

test('every planned index is also declared in the application schema', () => {
  for (const item of plan) {
    const text = fs.readFileSync(path.join(__dirname, '..', item.model), 'utf8')
    const file = ts.createSourceFile(item.model, text, ts.ScriptTarget.Latest, true)
    const keys = []
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'index') {
        const code = `exports.key = (${node.arguments[0].getText(file)});`
        const exports = {}
        vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports })
        keys.push(JSON.stringify(Object.entries(exports.key)))
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    assert.ok(keys.includes(JSON.stringify(Object.entries(item.key))), `${item.model}: ${item.name}`)
  }
})
