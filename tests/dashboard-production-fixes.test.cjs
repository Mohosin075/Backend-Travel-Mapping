const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const frontend = path.resolve(root, '../frontend_giovafilm_roadtripeado')
const front = fs.existsSync(path.join(root, '.dashboard-fixes-stage')) ? path.join(root, '.dashboard-fixes-stage') : frontend
const id = '123456789012345678901234'
const userId = '123456789012345678901235'
const plain = value => JSON.parse(JSON.stringify(value))
function load(file, imports = {}, globals = {}) {
  const exports = {}
  let filename = path.isAbsolute(file) ? file : path.join(root, file)
  if (!fs.existsSync(filename) && filename.startsWith(path.join(root, '.dashboard-fixes-stage') + path.sep)) {
    filename = path.join(frontend, path.relative(path.join(root, '.dashboard-fixes-stage'), filename))
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => imports[name] || {}, console, Date, ...globals })
  return exports
}
function chain(rows) {
  const query = { then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) }
  for (const method of ['sort', 'select', 'lean', 'populate']) query[method] = () => query
  query.limit = () => { throw Error('People must not be silently truncated') }
  return query
}
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(q => matches(row, q))
    if (key === '$and') return value.every(q => matches(row, q))
    const actual = key.split('.').reduce((a, part) => a?.[part], row)
    if (value instanceof RegExp || Object.prototype.toString.call(value) === '[object RegExp]') return typeof actual === 'string' && value.test(actual)
    return actual === value
  })
}
test('the written stone, written rock and accented Spanish searches find saved pending places', async () => {
  const rows = [
    { _id: id, name: { en: 'Written Rock', es: 'La Piedra Escrita' }, status: 'Pending' },
    { _id: 'spanish', name: { es: 'La Piédra Escríta' }, status: 'Draft' },
    { _id: 'unrelated', name: { en: 'Beach' }, status: 'Published' },
  ].map(row => ({ ...row, type: 'Regular' }))
  const { PlaceService } = load('src/modules/place/place.service.ts', {
    './place.model': { Place: { find: query => chain(rows.filter(row => matches(row, query))) } },
  })
  for (const searchTerm of ['the written stone', 'Written Rock', 'la piedra escrita', '  THE   WRITTEN stone  ']) {
    const result = await PlaceService.getAllPlaces({ searchTerm, type: 'Regular' }, true)
    // The service filters type in the database, so put it on fixture records too.
    assert.ok(result.data.some(row => row._id === id), searchTerm)
    assert.equal(result.data.some(row => row._id === 'unrelated'), false)
  }
})

test('daily history preserves an older period and concurrent retries do not inflate legacy counters', async () => {
  const daily = [], increments = []
  const previous = new Date(Date.now() - 3 * 86400000)
  const imports = {
    './usageView.model': { UsageView: {
      find: () => chain([{ _id: id, lastSeenAt: previous, lastCountedAt: previous }]),
      findOneAndUpdate: async () => null, // Another request won the counting-window update.
    } },
    './usageViewDay.model': { UsageViewDay: { updateOne: async (filter, update) => daily.push({ filter, update }) } },
    '../place/place.service': { PlaceService: { incrementOpenCount: async () => increments.push(1) } },
  }
  const { recordUniqueUsage } = load('src/modules/stats/usage.service.ts', imports)
  await recordUniqueUsage({ handshake: { auth: {}, query: {}, headers: {} } }, { type: 'place', id, visitorId: 'browser-guest', token: '' })
  assert.equal(daily.length, 2)
  assert.equal(daily[0].update.$max.lastSeenAt, previous)
  assert.notEqual(daily[0].filter._id, daily[1].filter._id)
  assert.equal(increments.length, 0)
})

test('private accounts use verified user IDs; a guest cannot inherit a stale socket identity', async () => {
  const recorded = [], counts = []
  const { recordUniqueUsage } = load('src/modules/stats/usage.service.ts', {
    '../../config': { default: { jwt: { jwt_secret: 'test' } } },
    '../../helpers/jwtHelper': { jwtHelper: { verifyToken: token => {
      if (token !== 'valid') throw Error('expired')
      return { authId: userId }
    } } },
    './usageView.model': { UsageView: { find: () => chain([]), create: async row => recorded.push(row) } },
    './usageViewDay.model': { UsageViewDay: { updateOne: async () => {} } },
    '../place/place.service': { PlaceService: { incrementOpenCount: async () => counts.push(1) } },
  })
  const socket = { handshake: { auth: { token: 'valid' }, query: {}, headers: {} } }
  await recordUniqueUsage(socket, { type: 'place', id, token: 'valid', visitorId: 'browser-guest' })
  await recordUniqueUsage(socket, { type: 'place', id, token: '', visitorId: 'browser-guest' })
  await recordUniqueUsage(socket, { type: 'place', id, token: 'expired', visitorId: 'browser-guest' })
  assert.equal(recorded[0].viewerKey, `user:${userId}`)
  assert.equal(recorded[1].viewerKey, 'guest:browser-guest')
  assert.equal(recorded.length, 2, 'expired accounts must not be relabelled as guests')
})

test('rankings and drilldowns share the same time-scoped, deduplicated viewer pipeline', async () => {
  const calls = []
  const reporting = load('src/modules/stats/usage-reporting.ts', {
    '../user/user.model': { User: { collection: { name: 'users' } } },
    './usageView.model': { UsageView: { aggregate: async pipeline => { calls.push(plain(pipeline)); return [] } } },
  })
  const range = { $gte: new Date('2026-10-01'), $lte: new Date('2026-10-31T23:59:59.999Z') }
  await reporting.rankedViewers('place', [id], range)
  await reporting.entityViewers('place', id, range)
  for (const pipeline of calls) {
    assert.deepEqual(pipeline[0].$match.lastSeenAt, plain(range))
    assert.deepEqual(pipeline[1].$unionWith.pipeline[0].$match, pipeline[0].$match)
    assert.deepEqual(pipeline[2].$group._id, { type: '$type', entityId: '$entityId', viewerKey: '$viewerKey' })
  }
  assert.equal(calls[0].find(stage => stage.$limit).$limit, 20, 'ranking is bounded')
  assert.equal(calls[1].some(stage => stage.$limit), false, 'every viewer is returned')
})

test('HTTP usage ignores body identity and only passes the authorization header to tracking', async () => {
  let recorded, activityToken, events = 0
  const { StatsController } = load('src/modules/stats/stats.controller.ts', {
    '../../shared/catchAsync': { default: handler => handler },
    '../../shared/sendResponse': { default: () => {} },
    'http-status-codes': { StatusCodes: { OK: 200 } },
    './usage.service': { recordUniqueUsage: async (_socket, payload) => { recorded = payload } },
    './activity.service': { recordAuthenticatedActivity: async token => { activityToken = token; return true } },
    './stats-events': { notifyStatsUpdated: () => events++ },
  }, { global: {} })
  await StatsController.recordUsage({ headers: {}, body: { type: 'place', id, visitorId: 'guest-browser', token: 'forged', userId } }, {})
  assert.equal(recorded.token, '')
  assert.equal(recorded.userId, undefined)
  await StatsController.recordActivity({ headers: { authorization: 'Bearer actual' } }, {})
  assert.equal(activityToken, 'Bearer actual')
  assert.equal(events, 2)
})

test('HTTP tracking is preferred, resets mutation state, and falls back to sockets on failure', async () => {
  for (const failed of [false, true]) {
    const sent = [], dispatched = []
    let reset = 0
    const { trackUsage } = load(path.join(front, 'lib/record-visit.ts'), {
      '@/redux/store': { default: {
        getState: () => ({ auth: { accessToken: 'access', user: { id: userId } } }),
        dispatch: action => { dispatched.push(action); return { unwrap: () => failed ? Promise.reject(Error('offline')) : Promise.resolve(), reset: () => reset++ } },
      } },
      '@/redux/features/stats/statsApi': { statsApi: { endpoints: { recordUsage: { initiate: body => body } } } },
      '@/lib/socket': { emitWhenReady: (...args) => sent.push(args) },
    }, { document: { cookie: '' }, window: {
      localStorage: { getItem: () => 'guest-browser' },
      sessionStorage: { getItem: () => null, setItem() {} },
    } })
    trackUsage('place', id)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].id, id)
    assert.equal(reset, 1)
    assert.equal(sent.length, failed ? 1 : 0)
    if (failed) assert.equal(sent[0][1].token, 'access')
  }
})

test('cancelled gestures and completed drags never trigger a marker tap', () => {
  let arm, finish, move = 0, callback
  const { HoldDragGesture } = load(path.join(frontend, 'lib/hold-drag.ts'), {}, {
    setTimeout: fn => { callback = fn; return 1 }, clearTimeout() {},
  })
  const gesture = new HoldDragGesture({ arm: () => arm = true, move: () => move++, finish: result => finish = result })
  gesture.start(1, { x: 0, y: 0 }); gesture.move(1, { x: 20, y: 0 })
  assert.equal(finish.cancelled, true)
  gesture.start(2, { x: 0, y: 0 }); callback(); gesture.move(2, { x: 20, y: 5 }); gesture.end(2)
  assert.equal(arm, true)
  assert.equal(move, 1)
  assert.equal(finish.armed && finish.moved && !finish.cancelled, true)
})

test('pin wrapper distinguishes a tap from a drag and restores map gestures on release/cancel', () => {
  const jsx = (type, props) => ({ type, props })
  let timer, taps = 0, starts = 0, finishes = 0
  const options = []
  const time = { setTimeout: fn => { timer = fn; return 1 }, clearTimeout() {} }
  const gesture = load(path.join(frontend, 'lib/hold-drag.ts'), {}, time)
  const projection = { current: {
    fromLatLngToContainerPixel: () => ({ x: 0, y: 0 }),
    fromContainerPixelToLatLng: point => ({ lat: () => point.y, lng: () => point.x }),
  } }
  const { HoldToDragMarker } = load(path.join(front, 'components/dashboard/places/hold-to-drag-marker.tsx'), {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: { createContext: () => ({}), useContext: () => projection, useEffect: fn => fn(),
      useRef: value => ({ current: value }), useState: value => [value, () => {}] },
    '@vis.gl/react-google-maps': { AdvancedMarker: 'marker', useMap: () => ({ get: () => 'greedy', setOptions: value => options.push(value) }) },
    '@/lib/hold-drag': gesture,
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ language: 'en' }) },
  }, { google: { maps: { Point: class { constructor(x, y) { this.x = x; this.y = y } }, LatLng: class {} } } })
  const marker = HoldToDragMarker({ position: { lat: 1, lng: 2 }, onClick: () => taps++, onDragStart: () => starts++, onDragEnd: () => finishes++ })
  const element = marker.props.children
  const event = { isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0,
    preventDefault() {}, stopPropagation() {}, currentTarget: { setPointerCapture() {} } }
  element.props.onPointerDown(event); element.props.onPointerUp(event); element.props.onClickCapture(event)
  assert.equal(taps, 1, 'one tap opens one panel')
  element.props.onPointerDown(event); timer()
  assert.equal(starts, 1); assert.equal(finishes, 0)
  element.props.onPointerMove({ ...event, clientX: 20, clientY: 10 })
  element.props.onPointerUp(event); element.props.onClickCapture(event)
  assert.equal(finishes, 1); assert.equal(taps, 1, 'drag does not open the tap panel')
  assert.equal(options.at(-1).gestureHandling, 'greedy')
  element.props.onPointerDown(event); element.props.onPointerCancel()
  assert.equal(options.at(-1).gestureHandling, 'greedy')
})

test('visible authenticated activity sends immediately and every 30 seconds without overlapping requests', async () => {
  const effects = [], listeners = {}, socketListeners = {}
  let interval, calls = 0, reset = 0
  const document = { hidden: false, addEventListener: (name, fn) => listeners[name] = fn, removeEventListener() {} }
  const { SocketProvider } = load(path.join(front, 'components/shared/socket-provider.tsx'), {
    'react/jsx-runtime': { jsx: () => null },
    react: { useEffect: fn => effects.push(fn) },
    '@/lib/socket': { getSocket: () => ({ on: (name, fn) => socketListeners[name] = fn, off() {} }) },
    '@/redux/hook': { useAppSelector: fn => fn({ auth: { accessToken: 'token', user: { role: 'user' } } }), useAppDispatch: () => () => {} },
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ language: 'en' }) },
    '@/redux/features/stats/statsApi': { useRecordActivityMutation: () => [() => {
      calls++; return { unwrap: async () => {}, reset: () => reset++ }
    }] },
  }, { document, setInterval: (fn, ms) => { assert.equal(ms, 30000); interval = fn; return 1 }, clearInterval() {} })
  SocketProvider({ children: null }); effects[0]()
  assert.equal(calls, 1)
  interval(); assert.equal(calls, 1, 'in-flight request is coalesced')
  await new Promise(resolve => setImmediate(resolve))
  interval(); assert.equal(calls, 2)
  await new Promise(resolve => setImmediate(resolve))
  document.hidden = true; interval(); assert.equal(calls, 2)
  document.hidden = false; listeners.visibilitychange(); assert.equal(calls, 3)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reset, 3)
})

test('reports include more than 100 private active accounts and do not infer visits from profile edits', async () => {
  const users = Array.from({ length: 150 }, (_, i) => ({
    _id: (i + 1).toString(16).padStart(24, '0'), name: `Private ${i}`,
    email: `user${i}@example.com`, settings: { profileStatus: 'anonymous' }, lastActiveAt: new Date(),
  }))
  let active = true
  const presenceQueries = []
  const emptyChain = rows => { const result = chain(rows); result.limit = () => result; return result }
  const empty = { find: () => emptyChain([]), aggregate: async () => [], distinct: async () => [], countDocuments: async () => 0 }
  class ObjectId { constructor(value) { this.value = value } toString() { return this.value } static isValid(value) { return /^[a-f\d]{24}$/i.test(String(value)) } }
  const imports = { mongoose: { default: { Types: { ObjectId } } } }
  for (const [module, name] of [['map', 'Map'], ['place', 'Place'], ['offer', 'Offer'], ['business', 'Business'], ['visited', 'Visited'], ['review', 'Review']]) {
    imports[`../${module}/${module}.model`] = { [name]: empty }
  }
  imports['../offer/offerRedemption.model'] = { OfferRedemption: empty }
  imports['../payment/payment.model'] = { Payment: empty }
  const viewScopes = []
  imports['./recent-place-views'] = { recentPlaceViews: async scope => {
    viewScopes.push(scope)
    return [{ id: 'view:beach', type: 'view', title: 'Viewed Place', userName: 'Private Viewer', targetType: 'place', targetId: id, timestamp: new Date() }]
  } }
  imports['./usage-reporting'] = {
    rankedViewers: async () => [],
    distinctViewers: async () => active ? users.map(u => `user:${u._id}`) : [],
  }
  imports['../user/user.model'] = { User: {
    collection: { name: 'users' },
    countDocuments: async () => users.length,
    distinct: async (_field, query) => { presenceQueries.push(query); return [] },
    find: query => query._id ? chain(active ? users : []) : emptyChain([]),
  } }
  const { StatsService } = load('src/modules/stats/stats.service.ts', imports)
  const report = await StatsService.getReportsData()
  assert.equal(report.userActivity.recentActivities[0].type, 'view')
  assert.equal(report.userActivity.totalPlacesVisited, 0)
  assert.equal(report.userActivity.activeUsersToday, 150)
  assert.equal(report.userActivity.activeTodayList.length, 150)
  assert.equal(report.userActivity.activeTodayList[149].name, 'Private 149')
  assert.equal(report.userActivity.activeTodayList[149].email, 'user149@example.com')
  assert.ok(presenceQueries.every(query => query.lastActiveAt && !JSON.stringify(query).includes('updatedAt')))
  active = false
  const idle = await StatsService.getReportsData()
  assert.equal(idle.userActivity.activeUsersToday, 0)
  assert.equal(idle.userActivity.activeUsersList.length, 0)
  await StatsService.getReportsData({ entityType: 'map', entityId: id, timeFilter: 'last_month' })
  assert.equal(viewScopes[2].type, 'place', 'selected map includes its place views, not only map opens')
  assert.deepEqual(plain(viewScopes[2].entityId), { $in: [] }, 'empty map never leaks unrelated views')
  assert.ok(viewScopes[2].lastSeenAt.$gte instanceof Date)
  assert.ok(viewScopes[2].lastSeenAt.$lte instanceof Date)
  await StatsService.getReportsData({ country: 'Puerto Rico', category: id })
  assert.deepEqual(plain(viewScopes[3]), { _id: { $in: [] } }, 'empty country/category scope never becomes an unfiltered feed')
})

test('a delayed tracking failure cannot be reassigned after an account switch or logout', async () => {
  for (const nextSession of ['different', 'logout', 'refreshed']) {
    let auth = { accessToken: 'account-a', user: { id: 'a' } }, reject
    const sent = []
    const { trackUsage } = load(path.join(front, 'lib/record-visit.ts'), {
      '@/redux/store': { default: {
        getState: () => ({ auth }),
        dispatch: () => ({ unwrap: () => new Promise((_resolve, fail) => { reject = fail }), reset() {} }),
      } },
      '@/redux/features/stats/statsApi': { statsApi: { endpoints: { recordUsage: { initiate: body => body } } } },
      '@/lib/socket': { emitWhenReady: (...args) => sent.push(args) },
    }, { document: { cookie: '' }, window: {
      localStorage: { getItem: () => 'guest-browser' }, sessionStorage: { getItem: () => null, setItem() {} },
    } })
    trackUsage('place', id)
    auth = nextSession === 'different' ? { accessToken: 'account-b', user: { id: 'b' } }
      : nextSession === 'refreshed' ? { accessToken: 'fresh-account-a', user: { id: 'a' } }
      : { accessToken: null, user: null }
    reject({ status: 'FETCH_ERROR' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(sent.length, nextSession === 'refreshed' ? 1 : 0)
    if (nextSession === 'refreshed') assert.equal(sent[0][1].token, 'fresh-account-a')
  }
})

test('relocation only patches coordinates after confirmation; cancel and failure restore the pin', async () => {
  for (const outcome of ['confirm', 'cancel', 'dismiss', 'failure']) {
    let positions = {}, resolveAlert, selected = 'old'
    const mutations = [], errors = [], gate = { current: false }
    const move = pageHandler('handleMarkerDragEnd', {
      useCallback: fn => fn, pinMoveInFlight: gate,
      displayPlaces: [{ _id: id }], draggedPositions: {}, language: 'en',
      placeDetailsRequest: { current: 0 },
      setDraggedPositions: fn => { positions = fn(positions) },
      setSelectedPlace: value => { selected = value }, setActivePoi() {},
      appAlert: { fire: () => new Promise(resolve => { resolveAlert = resolve }) },
      updatePlace: payload => { mutations.push(plain(payload)); return { unwrap: async () => {
        if (outcome === 'failure') throw { data: { message: 'Not authorized' } }
      } } },
      toast: { success() {}, error: value => errors.push(value) },
    })
    const pending = move(id, { lat: 18, lng: -66 })
    assert.equal(mutations.length, 0)
    assert.equal(selected, null)
    await move(id, { lat: 19, lng: -65 })
    resolveAlert({ isConfirmed: ['confirm', 'failure'].includes(outcome) })
    await pending
    assert.equal(gate.current, false)
    assert.equal(mutations.length, ['confirm', 'failure'].includes(outcome) ? 1 : 0)
    if (mutations.length) assert.deepEqual(mutations[0], { id, data: { location: { type: 'Point', coordinates: [-66, 18] } } })
    assert.deepEqual(plain(positions), outcome === 'confirm' ? { [id]: { lat: 18, lng: -66 } } : {})
    if (outcome === 'failure') assert.deepEqual(errors, ['Not authorized'])
  }
})

test('mobile logout belongs to the same scroll container as the profile options', () => {
  const filename = path.join(front, 'components/shared/navigation/header.tsx')
  const file = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let scroll, footer
  function visit(node) {
    if (ts.isJsxElement(node)) {
      const attrs = node.openingElement.attributes.properties.map(p => p.name?.getText(file))
      if (attrs.includes('data-profile-menu-scroll')) scroll = node
      if (attrs.includes('data-profile-menu-footer')) footer = node
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(scroll && footer)
  assert.ok(footer.pos > scroll.pos && footer.end < scroll.end)
})

test('a fast refetch clears the saved pin override even while the mutation is settling', () => {
  const filename = path.join(front, 'components/dashboard/places/add-place-page.tsx')
  const file = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect' &&
      node.arguments[0]?.getText(file).includes('coordsChanged([pos.lng, pos.lat], coords)')) callback = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(callback)
  let positions = { [id]: { lat: 18, lng: -66 }, other: { lat: 1, lng: 2 } }
  const exports = {}
  vm.runInNewContext(ts.transpileModule(`exports.run = ${callback.getText(file)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports, pinMoveInFlight: { current: true },
    fetchedPlaces: [{ _id: id, location: { coordinates: [-66, 18] } }],
    coordsChanged: (a, b) => a.some((value, index) => value !== b[index]),
    setDraggedPositions: fn => { positions = fn(positions) },
  })
  exports.run()
  assert.deepEqual(plain(positions), { other: { lat: 1, lng: 2 } })
})

test('viewed activity keeps account/date scope and excludes maps, guests and removed records', async () => {
  let pipeline
  const { recentPlaceViews } = load('src/modules/stats/recent-place-views.ts', {
    './usageView.model': { UsageView: { aggregate: async stages => { pipeline = plain(stages); return [{
      type: 'place', entityId: id, lastSeenAt: new Date(),
      account: { _id: userId, name: 'Explorer' }, target: { name: { en: 'Beach' } },
    }] } } },
    './usage-reporting': { viewerPipeline: match => [{ $match: match }] },
    '../user/user.model': { User: { collection: { name: 'users' } } },
    '../place/place.model': { Place: { collection: { name: 'places' } } },
    '../business/business.model': { Business: { collection: { name: 'businesses' } } },
    '../../helpers/localize': { localizeField: value => value.en },
  })
  const scope = { viewerKey: `user:${userId}`, lastSeenAt: { $gte: 'start' } }
  const result = await recentPlaceViews(scope, 50)
  assert.deepEqual(pipeline[0].$match.$and[0], scope)
  assert.deepEqual(pipeline[0].$match.$and[1].type.$in, ['place', 'business'])
  assert.equal(pipeline[0].$match.$and[1].viewerKey.$regex, '^user:[a-fA-F0-9]{24}$')
  assert.ok(pipeline.some(p => p.$match?.['account.status']?.$ne === 'deleted'))
  assert.ok(pipeline.some(p => p.$match?.['target._id']?.$exists))
  assert.ok(pipeline.some(p => p.$limit === 50))
  assert.equal(result[0].type, 'view')
  assert.equal(result[0].subtitle, 'Beach')
  assert.equal(result[0].userId, userId)
})

// Execute the actual page callbacks with controlled asynchronous detail requests.
// This verifies the save gate without mounting Google Maps or contacting the API.
function pageHandler(name, globals) {
  const filename = path.join(front, 'components/dashboard/places/add-place-page.tsx')
  const file = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) initializer = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(initializer, `${name} callback exists`)
  const exports = {}
  vm.runInNewContext(ts.transpileModule(`exports.callback = ${initializer.getText(file)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, ...globals })
  return exports.callback
}

test('existing-place Save is blocked during loading, after a failure, and for another place', async () => {
  for (const details of [null, { id, status: 'loading' }, { id, status: 'error' }, { id: userId, status: 'ready' }]) {
    const errors = [], mutations = []
    const save = pageHandler('handleSavePlace', {
      selectedPlace: { _id: id, isNew: false }, placeDetailsState: details,
      formData: { description: '' }, language: 'en', toast: { error: value => errors.push(value) },
      createPlace: () => mutations.push('create'), updatePlace: () => mutations.push('update'),
    })
    await save()
    assert.equal(errors.length, 1)
    assert.equal(mutations.length, 0)
  }
})

test('detail loading only becomes editable after the correct full record arrives; failures allow retry', async () => {
  for (const result of ['success', 'failure', 'wrong-id', 'empty']) {
    let selected = { _id: id, position: { lat: 20, lng: 30 } }, details, resolve, reject
    const ref = { current: 0 }
    const select = pageHandler('handleSelectPlace', {
      placeDetailsRequest: ref, setActivePoi() {}, setDraggedPositions() {}, setSelectedCategoryId() {}, setFormData() {},
      setPlaceDetailsState: value => details = value,
      setSelectedPlace: fn => selected = fn(selected), normalizePlaceType: () => 'Regular',
      fetchPlaceDetails: () => ({ unwrap: () => new Promise((ok, fail) => { resolve = ok; reject = fail }) }),
    })
    const pending = select({ _id: id, name: 'Slim pin', category: 'category', location: { coordinates: [3, 2] } })
    assert.equal(details.status, 'loading')
    if (result === 'failure') reject(Error('offline'))
    else resolve({ data: result === 'empty' ? null : { _id: result === 'wrong-id' ? userId : id, description: 'Full description', location: { coordinates: [3, 2] } } })
    await pending
    assert.equal(details.status, result === 'success' ? 'ready' : 'error')
    if (result === 'success') {
      assert.equal(selected.description, 'Full description')
      assert.equal(selected.position.lat, 20, 'dragged coordinates survive full-detail hydration')
      assert.equal(selected.position.lng, 30)
    }
  }
})

test('a fully loaded pin saves its new coordinates while retaining existing content and images', async () => {
  const writes = [], errors = []
  const payload = load(path.join(frontend, 'components/dashboard/places/place-payload.ts'))
  const save = pageHandler('handleSavePlace', {
    selectedPlace: { _id: id, isNew: false, location: { coordinates: [3, 2] } },
    placeDetailsState: { id, status: 'ready' }, tempMarker: null,
    draggedPositions: { [id]: { lat: 20, lng: 30 } }, selectedMapId: 'map', selectedMap: { country: 'Puerto Rico' }, selectedCategoryId: 'category',
    ...payload, language: 'en', t: key => key,
    toast: { error: value => errors.push(value), success() {} },
    updatePlace: request => ({ unwrap: async () => writes.push(request) }),
    setDraggedPositions() {}, setSelectedPlace() {}, setTempMarker() {}, setFormData() {}, setSelectedCategoryId() {}, console,
  })
  await save({ name: 'Written Rock', description: 'Original details', status: 'Draft', existingImages: ['cover.jpg'], existingMenuImages: [], schedules: 'Original schedule' })
  assert.equal(errors.length, 0)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].id, id)
  assert.deepEqual(plain(writes[0].data.location.coordinates), [30, 20])
  assert.equal(writes[0].data.description, 'Original details')
  assert.equal(writes[0].data.status, 'Draft')
  assert.deepEqual(plain(writes[0].data.media), ['cover.jpg'])
  assert.equal(writes[0].data.schedules, 'Original schedule')
})

test('authenticated tracking limits are per verified account, while guest limits remain IP-based', () => {
  const routes = [], limit = () => {}, authenticate = () => {}
  let config
  const router = { get() {}, post: (...args) => routes.push(args) }
  load('src/modules/stats/stats.route.ts', {
    express: { default: { Router: () => router } },
    '../../enum/user': { USER_ROLES: {} },
    '../../middleware/auth': { default: () => authenticate },
    './stats.controller': { StatsController: {} },
    'express-rate-limit': { rateLimit: options => { config = options; return limit }, ipKeyGenerator: ip => `normalized:${ip}` },
  })
  assert.equal(routes[0][1], authenticate)
  assert.equal(routes[0][2], limit)
  assert.equal(routes[1][2], limit)
  assert.notEqual(config.keyGenerator({ user: { authId: 'a' } }), config.keyGenerator({ user: { authId: 'b' } }))
  assert.equal(config.keyGenerator({ ip: '127.0.0.1' }), 'guest:normalized:127.0.0.1')
})
