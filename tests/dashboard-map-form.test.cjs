const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const jsx = (type, props) => ({ type, props })
function load(file, imports = {}, globals = {}) {
  const exports = {}
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : imports[name] || {}, console, ...globals })
  return exports
}
const plain = value => JSON.parse(JSON.stringify(value))
function clock() {
  let now = 0, id = 0
  const timers = new Map()
  return { setTimeout: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id }, clearTimeout: id => timers.delete(id),
    advance(ms) { now += ms; for (const [id, task] of timers) if (task.at <= now) { timers.delete(id); task.fn() } },
  }
}

test('pin drag arms only after 2000 ms and early movement/cancel never commits', () => {
  const time = clock(), events = []
  const { HoldDragGesture } = load('../frontend_giovafilm_roadtripeado/lib/hold-drag.ts', {}, time)
  const gesture = new HoldDragGesture({ arm: () => events.push('armed'), move: delta => events.push(delta), finish: value => events.push(value) })
  gesture.start(1, { x: 0, y: 0 }); time.advance(1999)
  assert.equal(events.length, 0)
  time.advance(1); assert.equal(events[0], 'armed')
  gesture.move(1, { x: 20, y: 30 }); gesture.end(1)
  assert.deepEqual(plain(events.at(-1)), { cancelled: false, armed: true, moved: true })
  events.length = 0
  gesture.start(1, { x: 0, y: 0 }); gesture.move(1, { x: 15, y: 0 }); time.advance(2000)
  assert.deepEqual(plain(events), [{ cancelled: true, armed: false, moved: false }])
  events.length = 0
  gesture.start(1, { x: 0, y: 0 }); gesture.cancel(); time.advance(2000)
  assert.equal(events.includes('armed'), false)
})

test('dashboard marker receives pointer events, projects held movement and restores map gestures', () => {
  const time = clock(), commits = [], selected = [], options = []
  const effects = []
  const { HoldDragGesture } = load('../frontend_giovafilm_roadtripeado/lib/hold-drag.ts', {}, time)
  const projection = { current: {
    fromLatLngToContainerPixel: () => ({ x: 100, y: 100 }),
    fromContainerPixelToLatLng: pixel => ({ lat: () => pixel.y, lng: () => pixel.x }),
  } }
  const react = { createContext: () => ({}), useContext: () => projection, useRef: value => ({ current: value }), useState: value => [value, () => {}], useEffect: callback => effects.push(callback) }
  const { HoldToDragMarker } = load('../frontend_giovafilm_roadtripeado/components/dashboard/places/hold-to-drag-marker.tsx', {
    react, '@/lib/hold-drag': { HoldDragGesture },
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ language: 'en' }) },
    '@vis.gl/react-google-maps': { AdvancedMarker: 'marker', useMap: () => ({ get: () => 'greedy', setOptions: value => options.push(value) }) },
  }, { google: { maps: { Point: class { constructor(x, y) { this.x = x; this.y = y } }, LatLng: class {} } } })
  const tree = HoldToDragMarker({ position: { lat: 18, lng: -66 }, onClick: () => selected.push(true), onDragEnd: value => commits.push(value) })
  effects.forEach(callback => callback())
  assert.equal(tree.props.clickable, true)
  assert.equal(tree.props.draggable, false)
  const props = tree.props.children.props
  const event = { isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {}, currentTarget: { setPointerCapture() {} } }
  props.onPointerDown(event); time.advance(2000)
  props.onPointerMove({ ...event, clientX: 20, clientY: 10 }); props.onPointerUp(event)
  assert.deepEqual(plain(commits), [{ lat: 110, lng: 120 }])
  assert.equal(options.at(-1).gestureHandling, 'greedy')
  props.onClickCapture(event); assert.equal(selected.length, 0, 'drag must not generate a second selection click')
  props.onPointerDown(event); props.onPointerUp(event)
  assert.equal(selected.length, 1, 'short tap remains selectable')
})

test('always-open recognizes stored EN/ES variants and leaves regular or negative schedules unchecked', () => {
  const schedule = load('../frontend_giovafilm_roadtripeado/lib/place-schedule.ts')
  for (const value of ['Always open', 'Siempre abierto', '24/7', 'Abierto 24/7', 'Always open (24/7)', { es: 'Siempre abierto' }]) {
    assert.equal(schedule.isAlwaysOpenSchedule(value), true)
    assert.equal(schedule.normalizePlaceSchedule(value), 'Always open')
  }
  for (const value of ['', null, undefined, '09:00 - 18:00', 'Not always open', 'Closed except 24/7 emergencies']) assert.equal(schedule.isAlwaysOpenSchedule(value), false)
})

test('dashboard draft marker uses brand yellow without changing public marker defaults', () => {
  const memo = value => value
  const { CategoryMarker } = load('../frontend_giovafilm_roadtripeado/components/shared/maps/category-marker.tsx', {
    react: { default: { memo }, memo },
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ language: 'en' }) },
    '@/lib/utils': { getLocalized: value => value || '' },
  })
  const branded = CategoryMarker({ icon: 'pin', color: '#fabf13', status: 'Draft', statusAccent: '#fabf13' })
  assert.equal(find(branded, node => node.type === 'path').props.stroke, '#fabf13')
  const normal = CategoryMarker({ icon: 'pin', status: 'Draft' })
  assert.equal(find(normal, node => node.type === 'path').props.stroke, '#D97706')
})

function find(node, predicate) {
  if (!node) return null
  if (Array.isArray(node)) { for (const item of node) { const found = find(item, predicate); if (found) return found } return null }
  if (typeof node !== 'object') return null
  return predicate(node) ? node : find(node.props?.children, predicate)
}
test('unchecking always-open survives a parent render and saves the unchecked value', async () => {
  const hooks = [], effects = [], saved = []
  let cursor = 0, dirty, tree
  const react = {
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], value => { const next = typeof value === 'function' ? value(hooks[index]) : value; if (!Object.is(next, hooks[index])) { hooks[index] = next; dirty = true } }] },
    useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial } },
    useEffect(fn, deps) { const index = cursor++, previous = hooks[index]; if (!previous || deps.some((dep, i) => !Object.is(dep, previous[i]))) { hooks[index] = deps; effects.push(fn) } },
  }
  const payload = load('../frontend_giovafilm_roadtripeado/components/dashboard/places/place-payload.ts')
  const schedule = load('../frontend_giovafilm_roadtripeado/lib/place-schedule.ts')
  const utils = load('../frontend_giovafilm_roadtripeado/lib/utils.ts', { '@/lib/config': { env: {} } })
  const { PlaceFormContent } = load('../frontend_giovafilm_roadtripeado/components/dashboard/places/PlaceFormContent.tsx', {
    react: { ...react, default: react }, './place-payload': payload, '@/lib/place-schedule': schedule,
    '@/lib/utils': utils,
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ language: 'en', t: key => key }) },
    'motion/react': { motion: { div: 'div' } },
    '@/components/ui/button': { Button: 'button' },
    '@/components/ui/checkbox': { Checkbox: 'checkbox' },
    sonner: { toast: { error() {} } },
  }, { window: { addEventListener() {}, removeEventListener() {} }, setTimeout: () => 1, clearTimeout() {} })
  let initialData = { name: 'Place', category: 'category', description: 'Description', address: 'Address', schedules: 'Siempre abierto', images: ['https://example.test/image.jpg'], isNew: false, difficulty: { en: 'medium' }, hikeTime: { es: '1,5 horas' }, entryCost: { en: '$10' }, atmosphere: { es: 'Tranquilo' } }
  const props = { categories: [], isSaving: false, onSave: async value => saved.push(value), onClose() {} }
  const render = () => {
    dirty = true; let loops = 0
    while (dirty) { assert.ok(++loops < 12); dirty = false; cursor = 0; tree = PlaceFormContent({ ...props, initialData }); while (effects.length) effects.shift()() }
  }
  render()
  const checkbox = () => find(tree, node => node.props?.id === 'always-open')
  assert.equal(checkbox().props.checked, true)
  find(tree, node => node.props?.value === 'Place' && typeof node.props?.onChange === 'function').props.onChange({ target: { value: 'Unsaved place name' } })
  render()
  checkbox().props.onCheckedChange(false); render()
  initialData = { ...initialData, address: 'Updated address' }; render()
  assert.equal(checkbox().props.checked, false)
  const save = find(tree, node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('common.save_changes'))
  assert.ok(save)
  await save.props.onClick()
  assert.equal(saved[0].schedules, '')
  assert.equal(saved[0].name, 'Unsaved place name')
  assert.equal(saved[0].difficulty, 'Moderate')
  assert.equal(saved[0].hikeTime, '1.5 hours')
  assert.equal(saved[0].entryCost, '$10')
  assert.equal(saved[0].atmosphere, 'Tranquilo')
})

test('view tracking sends app token on HTTP failure even without a cookie, including separate accounts', async () => {
  const sent = [], sessions = new Map(), local = new Map()
  let state = { auth: { accessToken: 'token-one', user: { id: 'user-one' } } }
  const { trackUsage } = load('../frontend_giovafilm_roadtripeado/lib/record-visit.ts', {
    '@/redux/store': { default: {
      getState: () => state,
      dispatch: () => ({ unwrap: async () => { throw { status: 'FETCH_ERROR' } }, reset() {} }),
    } },
    '@/redux/features/stats/statsApi': { statsApi: { endpoints: { recordUsage: { initiate: body => body } } } },
    '@/lib/socket': { emitWhenReady: (event, payload) => sent.push({ event, payload }) },
  }, { document: { cookie: '' }, process: { env: {} }, window: {
    localStorage: { getItem: key => local.get(key), setItem: (key, value) => local.set(key, value) },
    sessionStorage: { getItem: key => sessions.get(key), setItem: (key, value) => sessions.set(key, value) },
  } })
  const id = '123456789012345678901234'
  trackUsage('place', id)
  await new Promise(resolve => setImmediate(resolve))
  state = { auth: { accessToken: 'token-two', user: { id: 'user-two' } } }
  trackUsage('place', id)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent.length, 2)
  assert.equal(sent[0].payload.token, 'token-one')
  assert.equal(sent[1].payload.token, 'token-two')
  state = { auth: { accessToken: null, user: null } }
  trackUsage('place', id)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent[2].payload.token, '')
})

test('guest view never inherits a previous signed-in socket account', async () => {
  const queries = [], created = []
  const { recordUniqueUsage } = load('src/modules/stats/usage.service.ts', {
    '../../config': { default: { jwt: { jwt_secret: 'test' } } },
    '../../helpers/jwtHelper': { jwtHelper: { verifyToken: () => ({ authId: '111111111111111111111111' }) } },
    './usageView.model': { UsageView: {
      find: query => { queries.push(query); const chain = { sort: () => chain, lean: async () => [] }; return chain },
      create: async value => created.push(value),
    } },
    './usageViewDay.model': { UsageViewDay: { updateOne: async () => {} } },
    '../place/place.service': { PlaceService: { incrementOpenCount: async () => {} } },
  })
  await recordUniqueUsage({ handshake: { auth: { token: 'old-account-token' }, headers: {} } }, {
    type: 'place', id: '123456789012345678901234', visitorId: 'guest-visitor', token: '',
  })
  assert.equal(created[0].viewerKey, 'guest:guest-visitor')
  assert.deepEqual(plain(queries[0].viewerKey.$in), ['guest:guest-visitor'])
})
