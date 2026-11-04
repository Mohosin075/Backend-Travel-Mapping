const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const front = '../frontend_giovafilm_roadtripeado/'
const jsx = (type, props) => ({ type, props })
function load(file, imports = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : imports[name] || {}, console, ...globals })
  return exports
}
const plain = value => JSON.parse(JSON.stringify(value))
const id = '123456789012345678901234'
test('later visits in the same tab reach tracking while rapid remounts remain suppressed', () => {
  const sessions = new Map(), sent = []
  let now = 100000
  class Clock extends Date { static now() { return now } }
  const { trackUsage } = load(front + 'lib/record-visit.ts', {
    '@/redux/store': { default: { getState: () => ({ auth: { accessToken: 'token', user: { id } } }) } },
    '@/lib/socket': { emitWhenReady: (...args) => sent.push(args) },
  }, { Date: Clock, document: { cookie: '' }, window: {
    localStorage: { getItem: () => 'visitor-id' },
    sessionStorage: { getItem: key => sessions.get(key), setItem: (key, value) => sessions.set(key, value) },
  } })
  trackUsage('place', id)
  now += 1000; trackUsage('place', id)
  assert.equal(sent.length, 1)
  now += 29000; trackUsage('place', id)
  assert.equal(sent.length, 2)
  assert.equal(sent[1][0], 'track-usage')
  assert.equal(sent[1][1].token, 'token')
})
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(item => find(item, predicate)).find(Boolean)
  if (!node || typeof node !== 'object') return null
  return predicate(node) ? node : find(node.props?.children, predicate)
}

test('authenticated activity validates tokens and throttles writes without changing profile updatedAt', async () => {
  const writes = []
  const { recordAuthenticatedActivity } = load('src/modules/stats/activity.service.ts', {
    '../../config': { default: { jwt: { jwt_secret: 'test' } } },
    '../../helpers/jwtHelper': { jwtHelper: { verifyToken: token => { if (token !== 'valid') throw Error('invalid'); return { authId: id } } } },
    '../user/user.model': { User: { updateOne: async (...args) => { writes.push(args); return { modifiedCount: 1 } } } },
  })
  assert.equal(await recordAuthenticatedActivity(), false)
  assert.equal(await recordAuthenticatedActivity('invalid'), false)
  assert.equal(writes.length, 0)
  assert.equal(await recordAuthenticatedActivity('Bearer valid'), true)
  assert.equal(writes[0][0]._id, id)
  assert.equal(writes[0][0].status.$ne, 'deleted')
  assert.equal(writes[0][1].$set.lastActiveAt - writes[0][0].$or[1].lastActiveAt.$lt, 25000)
  assert.equal(writes[0][2].timestamps, false)
})

test('repeat views refresh presence without inflating views or sliding the counting window', async () => {
  const writes = []; let increments = 0
  const lastSeenAt = new Date(Date.now() - 3600000)
  const { recordUniqueUsage } = load('src/modules/stats/usage.service.ts', {
    './usageView.model': { UsageView: {
      find: () => ({ sort: () => ({ lean: async () => [{ _id: id, lastSeenAt }] }) }),
      updateOne: async (...args) => writes.push(args),
    } },
    '../place/place.service': { PlaceService: { incrementOpenCount: async () => increments++ } },
  })
  await recordUniqueUsage({ handshake: { auth: {}, headers: {} } }, { type: 'place', id, visitorId: 'guest-visitor', token: '' })
  assert.equal(increments, 0)
  assert.equal(writes[0][1].$set.lastCountedAt, lastSeenAt)
  assert.ok(writes[1][1].$max.lastSeenAt > lastSeenAt)
})

test('private review identities remain visible to administrators and owners only', () => {
  const { sanitizeReviewIdentity } = load('src/helpers/profilePrivacy.ts')
  const review = { text: 'Review', reviewer: { _id: id, name: 'Real Name', email: 'private@test', settings: { profileStatus: 'private' } } }
  for (const requester of [undefined, { authId: 'other' }, { role: 'map_editor' }]) {
    const result = sanitizeReviewIdentity(review, requester)
    assert.equal(result.reviewer.name, 'Anonymous User')
    assert.equal(result.reviewer.email, undefined)
  }
  for (const requester of [{ authId: id }, { role: 'admin' }, { role: 'super_admin' }]) assert.equal(sanitizeReviewIdentity(review, requester).reviewer.name, 'Real Name')
  assert.equal(review.reviewer.name, 'Real Name')
})

test('translated medium difficulty and Spanish decimal hiking times load into editable controls', () => {
  const { normalizeDifficulty } = load(front + 'components/dashboard/places/place-payload.ts')
  const { parseHikeTime, composeHikeTime } = load(front + 'lib/utils.ts')
  for (const value of ['medium', 'Medio', 'Media', { en: 'medium', es: 'Medio' }, { es: 'Moderada' }]) assert.equal(normalizeDifficulty(value), 'Moderate')
  assert.deepEqual(plain(parseHikeTime({ es: '1,5 horas' })), { value: '1.5', unit: 'hours' })
  assert.equal(composeHikeTime('1.5', 'hours'), '1.5 hours')
  assert.deepEqual(plain(parseHikeTime(0)), { value: '0', unit: 'mins' })
})

test('list editor passes draft status to the form and saves drafts without publishing', async () => {
  const sent = []
  const payload = load(front + 'components/dashboard/places/place-payload.ts')
  const { UpdatePlaceModal } = load(front + 'components/dashboard/places/UpdatePlaceModal.tsx', {
    react: { useEffect() {} },
    './PlaceFormContent': { PlaceFormContent: 'place-form' },
    './place-payload': payload,
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ t: key => key }) },
    '@/redux/features/category/categoryApi': { useGetCategoriesQuery: () => ({}) },
    '@/redux/features/place/placeApi': {
      useGetPlaceDetailsQuery: () => ({ currentData: { data: { name: 'Draft place', status: 'Draft', map: id } } }),
      useUpdatePlaceMutation: () => [value => ({ unwrap: async () => sent.push(value) }), {}],
    },
    sonner: { toast: { success() {}, error() {} } },
  })
  const form = find(UpdatePlaceModal({ placeId: id, open: true, onOpenChange() {} }), node => node.type === 'place-form')
  assert.equal(form.props.initialData.status, 'Draft')
  await form.props.onSave({ name: 'Edited draft', status: 'Draft', map: id })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].data.status, 'Draft')
})

test('report activity includes tracked viewers with real private identities and never fabricates active users', async () => {
  let active = true
  const user = { _id: id, name: 'Private Viewer', settings: { profileStatus: 'private' }, updatedAt: new Date(), lastActiveAt: new Date() }
  const chain = rows => {
    const query = { then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) }
    for (const key of ['select', 'sort', 'limit', 'populate', 'lean']) query[key] = () => query
    return query
  }
  const empty = { find: () => chain([]), aggregate: async () => [], distinct: async () => [], countDocuments: async () => 0 }
  class ObjectId { constructor(value) { this.value = value } toString() { return this.value } static isValid(value) { return /^[a-f\d]{24}$/i.test(String(value)) } }
  const imports = { mongoose: { default: { Types: { ObjectId } } } }
  for (const [module, name] of [['map', 'Map'], ['place', 'Place'], ['offer', 'Offer'], ['business', 'Business'], ['visited', 'Visited'], ['review', 'Review']]) imports[`../${module}/${module}.model`] = { [name]: empty }
  imports['../offer/offerRedemption.model'] = { OfferRedemption: empty }
  imports['../payment/payment.model'] = { Payment: { ...empty, countDocuments: async () => 1 } }
  imports['./usageView.model'] = { UsageView: { ...empty, distinct: async () => active ? [`user:${id}`] : [] } }
  imports['../user/user.model'] = { User: { ...empty, find: () => chain([user]), countDocuments: async () => 1 } }
  const { StatsService } = load('src/modules/stats/stats.service.ts', imports)
  const report = await StatsService.getReportsData()
  assert.equal(report.userActivity.activeUsersToday, 1)
  assert.equal(report.userActivity.activeTodayList[0].name, 'Private Viewer')
  active = false
  const idle = await StatsService.getReportsData()
  assert.equal(idle.userActivity.activeUsersToday, 0)
  assert.equal(idle.userActivity.activeUsersList.length, 0)
})

test('dashboard search retains La Piedra Escrita even when another record shares its English alias', async () => {
  const rows = [
    { _id: 'other', name: { en: 'Written Rock', es: 'Otro lugar' }, address: { es: 'Near La Piedra Escrita' }, status: 'Draft' },
    { _id: id, name: { en: 'Written Rock', es: 'La Piedra Escrita' }, address: { es: 'Jayuya' }, status: 'Pending' },
  ]
  const matches = []
  const { PlaceService } = load('src/modules/place/place.service.ts', {
    './place.model': { Place: { find: filter => {
      matches.push(filter)
      const query = { then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) }
      for (const key of ['populate', 'lean', 'sort']) query[key] = () => query
      return query
    } } },
  })
  const result = await PlaceService.getAllPlaces({ type: 'Regular', searchTerm: 'La Piedra Escrita' }, true)
  assert.equal(result.meta.total, 2)
  assert.equal(result.data[0]._id, id)
  assert.equal(matches[0].status, undefined, 'search must not silently hide saved pending records')
  assert.ok(JSON.stringify(matches[0]).includes('name.es'), 'database query must search Spanish names')
})
