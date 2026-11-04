const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(file, imports = {}, extras = {}, append = '') {
  const exports = {}
  const source = fs.readFileSync(path.join(root, file), 'utf8') + append
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => imports[name] || {}, console, ...extras })
  return exports
}
function chain(rows) {
  const result = { then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) }
  for (const key of ['select', 'lean', 'populate', 'sort', 'limit']) result[key] = () => result
  return result
}
const plain = value => JSON.parse(JSON.stringify(value))
const roles = { ADMIN: 'admin', SUPER_ADMIN: 'super_admin', MAP_EDITOR: 'map_editor' }
class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }
const { lockedPlaceTeaser } = load('src/helpers/placePrivacy.ts')

test('locked markers retain searchable municipality and coordinates but no private details', () => {
  const place = { _id: 'place', name: 'Waterfall', address: 'San Sebastián', map: 'locked',
    location: { type: 'Point', coordinates: [-67, 18], city: 'San Sebastián', secret: 'secret' },
    description: 'secret', access: 'secret', entryCost: '$5', hikeTime: 'secret', schedules: 'secret',
    privateInfo: 'secret', recommendations: { tips: 'secret' }, menuImages: ['private-menu'],
  }
  const teaser = lockedPlaceTeaser(place)
  assert.equal(teaser.isLocked, true)
  assert.equal(teaser.address, 'San Sebastián')
  assert.deepEqual(plain(teaser.location.coordinates), [-67, 18])
  assert.equal(JSON.stringify(teaser).includes('secret'), false)
  assert.equal(teaser.menuImages, undefined)
  assert.equal(place.description, 'secret')
})

test('locked teaser cannot leak details nested in a populated map', () => {
  const teaser = lockedPlaceTeaser({ _id: 'place', map: {
    _id: 'paid', name: 'Country', isPaid: true, description: 'private-map-description',
    places: ['private-reference'], recommendations: { tips: 'private-tip' },
  } })
  assert.deepEqual(plain(teaser.map), { _id: 'paid', name: 'Country', isPaid: true })
  assert.equal(JSON.stringify(teaser).includes('private'), false)
})

test('editors get assigned maps only; purchases/free maps do not bypass assignments', async () => {
  const { getAccessibleMapIds } = load('src/helpers/mapAccessHelper.ts', {
    '../enum/user': { USER_ROLES: roles },
    '../modules/map/map.model': { Map: { find: query => chain(query?.isPaid === false ? [{ _id: 'free' }] : [{ _id: 'country-assigned' }]) } },
  })
  const ids = await getAccessibleMapIds({ role: 'map_editor', assignedMaps: [{ _id: 'assigned' }], assignedCountries: ['U.S.A.'], purchasedMaps: ['bought'] })
  assert.deepEqual(plain(ids), ['assigned', 'country-assigned'])
  const ordinary = await getAccessibleMapIds({ role: 'user', purchasedMaps: ['bought'] })
  assert.deepEqual(plain(ordinary), ['free', 'bought'])
})

test('detail API denies unassigned editor and retains access to assigned drafts', async () => {
  let result = { _id: 'place', map: 'other', type: 'Regular', status: 'Published' }
  const { PlaceController } = load('src/modules/place/place.controller.ts', {
    '../../shared/catchAsync': { default: handler => handler },
    '../../shared/sendResponse': { default: () => {} },
    '../../enum/user': { USER_ROLES: roles },
    '../../errors/ApiError': { default: ApiError },
    'http-status-codes': { StatusCodes: { FORBIDDEN: 403, NOT_FOUND: 404, OK: 200 } },
    '../../helpers/mapAccessHelper': { getUserFromToken: async () => ({ role: 'map_editor' }), getAccessibleMapIds: async () => ['assigned'] },
    '../../helpers/localize': { localizeDocument: value => value },
    './place.service': { PlaceService: { getPlaceById: async () => result } },
  })
  const req = { params: { id: 'place' }, headers: {} }
  await assert.rejects(PlaceController.getPlaceById(req, {}), { status: 403 })
  result = { ...result, map: 'assigned', status: 'Draft' }
  await PlaceController.getPlaceById(req, {})
  result = { ...result, map: 'other' }
  await assert.rejects(PlaceController.getPlaceById(req, {}), { status: 403 })
  result = { ...result, map: null }
  await assert.rejects(PlaceController.getPlaceById(req, {}), { status: 403 })
})

test('discovery strips locked details and scopes draft visibility without excluding search pins', async () => {
  const queries = []
  class QueryBuilder {
    constructor(modelQuery, query) { this.modelQuery = modelQuery; queries.push(query) }
    search() { return this }
    filter() { return this }
    sort() { return this }
  }
  const { MapService } = load('src/modules/map/map.service.ts', {
    '../../builder/QueryBuilder': { default: QueryBuilder },
    '../../helpers/placePrivacy': { lockedPlaceTeaser },
    '../place/place.model': { Place: { find: () => chain([
      { _id: 'locked-place', name: { en: 'Waterfall' }, address: 'San Sebastián', map: 'other', type: 'Regular', description: 'private', entryCost: '$5', location: { coordinates: [-67, 18] } },
      { _id: 'assigned-place', name: { en: 'Trail' }, address: 'San Sebastián', map: 'assigned', type: 'Regular', description: 'allowed', location: { coordinates: [-67.1, 18] } },
    ]) } },
    '../business/business.model': { Business: { find: () => chain([]) } },
  })
  const result = await MapService.getDiscoveryData({ searchTerm: 'San Sebastián', limit: 1000 }, ['other'], true, undefined, ['assigned'])
  assert.equal(result.data.length, 2)
  const locked = result.data.find(place => place._id === 'locked-place')
  assert.equal(locked.isLocked, true)
  assert.equal(locked.description, undefined)
  assert.equal(locked.entryCost, undefined)
  assert.equal(locked.address, 'San Sebastián')
  assert.equal(result.data.find(place => place._id === 'assigned-place').description, 'allowed')
  assert.equal(queries[0].searchTerm, 'San Sebastián')
  assert.deepEqual(plain(queries[0].$and), [{ $or: [{ status: 'Published' }, { map: { $in: ['assigned'] } }] }])
})

test('frontend access gate requires editor assignment even for purchased or free maps', () => {
  const editorAccess = load('../frontend_giovafilm_roadtripeado/lib/editor-access.ts')
  const { canRevealPlace } = load('../frontend_giovafilm_roadtripeado/lib/place-access.ts', { './editor-access': editorAccess })
  const user = { role: 'map_editor', assignedMaps: ['assigned'], purchasedMaps: ['other'] }
  assert.equal(canRevealPlace({ map: { _id: 'other', isPaid: false } }, user), false)
  assert.equal(canRevealPlace({ map: 'other' }, user), false)
  assert.equal(canRevealPlace({ map: 'assigned' }, user), true)
  assert.equal(canRevealPlace({ map: 'assigned', isLocked: true }, user), false)
  assert.equal(canRevealPlace({ type: 'place', placeType: 'Business', map: 'other' }, user), true)
  assert.equal(canRevealPlace({ map: { _id: 'free', isPaid: false } }, null), true)
})

test('guest municipality results keep locked pins and metadata while stripping details', async () => {
  let response
  const { PlaceController } = load('src/modules/place/place.controller.ts', {
    '../../shared/catchAsync': { default: handler => handler },
    '../../shared/sendResponse': { default: (_res, payload) => { response = payload } },
    '../../enum/user': { USER_ROLES: roles },
    '../../helpers/mapAccessHelper': { getUserFromToken: async () => null, getAccessibleMapIds: async () => [] },
    '../../helpers/placePrivacy': { lockedPlaceTeaser },
    '../../helpers/localize': { localizeDocument: value => value },
    'http-status-codes': { StatusCodes: { OK: 200 } },
    './place.service': { PlaceService: { getAllPlaces: async () => ({
      meta: { total: 2 }, data: [
        { _id: 'regular', type: 'Regular', map: 'paid', address: 'Ponce', description: 'private', access: 'private' },
        { _id: 'business', type: 'Business', address: 'Ponce', description: 'public' },
      ],
    }) } },
  })
  await PlaceController.getAllPlaces({ headers: {}, query: { searchTerm: 'Ponce' } }, {})
  assert.equal(response.meta.total, 2)
  assert.equal(response.data[0].isLocked, true)
  assert.equal(response.data[0].description, undefined)
  assert.equal(response.data[0].access, undefined)
  assert.equal(response.data[0].address, 'Ponce')
  assert.equal(response.data[1].isLocked, false)
  assert.equal(response.data[1].description, 'public')
})

test('discovery wrapper preserves pagination and adds visited flags to its data array', async () => {
  let response
  const { MapController } = load('src/modules/map/map.controller.ts', {
    '../../shared/catchAsync': { default: handler => handler },
    '../../shared/sendResponse': { default: (_res, payload) => { response = payload } },
    '../../enum/user': { USER_ROLES: roles },
    '../../helpers/mapAccessHelper': { getUserFromToken: async () => ({ role: 'user', visitedPlaces: ['visited'] }), getAccessibleMapIds: async () => [] },
    '../../helpers/localize': { localizeDocument: value => value },
    'http-status-codes': { StatusCodes: { OK: 200 } },
    './map.model': { Map: { find: () => chain([]) } },
    './map.service': { MapService: { getDiscoveryData: async () => ({ meta: { total: 1 }, data: [{ _id: 'visited', name: 'Place' }] }) } },
  })
  await MapController.getDiscoveryData({ headers: {}, query: {} }, {})
  assert.equal(response.data.meta.total, 1)
  assert.equal(response.data.data[0].isVisited, true)
})

function cameraHarness() {
  let effect, library, refIndex = 0
  const refs = [], calls = [], callbacks = []
  const map = { getZoom: () => 8, panTo: value => calls.push(['pan', value]), setZoom: value => calls.push(['zoom', value]), fitBounds: value => calls.push(['bounds', value]), setCenter: value => calls.push(['center', value]) }
  const exported = load('../frontend_giovafilm_roadtripeado/components/Common/maps/map.tsx', {
    react: { useEffect: fn => { effect = fn }, useRef: value => refs[refIndex++] ||= { current: value } },
    '@vis.gl/react-google-maps': { useMap: () => map, useMapsLibrary: () => library },
  }, {}, '\nexports.CountryPanner = CountryPanner; exports.SearchPanner = SearchPanner;')
  return { calls, callbacks, setLibrary: () => { library = { Geocoder: class { geocode(_req, callback) { callbacks.push(callback) } } } },
    render: (component, props) => { refIndex = 0; exported[component](props); return effect() },
  }
}

test('selected country waits for geocoder library and ignores old country callbacks', () => {
  const h = cameraHarness()
  h.render('CountryPanner', { selectedCountry: 'New Country' })
  h.setLibrary()
  const cleanup = h.render('CountryPanner', { selectedCountry: 'New Country' })
  assert.equal(h.callbacks.length, 1, 'library arriving later must retry')
  cleanup()
  h.render('CountryPanner', { selectedCountry: 'Another Country' })
  h.callbacks[0]([{ geometry: { location: 'old' } }], 'OK')
  assert.equal(h.calls.length, 0)
  h.callbacks[1]([{ geometry: { location: 'new' } }], 'OK')
  assert.equal(h.calls[0][1], 'new')
})

test('municipality camera waits for results instead of marking empty search as handled', () => {
  const h = cameraHarness()
  h.render('SearchPanner', { searchQuery: 'Ponce', places: [] })
  h.render('SearchPanner', { searchQuery: 'Ponce', places: [{ location: { coordinates: [-66.6, 18] } }] })
  assert.equal(h.calls[0][0], 'pan')
  assert.deepEqual(plain(h.calls[0][1]), { lat: 18, lng: -66.6 })
})

test('late geolocation respects updated shouldPan and ignores unmounted callbacks', () => {
  let effect, success
  const ref = { current: null }, pans = [], locations = []
  const { GeolocationOnLoad } = load('../frontend_giovafilm_roadtripeado/components/shared/maps/geolocation-on-load.tsx', {
    react: { useRef: () => ref, useEffect: fn => { effect = fn } },
    '@vis.gl/react-google-maps': { useMap: () => ({ panTo: value => pans.push(value) }) },
  }, { navigator: { geolocation: { getCurrentPosition: callback => { success = callback } } }, AbortController })
  GeolocationOnLoad({ onLocation: value => locations.push(value), shouldPan: true })
  const cleanup = effect()
  GeolocationOnLoad({ onLocation: value => locations.push(value), shouldPan: false })
  success({ coords: { latitude: 23, longitude: 90 } })
  assert.equal(pans.length, 0)
  assert.equal(locations.length, 1)
  cleanup()
  success({ coords: { latitude: 24, longitude: 91 } })
  assert.equal(locations.length, 1)
})

test('missing or invalid profile media resolves to branded avatar', () => {
  const { getProfileImageUrl } = load('../frontend_giovafilm_roadtripeado/lib/utils.ts', {
    '@/lib/config': { env: { NEXT_PUBLIC_BASEURL: 'https://example.test' } },
  })
  for (const value of [undefined, null, '', 'null', 'undefined']) {
    assert.equal(getProfileImageUrl(value), '/default-avatar.svg')
  }
  assert.equal(getProfileImageUrl('https://example.test/me.jpg'), 'https://example.test/me.jpg')
})

test('discovery sends special search characters as a single encoded query parameter', () => {
  let endpoints
  load('../frontend_giovafilm_roadtripeado/redux/features/public/publicApi.ts', {
    '@/redux/api/baseApi': { baseApi: { injectEndpoints: config => {
      endpoints = config.endpoints({ query: value => value, mutation: value => value })
      return {}
    } } },
  })
  const searchTerm = 'San Sebastián & Ponce #1'
  const request = endpoints.getPublicPlacesBusiness.query({ searchTerm })
  assert.equal(request.url, '/map/discovery')
  const encoded = new URLSearchParams(request.params)
  assert.equal(encoded.get('searchTerm'), searchTerm)
  assert.equal(encoded.has('Ponce'), false)
})
