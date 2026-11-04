const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, imports) {
  const exports = {}
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => imports[name] || {}, console })
  return exports
}
function chain(rows) {
  const result = { then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) }
  for (const key of ['select', 'lean', 'populate', 'sort']) result[key] = () => result
  return result
}
class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }
const roles = { ADMIN: 'admin', SUPER_ADMIN: 'super_admin', MAP_EDITOR: 'map_editor' }

test('assigned editor can edit drafts; unrelated editors and regular users cannot', async () => {
  const { verifyEditorEditAccess } = load('src/helpers/mapAccessHelper.ts', {
    '../enum/user': { USER_ROLES: roles },
    '../errors/ApiError': { default: ApiError },
    'http-status-codes': { StatusCodes: { FORBIDDEN: 403, UNAUTHORIZED: 401, NOT_FOUND: 404 } },
    '../modules/map/map.model': { Map: { findById: async () => ({ _id: 'draft', status: 'Draft', isActive: false, country: 'Puerto Rico' }) } },
  })
  assert.equal(await verifyEditorEditAccess({ role: 'map_editor', assignedMaps: ['draft'] }, 'draft'), true)
  assert.equal(await verifyEditorEditAccess({ role: 'map_editor', assignedMaps: [], assignedCountries: [' puerto rico '] }, 'draft'), true)
  await assert.rejects(verifyEditorEditAccess({ role: 'map_editor', assignedMaps: ['other'] }, 'draft'), { status: 403 })
  await assert.rejects(verifyEditorEditAccess({ role: 'user', assignedMaps: ['draft'] }, 'draft'), { status: 403 })
})

const entityId = '123456789012345678901234'
function stats(rows, users, redemptions = []) {
  const queries = []
  const { StatsService } = load('src/modules/stats/stats.service.ts', {
    mongoose: { default: { isValidObjectId: id => /^[a-f\d]{24}$/i.test(id) } },
    '../../errors/ApiError': { default: ApiError },
    'http-status-codes': { StatusCodes: { BAD_REQUEST: 400 } },
    './usageView.model': { UsageView: { find: query => { queries.push(query); return chain(rows) } } },
    '../user/user.model': { User: { find: () => chain(users) } },
    '../offer/offerRedemption.model': { OfferRedemption: { find: query => { queries.push(query); return chain(redemptions) } } },
  })
  return { service: StatsService, queries }
}

test('view drilldowns identify viewers and guests with the selected time window', async () => {
  for (const type of ['place', 'map', 'business']) {
    const { service, queries } = stats([
      { viewerKey: 'user:123456789012345678901235', lastSeenAt: new Date() },
      { viewerKey: 'guest:one' },
    ], [{ _id: '123456789012345678901235', name: 'Viewer' }])
    const result = await service.getEntityUsers(type, entityId, 'today')
    assert.equal(result.users.length, 1)
    assert.equal(result.users[0].action, 'Viewed')
    assert.equal(result.guestCount, 1)
    assert.equal(queries[0].type, type)
    assert.ok(queries[0].lastSeenAt.$gte)
    assert.ok(queries[0].lastSeenAt.$lte)
  }
})

test('offer drilldown deduplicates people while preserving redemption count', async () => {
  const user = { _id: '123456789012345678901235', name: 'Redeemer' }
  const latest = new Date('2026-11-04T10:00:00Z')
  const { service, queries } = stats([], [], [
    { user, redemptionTime: latest },
    { user, redemptionTime: new Date('2026-11-03T10:00:00Z') },
  ])
  const result = await service.getEntityUsers('offer', entityId, 'today')
  assert.equal(result.users.length, 1)
  assert.equal(result.totalCount, 2)
  assert.equal(result.users[0].date.getTime(), latest.getTime())
  assert.ok(queries[0].redemptionTime.$gte)
})

test('invalid report ids and types fail before querying MongoDB', async () => {
  const { service, queries } = stats([], [])
  await assert.rejects(service.getEntityUsers('place', 'invalid'), { status: 400 })
  await assert.rejects(service.getEntityUsers('unknown', entityId), { status: 400 })
  assert.equal(queries.length, 0)
})

test('viewer lists include every recorded account and tolerate malformed/deleted accounts', async () => {
  const viewers = Array.from({ length: 250 }, (_, index) => ({ _id: (index + 1).toString(16).padStart(24, '0'), name: `Viewer ${index}` }))
  const rows = viewers.map(user => ({ viewerKey: `user:${user._id}` }))
  rows.push({ viewerKey: 'user:invalid' }, { viewerKey: 'user:ffffffffffffffffffffffff' }, { viewerKey: 'guest:visitor' })
  const { service, queries } = stats(rows, viewers)
  const result = await service.getEntityUsers('place', entityId)
  assert.equal(result.users.length, 250)
  assert.equal(result.users[249].name, 'Viewer 249')
  assert.equal(result.guestCount, 1)
  assert.equal(result.unavailableCount, 2)
  assert.equal(result.totalCount, 253)
})

test('managed map list scopes assignments before pagination without excluding drafts', async () => {
  let assignmentQuery, listQuery, response
  const { MapController } = load('src/modules/map/map.controller.ts', {
    '../../shared/catchAsync': { default: handler => handler },
    '../../shared/sendResponse': { default: (_res, payload) => { response = payload } },
    '../../enum/user': { USER_ROLES: roles },
    '../../helpers/localize': { localizeDocument: value => value },
    '../../helpers/mapAccessHelper': { getUserFromToken: async () => ({ role: 'map_editor', assignedMaps: ['draft'], assignedCountries: ['U.S.A.'] }) },
    './map.model': { Map: { find: query => { assignmentQuery = query; return chain([{ _id: 'draft' }]) } } },
    './map.service': { MapService: { getAllMaps: async query => {
      listQuery = query
      return { data: [{ _id: 'draft', status: 'Draft', isActive: false }], meta: { total: 1 } }
    } } },
    'http-status-codes': { StatusCodes: { OK: 200 } },
  })
  await MapController.getManagedMaps({ headers: {}, query: { page: '2', limit: '10' } }, {})
  assert.deepEqual(Array.from(listQuery._id.$in), ['draft'])
  assert.equal(listQuery.page, '2')
  assert.equal(listQuery.status, undefined)
  assert.equal(listQuery.isActive, undefined)
  assert.equal(response.data[0].status, 'Draft')
  const countryRegex = assignmentQuery.$or[1].country.$in[0]
  assert.equal(countryRegex.test('U.S.A.'), true)
  assert.equal(countryRegex.test('UXSXA.'), false)
})

test('managed maps rejects a downgraded database role even with an old staff token', async () => {
  const { MapController } = load('src/modules/map/map.controller.ts', {
    '../../shared/catchAsync': { default: handler => handler },
    '../../enum/user': { USER_ROLES: roles },
    '../../helpers/mapAccessHelper': { getUserFromToken: async () => ({ role: 'user' }) },
    '../../errors/ApiError': { default: ApiError },
    'http-status-codes': { StatusCodes: { FORBIDDEN: 403 } },
  })
  await assert.rejects(MapController.getManagedMaps({ headers: {}, query: {} }, {}), { status: 403 })
})

test('profile returns only earned rewards and all activities for see more', async () => {
  let awardQuery, awardSort
  const visits = Array.from({ length: 25 }, (_, i) => ({ visitedAt: new Date(2026, 0, i + 1) }))
  const reviews = Array.from({ length: 18 }, (_, i) => ({ createdAt: new Date(2026, 1, i + 1) }))
  const offers = Array.from({ length: 17 }, (_, i) => ({ redemptionTime: new Date(2026, 2, i + 1) }))
  const { UserServices } = load('src/modules/user/user.service.ts', {
    mongoose: { Types: { ObjectId: { isValid: () => true } } },
    '../../enum/user': { USER_STATUS: { DELETED: 'deleted' } },
    './user.model': { User: { findOne: () => chain({ level: 1, purchasedMaps: [] }) } },
    '../award/levelConfig.service': { LevelConfigServices: { getDynamicUserLevel: async () => ({ levelNumber: 1 }) } },
    '../award/award.model': { Award: { find: query => {
      awardQuery = query
      const result = chain([{ isUnlocked: true, target: 10 }])
      result.sort = sort => { awardSort = sort; return result }
      return result
    } } },
    '../visited/visited.model': { Visited: { find: () => chain(visits) } },
    '../review/review.model': { Review: { find: () => chain(reviews) } },
    '../offer/offerRedemption.model': { OfferRedemption: { find: () => chain(offers) } },
  })
  const profile = await UserServices.getUserById(entityId)
  assert.equal(awardQuery.isUnlocked, true)
  assert.equal(awardSort.target, 1)
  assert.equal(profile.activityTimeline.length, 60)
  assert.equal(profile.activityTimeline[0].type, 'offer_claimed')
  assert.equal(profile.activityTimeline[59].type, 'place_visit')
})
