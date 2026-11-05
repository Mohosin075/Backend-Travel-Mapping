const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const front = path.resolve(root, '../dashboard/giovafilm_mapping')
const stage = path.join(root, '.map-camera-stage')
const jsx = (type, props, key) => ({ type, props, key })
const source = relative => fs.readFileSync(fs.existsSync(path.join(stage, relative)) ? path.join(stage, relative) : path.join(front, relative), 'utf8')
const mapSource = () => ts.createSourceFile('map.tsx', source('components/Common/maps/map.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function evaluate(code, globals = {}, imports = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, console, require: name => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : imports[name] || {}, ...globals })
  return exports
}
function find(file, predicate) {
  let found
  function visit(node) { if (predicate(node)) found = node; ts.forEachChild(node, visit) }
  visit(file); assert.ok(found); return found
}
function cameraElement(name, revision = 0, overrides = {}) {
  const file = mapSource()
  const node = find(file, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === name)
  return evaluate(`exports.element = (${node.getText(file)});`, {
    CountryPanner: 'country', CustomLocationButton: 'locate', GeolocationOnLoad: 'gps',
    mapIdFilter: 'pr-map', countrySelectionRevision: revision, selectedCountry: 'Puerto Rico',
    selectedMapObj: { country: 'Bangladesh' }, displayPlaces: [], pendingFocus: null,
    isManualSelection: true, hasUserLocation: true, searchQuery: '', setMarkerPos() {}, setHasUserLocation() {},
    ...overrides,
  }).element
}

test('dropdown Puerto Rico takes camera precedence over conflicting Bangladesh metadata', () => {
  const props = cameraElement('CountryPanner').props
  assert.equal(props.selectedCountry, 'Puerto Rico')
  assert.equal(props.disabled, false)
  const file = mapSource()
  const normalize = find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeAccents')
  const coordinates = find(file, node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'COUNTRY_COORDINATES')
  const panner = find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === 'CountryPanner')
  const pans = [], zooms = []
  const { CountryPanner } = evaluate(`${normalize.getText(file)}\nconst COUNTRY_COORDINATES = ${coordinates.initializer.getText(file)};\n${panner.getText(file)}\nexports.CountryPanner = CountryPanner;`, {
    useMap: () => ({ panTo: point => pans.push(point), setZoom: zoom => zooms.push(zoom) }),
    useMapsLibrary: () => null, useRef: value => ({ current: value }), useEffect: fn => fn(),
  })
  CountryPanner(props)
  assert.equal(pans.length, 1)
  assert.equal(pans[0].lat, 18.2208)
  assert.equal(pans[0].lng, -66.5901)
  assert.equal(zooms[0], 10)
  assert.equal(cameraElement('GeolocationOnLoad').props.shouldPan, false, 'automatic GPS only updates the location marker')
})

test('selecting the same country again resets the camera and invalidates pending location work', () => {
  for (const name of ['CountryPanner', 'CustomLocationButton']) {
    assert.notEqual(cameraElement(name, 0).key, cameraElement(name, 1).key)
  }
  const file = mapSource()
  const handler = find(file, node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleSelectCountry')
  let revision = 0, selectedId = 'old-map', country = 'Bangladesh', manual = false
  const routes = [], storage = new Map()
  const { select } = evaluate(`exports.select = ${handler.initializer.getText(file)};`, {
    setCountrySelectionRevision: fn => revision = fn(revision), focusMapAppliedRef: { current: false },
    setPendingFocus() {}, setFocusReady() {}, setSelectedLocation() {}, searchQuery: 'old location', router: { replace: (...args) => routes.push(args) },
    mapsResponse: { data: [{ _id: 'pr-map', name: 'Puerto Rico', country: 'Bangladesh' }] },
    normalizeAccents: value => value.toLowerCase(), isSameCountry: (a, b) => a === b,
    setSelectedMapId: value => selectedId = value, setSelectedCountry: value => country = value,
    setIsManualSelection: value => manual = value,
    localStorage: { setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  })
  select('Puerto Rico'); select('Puerto Rico')
  assert.equal(revision, 2)
  assert.equal(selectedId, 'pr-map')
  assert.equal(country, 'Puerto Rico')
  assert.equal(manual, true)
  assert.equal(routes[0][0], '/maps', 'a previous search cannot override an explicit country choice')
  select('New country')
  assert.equal(selectedId, '', 'an unmatched choice must not keep the previous map ID')
  assert.equal(storage.has('selectedMapId'), false)
})

function locateFixture(fetchImpl = async () => { throw Error('unexpected fetch') }) {
  const gps = [], centers = [], located = [], warnings = [], effects = []
  const { CustomLocationButton } = evaluate(source('components/shared/maps/CustomLocationButton.tsx'), {
    window: {}, navigator: { geolocation: { getCurrentPosition: (success, error) => gps.push({ success, error }) } }, fetch: fetchImpl,
  }, {
    react: { useCallback: fn => fn, useState: initial => [initial, () => {}], useRef: value => ({ current: value }), useEffect: fn => effects.push(fn()) },
    '@vis.gl/react-google-maps': { MapControl: 'control', ControlPosition: {}, useMap: () => ({ setCenter: point => centers.push(point), setZoom() {} }) },
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ t: key => key }) },
    sonner: { toast: { error: message => warnings.push(message), warning: message => warnings.push(message) } },
  })
  const tree = CustomLocationButton({ onLocated: (...args) => located.push(args) })
  return { gps, centers, located, warnings, click: tree.props.children.props.onClick, unmount: () => effects.forEach(fn => fn?.()) }
}
const bangladesh = accuracy => ({ coords: { latitude: 23.8103, longitude: 90.4125, accuracy } })

test('late primary GPS and improved GPS callbacks cannot override a later country selection', () => {
  const pending = locateFixture()
  pending.click(); pending.unmount(); pending.gps[0].success(bangladesh(10))
  assert.equal(pending.centers.length, 0)
  assert.equal(pending.located.length, 0)
  const improving = locateFixture()
  improving.click(); improving.gps[0].success(bangladesh(1000))
  assert.equal(improving.centers.length, 1, 'explicit Locate me still works')
  improving.unmount(); improving.gps[1].success(bangladesh(10))
  assert.equal(improving.centers.length, 1)
  assert.equal(improving.located.length, 1)
})

test('late IP fallback results cannot pan or display stale location notices after changing country', async () => {
  let resolve, requests = 0
  const fixture = locateFixture(() => { requests++; return new Promise(ok => resolve = ok) })
  fixture.click(); fixture.gps[0].error({}); fixture.gps[1].error({ code: 1, PERMISSION_DENIED: 1 })
  assert.equal(requests, 1)
  fixture.unmount()
  resolve({ json: async () => ({ success: true, latitude: 23.8103, longitude: 90.4125 }) })
  await new Promise(ok => setImmediate(ok))
  assert.equal(fixture.centers.length, 0)
  assert.equal(fixture.located.length, 0)
  assert.equal(fixture.warnings.length, 0)
})

test('production correction defaults to dry-run and only changes the confirmed map country after backup', async () => {
  const { repairCountry, MAP_ID } = require('../scripts/repair-puerto-rico-country.cjs')
  const writes = [], backups = []
  let country = 'Bangladesh'
  const db = { collection: name => {
    assert.equal(name, 'maps')
    return {
      findOne: async filter => {
        assert.equal(String(filter._id), MAP_ID)
        return { name: { en: 'Puerto Rico', es: 'Puerto Rico' }, country }
      },
      updateOne: async (filter, update) => {
        assert.equal(backups.length, 1, 'backup must precede the update')
        writes.push({ filter, update }); country = update.$set.country
        return { modifiedCount: 1 }
      },
    }
  } }
  assert.equal((await repairCountry(db)).action, 'would_update')
  assert.equal(writes.length, 0)
  assert.equal((await repairCountry(db, { apply: true, backup: change => backups.push(change) })).action, 'updated')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].filter.country, 'Bangladesh')
  assert.deepEqual(writes[0].update, { $set: { country: 'Puerto Rico' } })
  assert.equal((await repairCountry(db, { apply: true })).action, 'already_correct')
  assert.equal(writes.length, 1)
})

test('production correction refuses a different map name or unexpected current country', async () => {
  const { repairCountry } = require('../scripts/repair-puerto-rico-country.cjs')
  for (const document of [{ name: 'Another map', country: 'Bangladesh' }, { name: 'Puerto Rico', country: 'Costa Rica' }]) {
    const db = { collection: () => ({ findOne: async () => document, updateOne: async () => { throw Error('Must not write') } }) }
    await assert.rejects(repairCountry(db, { apply: true, backup() {} }))
  }
})
