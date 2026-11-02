const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

// Load source with database/socket dependencies stubbed: no server, credentials or DB.
function load(relative, imports = {}, globals = {}) {
  const exports = {}
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(code, {
    exports, require: name => imports[name] || {}, console, global: globals,
  })
  return exports
}
const plain = value => JSON.parse(JSON.stringify(value))
const privacy = load('src/modules/notification/notification.privacy.ts')
const { sanitizeLocationNotification: sanitize } = privacy
const notification = {
  _id: 'notification', type: 'NEW_LOCATION',
  title: { en: 'Secret waterfall', es: 'Cascada secreta' },
  content: 'Secret waterfall coordinates', actionText: 'Visit Secret waterfall',
  actionUrl: '/places/secret',
  metadata: { mapId: 'paid', placeId: 'secret', placeName: 'Secret waterfall', coordinates: [1, 2] },
}

test('unowned and broadcast notifications contain no place details or direct link', () => {
  for (const ids of [[], ['another-map']]) {
    const result = sanitize(notification, ids)
    assert.equal(result.title.en, 'New place added')
    assert.equal(result.actionUrl, '/maps')
    assert.deepEqual(plain(result.metadata), { mapId: 'paid', canRevealPlace: false })
    assert.equal(JSON.stringify(result).includes('Secret waterfall'), false)
    assert.equal(JSON.stringify(result).includes('/places/secret'), false)
  }
  assert.equal(notification.title.en, 'Secret waterfall', 'stored original must stay intact')
})

test('purchased/free maps and staff retain details', () => {
  assert.equal(sanitize(notification, ['paid']).title.en, 'Secret waterfall')
  assert.equal(sanitize(notification, ['paid']).metadata.canRevealPlace, true)
  assert.equal(sanitize(notification, [], true).title.en, 'Secret waterfall')
  assert.equal(sanitize({ ...notification, metadata: { mapId: { _id: 'free' } } }, ['free']).title.en, 'Secret waterfall')
})

test('legacy missing metadata is hidden; unrelated notifications are preserved', () => {
  assert.equal(sanitize({ ...notification, metadata: undefined }, ['paid']).title.en, 'New place added')
  const other = { ...notification, type: 'NEW_MAP' }
  assert.equal(sanitize(other), other)
})

function chain(rows) {
  const result = { then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) }
  for (const method of ['populate', 'lean', 'sort', 'skip', 'limit', 'select']) result[method] = () => result
  return result
}

test('municipality search retains locked-place teasers for guests and owners', async () => {
  let query
  const rows = [
    { _id: 'locked', name: 'Ponce secret', map: 'paid' },
    { _id: 'owned', name: 'Ponce owned', map: 'owned' },
    { _id: 'free', name: 'Ponce free', map: 'free' },
  ]
  const { PlaceService } = load('src/modules/place/place.service.ts', {
    './place.model': { Place: { find: q => {
      query = q
      const ids = q.$and?.[0]?.map?.$in
      return chain(ids ? rows.filter(row => ids.includes(row.map)) : rows)
    } } },
    '../business/business.model': { Business: { find: () => chain([{ _id: 'business', name: 'Ponce cafe', status: 'Approved' }]) } },
  })
  const guest = await PlaceService.getAllPlaces({ searchTerm: 'Ponce', type: 'Regular', limit: 1 }, false, ['free'])
  assert.equal(query.$and, undefined, 'search must include unowned map pins')
  assert.equal(guest.data.length, 1)
  assert.equal(guest.data[0]._id, 'locked')
  assert.equal(guest.meta.total, 3)
  const owner = await PlaceService.getAllPlaces({ searchTerm: 'Ponce', type: 'Regular' }, false, ['owned', 'free'])
  assert.deepEqual(plain(owner.data.map(p => p._id)).sort(), ['free', 'locked', 'owned'])
  const business = await PlaceService.getAllPlaces({ searchTerm: 'Ponce', type: 'Business' }, false, [])
  assert.equal(business.data[0]._id, 'business')
  await PlaceService.getAllPlaces({ type: 'Regular' }, false, [])
  assert.equal(query.$and, undefined)
  await PlaceService.getAllPlaces({ searchTerm: 'Ponce', type: 'Regular' }, true, [])
  assert.equal(query.$and, undefined)
})

test('socket broadcasts are generic while API responses resolve the recipient access', async () => {
  const events = []
  const enums = load('src/modules/notification/notification.interface.ts', {
    '../../enum/notification': load('src/enum/notification.ts'),
  })
  const { NotificationServices: service } = load('src/modules/notification/notification.service.ts', {
    './notification.interface': enums,
    './notification.privacy': privacy,
    '../../helpers/mapAccessHelper': { getAccessibleMapIds: async user => user?.accessible || [] },
    '../../utils/autoTranslate': { autoTranslateField: async value => value },
    './notification.model': { Notification: { create: async value => value } },
  }, { io: { emit: (event, payload) => events.push({ event, payload }) } })
  await service.dispatchTailoredNotification(notification)
  assert.equal(events[0].payload.data.title.en, 'New place added')
  assert.equal(events[0].payload.data.metadata.placeId, undefined)
  const hidden = await service.sanitizeNotificationResponse([notification], { role: 'user', accessible: [] })
  const owner = await service.sanitizeNotificationResponse([notification], { role: 'user', accessible: ['paid'] })
  assert.equal(hidden[0].title.en, 'New place added')
  assert.equal(owner[0].title.en, 'Secret waterfall')
})

test('notification search excludes hidden names in its query, before counting or paging', async () => {
  let query
  const enums = load('src/modules/notification/notification.interface.ts', {
    '../../enum/notification': load('src/enum/notification.ts'),
  })
  class ObjectId {
    constructor(id) { this.id = id }
    toString() { return this.id }
  }
  const { NotificationServices: service } = load('src/modules/notification/notification.service.ts', {
    './notification.interface': enums,
    './notification.privacy': privacy,
    mongoose: { Types: { ObjectId } },
    '../../helpers/mapAccessHelper': { getAccessibleMapIds: async () => ['owned', 'free'] },
    '../../helpers/paginationHelper': { paginationHelper: { calculatePagination: () => ({ page: 1, skip: 0, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' }) } },
    '../user/user.model': { User: { findById: () => chain({ interest: [] }) } },
    './notification.model': { Notification: {
      find: q => { query = q; return chain([]) },
      countDocuments: async () => 0,
    } },
  })
  await service.getMyNotifications({ authId: 'viewer', role: 'user' }, { searchTerm: 'Secret waterfall' }, {})
  const access = query.$and.find(condition => condition.$or?.[0]?.type?.$ne === 'NEW_LOCATION')
  assert.ok(access, 'search must restrict location notifications before matching their stored title')
  assert.deepEqual(plain(access.$or[1]['metadata.mapId'].$in).slice(0, 2), ['owned', 'free'])
})
