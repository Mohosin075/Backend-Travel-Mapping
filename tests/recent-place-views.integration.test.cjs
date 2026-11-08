const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')
const ts = require('typescript')
const mongoose = require('mongoose')

test('real MongoDB: latest viewed activity, account/entity scopes, historical dates and unavailable records', async t => {
  const executable = process.env.MONGOD_TEST_BINARY || 'mongod'
  const version = spawnSync(executable, ['--version'], { windowsHide: true, timeout: 10000 })
  if (version.error?.code === 'ENOENT') return t.skip('Local mongod is not installed')
  assert.equal(version.status, 0)
  const tempRoot = path.resolve(os.tmpdir())
  const dbPath = fs.mkdtempSync(path.join(tempRoot, 'giovafilm-view-test-'))
  const port = await new Promise(resolve => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const selected = server.address().port
      server.close(() => resolve(selected))
    })
  })
  const mongo = spawn(executable, ['--dbpath', dbPath, '--bind_ip', '127.0.0.1', '--port', String(port)], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = new Promise(resolve => mongo.once('exit', resolve))
  const originalLoader = require.extensions['.ts']
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test MongoDB did not start within 20 seconds')), 20000)
      mongo.once('error', error => { clearTimeout(timer); reject(error) })
      mongo.once('exit', code => { clearTimeout(timer); reject(new Error(`Test MongoDB exited: ${code}`)) })
      mongo.stdout.on('data', chunk => {
        if (chunk.toString().includes('Waiting for connections')) { clearTimeout(timer); resolve() }
      })
      mongo.stderr.resume()
    })
    // Never read application configuration or connect to a shared database.
    await mongoose.connect(`mongodb://127.0.0.1:${port}/isolated_view_test`, { autoIndex: false })
    require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText, filename)
    const { recentPlaceViews } = require('../src/modules/stats/recent-place-views.ts')
    const { UsageView } = require('../src/modules/stats/usageView.model.ts')
    const { UsageViewDay } = require('../src/modules/stats/usageViewDay.model.ts')
    const { User } = require('../src/modules/user/user.model.ts')
    const { Place } = require('../src/modules/place/place.model.ts')
    const { Business } = require('../src/modules/business/business.model.ts')
    const oid = () => new mongoose.Types.ObjectId()
    const accountA = oid(), accountB = oid(), deleted = oid(), missing = oid()
    const place = oid(), business = oid(), gone = oid(), map = oid()
    await User.collection.insertMany([
      { _id: accountA, name: 'Account A', status: 'active', email: 'a@example.test' },
      { _id: accountB, name: 'Account B', status: 'active', email: 'b@example.test' },
      { _id: deleted, name: 'Removed', status: 'deleted' },
    ])
    await Place.collection.insertOne({ _id: place, name: { en: 'Beach', es: 'Playa' } })
    await Business.collection.insertOne({ _id: business, name: { en: 'Cafe', es: 'Cafe' } })
    const view = (user, type, entity, date = '2026-11-08T12:00:00Z') => ({
      viewerKey: `user:${user}`, type, entityId: String(entity), lastSeenAt: new Date(date),
    })
    await UsageView.collection.insertMany([
      view(accountA, 'place', place), view(accountA, 'business', business),
      view(accountB, 'place', place), view(accountA, 'map', map),
      { ...view(accountA, 'place', place), viewerKey: 'guest:browser-123' },
      view(deleted, 'place', place), view(missing, 'place', place),
      view(accountA, 'place', gone), view(accountA, 'place', 'malformed-id'),
      view(accountA, 'business', place),
    ])
    await UsageViewDay.collection.insertMany([
      { _id: 'oct3', ...view(accountA, 'place', place, '2026-10-03T12:00:00Z') },
      { _id: 'oct4', ...view(accountA, 'place', place, '2026-10-04T12:00:00Z') },
      { _id: 'duplicate-lifetime', ...view(accountA, 'place', place) },
    ])
    const all = await recentPlaceViews({})
    assert.equal(all.length, 3)
    assert.ok(all.every(row => row.type === 'view' && row.title === 'Viewed Place'))
    assert.deepEqual(new Set(all.map(row => row.userName)), new Set(['Account A', 'Account B']))
    const profile = await recentPlaceViews({ viewerKey: `user:${accountA}` })
    assert.equal(profile.length, 2)
    assert.ok(profile.every(row => row.userId === String(accountA)))
    const scoped = await recentPlaceViews({ type: 'place', entityId: String(place) })
    assert.equal(scoped.length, 2)
    assert.ok(scoped.every(row => row.targetId === String(place)))
    const historic = await recentPlaceViews({ lastSeenAt: {
      $gte: new Date('2026-10-01T00:00:00Z'), $lte: new Date('2026-10-31T23:59:59Z'),
    } })
    assert.equal(historic.length, 1)
    assert.equal(historic[0].timestamp.toISOString(), '2026-10-04T12:00:00.000Z')
    assert.equal((await recentPlaceViews({ entityId: { $in: [] } })).length, 0)
    assert.equal((await recentPlaceViews({}, 1)).length, 1)
    assert.equal((await recentPlaceViews({ lastSeenAt: { $gte: new Date('2026-11-01') } })).length, 3)
  } finally {
    require.extensions['.ts'] = originalLoader
    await mongoose.disconnect()
    mongo.kill()
    await exited
    const resolved = path.resolve(dbPath)
    assert.ok(resolved.startsWith(tempRoot + path.sep) && path.basename(resolved).startsWith('giovafilm-view-test-'))
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
