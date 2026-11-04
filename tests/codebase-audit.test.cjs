const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function load(file, imports = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => imports[name] || {}, console, ...globals })
  return exports
}
function chain(rows) {
  const query = { then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) }
  for (const method of ['select', 'sort', 'limit', 'populate', 'lean', 'session']) query[method] = () => query
  return query
}
class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }
const id = '123456789012345678901234'
class ObjectId { constructor(value) { this.value = value } toString() { return this.value } static isValid(value) { return /^[a-f\d]{24}$/i.test(String(value)) } }

test('business tracking uses one persisted counting path, including repeat visits', () => {
  const sent = [], requests = [], storage = new Map()
  let now = 100000
  class Clock extends Date { static now() { return now } }
  const { trackUsage } = load('../frontend_giovafilm_roadtripeado/lib/record-visit.ts', {
    '@/redux/store': { default: { getState: () => ({ auth: { accessToken: 'valid-token', user: { id } } }) } },
    '@/lib/socket': { emitWhenReady: (...args) => sent.push(args) },
  }, {
    Date: Clock, document: { cookie: '' }, process: { env: { NEXT_PUBLIC_BASEURL: 'https://example.test/api/v1' } },
    fetch: (...args) => { requests.push(args); return Promise.resolve() },
    window: { localStorage: { getItem: () => 'visitor-id' }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
  })
  trackUsage('business', id); now += 30000; trackUsage('business', id)
  assert.equal(sent.length, 2)
  assert.equal(requests.length, 0, 'socket tracking must not also send an unconditional REST increment')
})

test('empty payment records produce zero revenue in dashboard and reports', async () => {
  const empty = { find: () => chain([]), aggregate: async () => [], distinct: async () => [], countDocuments: async () => 0 }
  const imports = { mongoose: { default: { Types: { ObjectId } } } }
  for (const [module, name] of [['map', 'Map'], ['place', 'Place'], ['offer', 'Offer'], ['business', 'Business'], ['visited', 'Visited'], ['review', 'Review'], ['user', 'User']]) {
    imports[`../${module}/${module}.model`] = { [name]: empty }
  }
  imports['../offer/offerRedemption.model'] = { OfferRedemption: empty }
  imports['./usageView.model'] = { UsageView: empty }
  let payments = []
  imports['../payment/payment.model'] = { Payment: { ...empty, find: () => chain(payments) } }
  const { StatsService } = load('src/modules/stats/stats.service.ts', imports)
  const dashboard = await StatsService.getDashboardData()
  assert.equal(dashboard.stats.totalSales, 0)
  assert.equal(dashboard.stats.thisMonthRevenue, 0)
  const report = await StatsService.getReportsData()
  assert.equal(report.salesAndTaxes.totalSales, 0)
  assert.equal(report.salesAndTaxes.taxesCollected, 0)
  assert.ok(report.salesAndTaxes.monthlyData.every(row => row.totalSales === 0))
  payments = [{ amount: 45, createdAt: new Date() }]
  const paid = await StatsService.getReportsData()
  assert.equal(paid.salesAndTaxes.totalSales, 45)
})

test('editor cannot create a route containing an unassigned map, even if it was purchased', async () => {
  const user = { _id: id, role: 'map_editor', assignedMaps: [id], purchasedMaps: ['223456789012345678901234'] }
  let mapId = '223456789012345678901234', writes = 0
  const { verifyEditorEditAccess } = load('src/helpers/mapAccessHelper.ts', {
    '../enum/user': { USER_ROLES: { ADMIN: 'admin', SUPER_ADMIN: 'super_admin', MAP_EDITOR: 'map_editor' } },
    '../errors/ApiError': { default: ApiError },
    'http-status-codes': { StatusCodes: { FORBIDDEN: 403 } },
    '../modules/map/map.model': { Map: { findById: async value => ({ _id: value, status: 'Draft' }) } },
  })
  const { RoutePlanService } = load('src/modules/route-plan/route-plan.service.ts', {
    mongoose: { default: { Types: { ObjectId } } },
    '../../helpers/mapAccessHelper': { verifyEditorEditAccess },
    '../../errors/ApiError': { default: ApiError },
    'http-status-codes': { StatusCodes: { FORBIDDEN: 403 } },
    '../user/user.model': { User: { findById: () => chain(user) } },
    '../place/place.model': { Place: { findById: () => chain({ _id: id, type: 'Regular', map: mapId }) } },
    './route-plan.model': { RoutePlan: { create: async () => { writes++; return { _id: id } }, findById: () => chain({ _id: id }) } },
  })
  await assert.rejects(RoutePlanService.createRoutePlan(id, { name: 'Route', stops: [{ place: id }] }), { status: 403 })
  assert.equal(writes, 0)
  mapId = id
  await RoutePlanService.createRoutePlan(id, { name: 'Assigned draft', stops: [{ place: id }] })
  assert.equal(writes, 1)
})

test('a business-type Place is saved as a place reference so visited lookups can find it', async () => {
  let created
  const session = { startTransaction() {}, commitTransaction: async () => {}, abortTransaction: async () => {}, endSession() {} }
  const { VisitedService } = load('src/modules/visited/visited.service.ts', {
    mongoose: { default: { Types: { ObjectId }, startSession: async () => session } },
    './visited.model': { Visited: { findOne: () => chain(null), create: async rows => { created = rows[0]; return rows } } },
    '../place/place.model': { Place: { findById: () => chain({ _id: id, type: 'Business' }) } },
    '../business/business.model': { Business: { findByIdAndUpdate: async () => null } },
    '../user/user.model': { User: { findByIdAndUpdate: async () => ({ visitedPlaces: [id] }) } },
  })
  await VisitedService.toggleVisited(id, { placeId: id, type: 'Business' })
  assert.equal(created.type, 'Business')
  assert.equal(created.place, id)
  assert.equal(created.business, undefined)
})
