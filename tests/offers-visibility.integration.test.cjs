const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')
const ts = require('typescript')
const mongoose = require('mongoose')
const vm = require('node:vm')

test('real MongoDB: public offers, staff management, editor pagination and bilingual search', async t => {
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
    const { Place } = require('../src/modules/place/place.model.ts')
    const { Business } = require('../src/modules/business/business.model.ts')
    const { Map: MapModel } = require('../src/modules/map/map.model.ts')
    const { Offer } = require('../src/modules/offer/offer.model.ts')
    const { OfferRedemption } = require('../src/modules/offer/offerRedemption.model.ts')
    const { default: QueryBuilder } = require('../src/builder/QueryBuilder.ts')
    const roles = require('../src/enum/user.ts')
    const enums = require('../src/enum/offer.ts')
    const oid = () => new mongoose.Types.ObjectId()
    const pr = oid(), cr = oid(), p1 = oid(), p2 = oid()
    const active = oid(), inactive = oid(), pending = oid(), other = oid()
    let user = { _id: oid(), role: roles.USER_ROLES.ADMIN }
    const exports = {}
    const imports = {
      mongoose, 'http-status-codes': require('http-status-codes'),
      '../../errors/ApiError': require('../src/errors/ApiError.ts'),
      '../../builder/QueryBuilder': { default: QueryBuilder },
      './offer.model': { Offer }, '../place/place.model': { Place },
      './offerRedemption.model': { OfferRedemption },
      '../business/business.model': { Business }, '../map/map.model': { Map: MapModel },
      '../../enum/user': roles, '../../enum/offer': enums,
      '../../helpers/mapAccessHelper': {
        getUserFromToken: async () => user,
        getAccessibleMapIds: async () => !user ? [] : user.role === 'map_editor'
          ? [...(user.assignedMaps || []).map(String), ...(user.assignedCountries?.includes('Puerto Rico') ? [String(pr)] : [])]
          : [String(pr), String(cr)],
        buildCountryToMapIdLookup: async () => ({}),
        resolveOfferMapId: offer => String(offer.place?.map?._id || ''),
        resolveOfferMapIdAsync: async offer => String(offer.place?.map?._id || ''),
      },
    }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/modules/offer/offer.service.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, require: name => imports[name] || {}, console })
    const service = exports.OfferService
    await MapModel.collection.insertMany([
      { _id: pr, name: { en: 'Island Map', es: 'Mapa de Isla' }, country: 'Puerto Rico' },
      { _id: cr, name: 'Costa Rica', country: 'Costa Rica' },
    ])
    await Place.collection.insertMany([
      { _id: p1, map: pr, country: 'Puerto Rico', name: { en: 'Waterfall', es: 'Cascada' } },
      { _id: p2, map: cr, country: 'Costa Rica', name: 'Beach' },
    ])
    await Business.collection.insertMany([
      { _id: active, name: { en: 'Hotel', es: 'Hotel Isla' }, location: { country: 'Puerto Rico' }, status: 'Approved', hasActiveSubscription: true },
      { _id: inactive, name: 'Cafe', location: { country: 'Island Map' }, status: 'Approved', hasActiveSubscription: false },
      { _id: pending, name: 'Pending Cafe', location: { country: 'Puerto Rico' }, status: 'Pending', hasActiveSubscription: true },
      { _id: other, name: 'Other Cafe', location: { country: 'Costa Rica' }, status: 'Approved', hasActiveSubscription: true },
    ])
    const offer = (name, target, extra = {}) => ({ _id: oid(), title: name, description: 'Details', status: 'Active', createdAt: new Date(), ...target, ...extra })
    const records = [
      offer({ en: 'Waterfall deal', es: 'Oferta cascada' }, { place: p1 }),
      offer('Beach deal', { place: p2 }), offer('Hotel deal', { business: active }),
      offer({ en: 'Breakfast', es: 'Desayuno' }, { business: inactive }),
      offer('Pending deal', { business: pending }, { description: { en: 'secret special', es: 'especial' } }),
      offer('Other deal', { business: other }), offer('Legacy deal', { place: p1 }),
      offer('Paused deal', { business: inactive }, { status: 'Paused' }),
      offer('Orphan deal', { business: oid() }),
    ]
    await Offer.collection.insertMany(records)
    const all = await service.getManagedOffers({ limit: 100 })
    assert.equal(all.meta.total, 9)
    assert.equal(all.data.length, 9, 'management includes inactive/pending business offers')
    const detail = await service.getOfferById(String(records[2]._id))
    assert.equal(String(detail.business._id), String(active), 'business offer details populate without a nonexistent business.map path')
    assert.equal((await service.getManagedOffers({ searchTerm: 'Breakfast' })).meta.total, 1)
    assert.equal((await service.getManagedOffers({ searchTerm: 'Desayuno' })).meta.total, 1)
    assert.equal((await service.getManagedOffers({ searchTerm: 'Cascada' })).meta.total, 2)
    assert.equal((await service.getManagedOffers({ searchTerm: 'Hotel' })).meta.total, 1)
    assert.equal((await service.getManagedOffers({ searchTerm: 'secret special' })).meta.total, 1)
    assert.equal((await service.getManagedOffers({ searchTerm: '.*' })).meta.total, 0)
    assert.equal((await service.getManagedOffers({ status: 'Paused' })).meta.total, 1)
    assert.equal((await service.getManagedOffers({ country: 'Puerto Rico', limit: 100 })).meta.total, 6)
    assert.equal((await service.getManagedOffers({ map: String(cr), country: 'Puerto Rico' })).meta.total, 2)
    assert.equal((await service.getAllOffers({ limit: 100 })).meta.total, 5, 'public subscription/approval gates remain enforced')
    user = { _id: oid(), role: roles.USER_ROLES.MAP_EDITOR, assignedMaps: [pr] }
    const ids = new Set()
    for (let page = 1; page <= 3; page++) {
      const response = await service.getManagedOffers({ page, limit: 2 })
      assert.equal(response.meta.total, 6)
      assert.equal(response.data.length, 2, 'editor scope is applied before pagination')
      response.data.forEach(row => ids.add(String(row._id)))
    }
    assert.equal(ids.size, 6)
    user = { _id: oid(), role: roles.USER_ROLES.MAP_EDITOR, assignedCountries: ['Puerto Rico'] }
    assert.equal((await service.getManagedOffers({})).meta.total, 6, 'country assignments also scope management')
    user = { _id: oid(), role: roles.USER_ROLES.SUPER_ADMIN }
    assert.equal((await service.getManagedOffers({})).meta.total, 9)
    user = { _id: oid(), role: roles.USER_ROLES.MAP_EDITOR, assignedMaps: [], assignedCountries: [] }
    assert.equal((await service.getManagedOffers({})).meta.total, 0)
    user = { _id: oid(), role: roles.USER_ROLES.USER }
    await assert.rejects(service.getManagedOffers({}), /permission/)
    user = null
    await assert.rejects(service.getManagedOffers({}), /permission/)
    const publicOffers = await service.getAllOffers({ limit: 100 })
    assert.equal(publicOffers.meta.total, 5)
    assert.ok(publicOffers.data.every(offer => offer.isLocked && !offer.description))
    assert.equal((await service.getAllOffers({ searchTerm: 'cascada' })).meta.total, 2)
    assert.equal((await service.getAllOffers({ country: 'Puerto Rico', limit: 100 })).meta.total, 3)
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
