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
const country = load('../frontend_giovafilm_roadtripeado/lib/offer-country.ts')
const costaRica = { _id: 'cr', name: { en: 'Costa Rica Adventures', es: 'Aventuras Costa Rica' }, country: 'Costa Rica' }
const puertoRico = { _id: 'pr', name: 'Puerto Rico', country: 'Puerto Rico' }

test('offer search accepts legacy strings, translated names, missing metadata and literal punctuation', () => {
  const { offerMatchesSearch } = load('../frontend_giovafilm_roadtripeado/lib/offer-search.ts')
  const offer = { title: { en: 'Breakfast', es: 'Desayuno' }, place: { name: { en: 'Beach', es: 'Playa' } } }
  assert.equal(offerMatchesSearch(offer, 'breakfast'), true)
  assert.equal(offerMatchesSearch(offer, 'DESAYUNO'), true)
  assert.equal(offerMatchesSearch(offer, 'playa'), true)
  assert.equal(offerMatchesSearch(offer, 'missing'), false)
  assert.equal(offerMatchesSearch(offer, '.*'), false)
  assert.equal(offerMatchesSearch({}, ''), true)
  assert.equal(offerMatchesSearch({}, 'anything'), false)
  assert.equal(offerMatchesSearch({ title: 'Legacy offer' }, 'legacy'), true)
  assert.equal(offerMatchesSearch({ business: { location: { city: 'San Juan' } } }, 'san juan'), true)
})

test('managed offer route requires staff auth and is registered before the offer ID route', () => {
  const calls = []
  const chain = { get() { return chain }, post() { return chain }, patch() { return chain }, delete() { return chain } }
  const router = {
    get: (...args) => calls.push(args), post() {},
    route: name => { calls.push([name]); return chain },
  }
  const managed = () => {}
  load('src/modules/offer/offer.route.ts', {
    express: { default: { Router: () => router } },
    './offer.controller': { OfferController: { getManagedOffers: managed } },
    '../../middleware/auth': { default: (...roles) => ({ roles }) },
    '../../middleware/processReqBody': { fileAndBodyProcessorUsingDiskStorage: () => () => {} },
    '../../middleware/validateRequest': { default: () => () => {} },
    '../../enum/user': { USER_ROLES: { ADMIN: 'admin', SUPER_ADMIN: 'super_admin', MAP_EDITOR: 'map_editor', USER: 'user' } },
  })
  assert.equal(calls[0][0], '/managed')
  assert.deepEqual(plain(calls[0][1].roles), ['admin', 'super_admin', 'map_editor'])
  assert.equal(calls[0][2], managed)
  assert.ok(calls.findIndex(call => call[0] === '/:id') > 0)
})

test('offer country follows saved map ID despite a stale or translated country label', () => {
  assert.equal(country.resolveOfferMap([puertoRico, costaRica], 'cr', 'Puerto Rico'), costaRica)
  assert.equal(country.resolveOfferMap([puertoRico, costaRica], '', 'aventuras costa rica'), costaRica)
  assert.equal(country.resolveOfferMap([puertoRico, costaRica], '', 'Costa Rica'), costaRica)
  assert.equal(country.resolveOfferMap([puertoRico], 'cr', ''), null)
  assert.equal(country.resolveOfferMap([puertoRico], 'cr', 'Puerto Rico'), null)
  assert.equal(country.offerMatchesCountry({ place: { map: { _id: 'cr' } } }, costaRica, ''), true)
  assert.equal(country.offerMatchesCountry({ business: { location: { country: 'Costa Rica' } } }, costaRica, ''), true)
  assert.equal(country.offerMatchesCountry({ business: { location: { country: 'Aventuras Costa Rica' } } }, costaRica, ''), true)
  assert.equal(country.offerMatchesCountry({ place: { map: puertoRico, country: 'Puerto Rico' } }, costaRica, ''), false)
  assert.equal(country.offerMatchesCountry({ business: { location: { country: 'Puerto Rico' } } }, costaRica, ''), false)
  assert.equal(country.offerMatchesCountry({ business: {} }, costaRica, ''), false)
})

function chain(rows) {
  const query = { then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) }
  for (const key of ['select', 'lean', 'populate']) query[key] = () => query
  return query
}
test('backend map filter takes precedence over conflicting country and includes both map languages', async () => {
  let mapQuery, placeQuery, offerFilter
  class ObjectId { constructor(value) { this.value = value } toString() { return this.value } static isValid(value) { return /^[a-f\d]{24}$/i.test(value) } }
  class QueryBuilder {
    constructor(query) { this.modelQuery = query }
    filter() { return this } sort() { return this } paginate() { return this } fields() { return this }
    getPaginationInfo() { return {} }
  }
  const id = '123456789012345678901234'
  const { OfferService } = load('src/modules/offer/offer.service.ts', {
    mongoose: { Types: { ObjectId } },
    '../../builder/QueryBuilder': { default: QueryBuilder },
    '../map/map.model': { Map: { find: query => { mapQuery = query; return chain([{ ...costaRica, _id: id }]) } } },
    '../place/place.model': { Place: { find: query => { placeQuery = query; return chain([{ _id: 'cr-place' }]) } } },
    '../business/business.model': { Business: { find: query => chain(query.$or ? [{ _id: 'cr-business' }] : []) } },
    './offer.model': { Offer: { find: query => { offerFilter = query; return chain([]) } } },
    '../../helpers/mapAccessHelper': { getUserFromToken: async () => null, getAccessibleMapIds: async () => [], buildCountryToMapIdLookup: async () => ({}) },
  })
  await OfferService.getAllOffers({ map: id, country: 'Puerto Rico' })
  assert.equal(mapQuery.$or.length, 1)
  assert.equal(String(mapQuery.$or[0]._id), id)
  const regexes = placeQuery.$or.find(condition => condition.country).country.$in
  assert.ok(regexes.some(regex => regex.test('Costa Rica')))
  assert.ok(regexes.some(regex => regex.test('Costa Rica Adventures')))
  assert.ok(regexes.some(regex => regex.test('Aventuras Costa Rica')))
  assert.equal(regexes.some(regex => regex.test('Puerto Rico')), false)
  assert.deepEqual(plain(offerFilter.$and[1]), { $or: [{ place: { $in: ['cr-place'] } }, { business: { $in: ['cr-business'] } }] })
})

function find(node, predicate) {
  if (!node) return null
  if (Array.isArray(node)) { for (const item of node) { const match = find(item, predicate); if (match) return match } return null }
  if (typeof node !== 'object') return null
  return predicate(node) ? node : find(node.props?.children, predicate)
}

// Exercise the editor handlers and effects without a server, credentials or database.
function editorHarness({ fail = false, create = false, fetching = false } = {}) {
  const hooks = [], effects = [], navigation = [], updates = [], errors = []
  const storage = new Map()
  let cursor = 0, dirty = true, tree
  const route = { _id: 'route-one', name: 'Original name', stops: [{ place: { _id: 'place-one', name: 'Stop', location: { coordinates: [-66, 18] } } }] }
  let direct = { currentData: { data: route }, isFetching: fetching }
  let routes = { data: { data: [] }, isLoading: false }
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [hooks[index], value => { const next = typeof value === 'function' ? value(hooks[index]) : value; if (!Object.is(next, hooks[index])) { hooks[index] = next; dirty = true } }]
    },
    useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial } },
    useEffect(callback, deps) {
      const index = cursor++, old = hooks[index]
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
        hooks[index] = { deps }
        effects.push(callback)
      }
    },
  }
  const { RoutePlannerInner } = load('../frontend_giovafilm_roadtripeado/app/(common)/route-planner/page.tsx', {
    react,
    'next/navigation': { useRouter: () => ({ replace: url => navigation.push(url) }), useSearchParams: () => new URLSearchParams(create ? 'mode=create' : 'routeId=route-one&mode=edit') },
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ language: 'en', t: (key, fallback) => fallback || key }) },
    '@/components/shared/login-required-modal': { useLoginRequired: () => ({ openLoginRequired() {} }) },
    '@/redux/hook': { useAppSelector: () => 'token' },
    '@/lib/utils': { getLocalized: value => typeof value === 'string' ? value : '', getUsableMediaUrl: () => '' },
    '@/redux/features/route-plan/routePlanApi': {
      useGetMyRoutePlansQuery: () => routes,
      useGetRoutePlanByIdQuery: () => direct,
      useCreateRoutePlanMutation: () => [payload => ({ unwrap: async () => { updates.push(payload); if (fail) throw Error('failed'); return { data: { _id: 'created-route' } } } }), { isLoading: false }],
      useUpdateRoutePlanMutation: () => [payload => ({ unwrap: async () => { updates.push(payload); if (fail) throw Error('failed'); return { data: route } } }), { isLoading: false }],
    },
    sonner: { toast: { success() {}, info() {}, error: value => errors.push(value) } },
  }, {
    URLSearchParams, process: { env: {} },
    window: { addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  })
  const render = () => {
    dirty = true
    let count = 0
    while (dirty) {
      assert.ok(++count < 15, 'render must settle')
      dirty = false; cursor = 0; tree = RoutePlannerInner()
      while (effects.length) effects.shift()()
    }
    return tree
  }
  const button = name => find(tree, node => node.props?.onClick?.name === name)
  return { render, button, storage, updates, navigation, errors,
    rename(value) { find(tree, node => node.type === 'input' && node.props.value === (create ? 'New Roadtrip Route' : 'Original name')).props.onChange({ target: { value } }); render() },
    refetch() { direct = { currentData: { data: { ...route, name: 'Old server name' } } }; routes = { data: { data: [route] }, isLoading: false }; render() },
    finishFetch(name) { direct = { currentData: { data: { ...route, name } }, isFetching: false }; render() },
    failFetch() { direct = { currentData: { data: route }, isFetching: false, isError: true }; render() },
    getTree: () => tree,
  }
}

test('route edits survive query refetch, save correctly and navigate to read-only view', async () => {
  const h = editorHarness()
  h.render(); h.rename('My edited route'); h.refetch()
  await h.button('handleSaveRoute').props.onClick()
  assert.equal(h.updates[0].id, 'route-one')
  assert.equal(h.updates[0].data.name, 'My edited route')
  assert.equal(h.navigation[0], '/saved-routes?viewRouteId=route-one')
  h.render()
  assert.equal(h.storage.has('roadtripeado_draft_route'), false)
})

test('failed route save stays in the editor and retains draft', async () => {
  const h = editorHarness({ fail: true })
  h.render(); h.rename('Unsaved edit')
  await h.button('handleSaveRoute').props.onClick()
  assert.equal(h.navigation.length, 0)
  assert.equal(h.errors.length, 1)
  assert.equal(JSON.parse(h.storage.get('roadtripeado_draft_route')).name, 'Unsaved edit')
})

test('editor waits for fresh route before initializing from an old cached document', async () => {
  const h = editorHarness({ fetching: true })
  h.render()
  assert.equal(h.button('handleSaveRoute'), null)
  h.finishFetch('Fresh server route')
  await h.button('handleSaveRoute').props.onClick()
  assert.equal(h.updates[0].data.name, 'Fresh server route')
  assert.equal(h.navigation[0], '/saved-routes?viewRouteId=route-one')
})

test('background fetch failure preserves unsaved edits in an initialized editor', async () => {
  const h = editorHarness()
  h.render(); h.rename('Edit during connection problem'); h.failFetch()
  await h.button('handleSaveRoute').props.onClick()
  assert.equal(h.updates[0].data.name, 'Edit during connection problem')
})

test('new route save opens its new read-only ID and does not recreate the cleared draft', async () => {
  const h = editorHarness({ create: true })
  h.render(); h.rename('New route')
  const picker = find(h.getTree(), node => typeof node.props?.onSelectPlace === 'function')
  picker.props.onSelectPlace({ _id: 'place-one', name: 'Stop', location: { coordinates: [-66, 18] } })
  h.render()
  await h.button('handleSaveRoute').props.onClick()
  h.render()
  assert.equal(h.updates[0].name, 'New route')
  assert.equal(h.navigation[0], '/saved-routes?viewRouteId=created-route')
  assert.equal(h.storage.has('roadtripeado_draft_route'), false)
})

test('route modal mounts in document body above the site navigation', () => {
  const body = {}, calls = []
  const { default: RouteModalLayer } = load('../frontend_giovafilm_roadtripeado/components/Common/route-planner/route-modal-layer.tsx', {
    react: { useState: () => [true, () => {}], useEffect() {} },
    'react-dom': { createPortal: (element, target) => { calls.push({ element, target }); return element } },
  }, { document: { body } })
  RouteModalLayer({ children: 'route' })
  assert.equal(calls[0].target, body)
  assert.equal(calls[0].element.props.role, 'dialog')
  assert.equal(calls[0].element.props['aria-modal'], 'true')
})
