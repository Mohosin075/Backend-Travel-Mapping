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
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(item => find(item, predicate)).find(Boolean)
  if (!node || typeof node !== 'object') return null
  return predicate(node) ? node : find(node.props?.children, predicate)
}
function formHarness(type, categoryName = 'Beach', sourceCollection) {
  const hooks = [], effects = []
  let cursor, dirty, tree
  const react = {
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], value => { const next = typeof value === 'function' ? value(hooks[i]) : value; dirty ||= !Object.is(next, hooks[i]); hooks[i] = next }] },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial } },
    useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || deps.some((dep, j) => !Object.is(dep, hooks[i][j]))) { hooks[i] = deps; effects.push(fn) } },
  }
  const { PlaceFormContent } = load(front + 'components/dashboard/places/PlaceFormContent.tsx', {
    react: { ...react, default: react },
    './place-payload': load(front + 'components/dashboard/places/place-payload.ts'),
    '@/lib/place-schedule': load(front + 'lib/place-schedule.ts'),
    '@/lib/place-operating-hours': load(front + 'lib/place-operating-hours.ts'),
    '@/lib/utils': load(front + 'lib/utils.ts', { '@/lib/config': { env: {} } }),
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ language: 'en', t: key => key }) },
    '@/components/ui/button': { Button: 'button' },
    'motion/react': { motion: { div: 'div' } },
  }, { window: { addEventListener() {}, removeEventListener() {} }, setTimeout: () => 1, clearTimeout() {} })
  const props = { categories: [{ _id: 'cat', name: categoryName }], isSaving: false, onSave() {}, onClose() {}, initialData: {
    type, sourceCollection, name: 'Test', description: 'Description', address: 'Address', category: 'cat', isNew: true,
    hikeTime: '30 mins', difficulty: 'Easy', entryCost: '$10', phone: '123', schedules: 'Always open',
  } }
  return {
    render() {
      let count = 0
      do { assert.ok(count++ < 15); dirty = false; cursor = 0; tree = PlaceFormContent(props); while (effects.length) effects.shift()() } while (dirty)
    },
    find: predicate => find(tree, predicate),
    label: key => !!find(tree, node => node.props?.children === key),
    switch(type) { find(tree, node => ['Business', 'Regular'].includes(node.props?.value) && node.props?.onValueChange).props.onValueChange(type); this.render() },
  }
}

test('Business hides trail fields and Regular restores them, even for restaurant category', () => {
  const form = formHarness('Regular', 'restaurant')
  form.render()
  assert.equal(form.label('place.difficulty'), true)
  assert.equal(form.label('place.walking_time'), true)
  assert.equal(form.label('place.menu_and_prices'), false)
  form.switch('Business')
  assert.equal(form.label('place.difficulty'), false)
  assert.equal(form.label('place.entry_cost'), false)
  assert.equal(form.label('place.walking_time'), false)
  assert.equal(form.label('places_admin.phone_number'), true)
  assert.equal(form.label('place.menu_and_prices'), true)
  form.switch('Regular')
  assert.equal(form.label('places_admin.phone_number'), false)
  assert.equal(form.label('place.menu_and_prices'), false)
  assert.ok(form.find(node => node.props?.value === 'Easy'))
  assert.ok(form.find(node => node.props?.id === 'always-open'))
})

test('registered business type is locked while admin-created places can switch type', () => {
  for (const [source, expected] of [['business', true], [undefined, false]]) {
    const form = formHarness('Business', 'Shop', source)
    form.render()
    assert.equal(!!form.find(node => node.props?.value === 'Business' && node.props?.onValueChange).props.disabled, expected)
  }
})

test('request bodies exclude hidden fields and permit explicit menu removal', () => {
  const { buildPlaceRequestBody } = load(front + 'components/dashboard/places/place-payload.ts')
  const fields = { schedules: '24/7', entryCost: '$10', difficulty: 'Easy', hikeTime: '30 mins', phone: '123', website: 'url', instagram: 'name', operatingHours: {}, menuImages: ['menu'], atmosphere: 'Calm' }
  const business = plain(buildPlaceRequestBody({ ...fields, type: 'Business' }))
  for (const key of ['schedules', 'entryCost', 'difficulty', 'hikeTime']) assert.equal(key in business, false)
  const regular = plain(buildPlaceRequestBody({ ...fields, type: 'Regular' }, [], [{ name: 'hidden-menu.pdf' }]))
  for (const key of ['phone', 'website', 'instagram', 'operatingHours', 'menuImages']) assert.equal(key in regular, false)
  assert.equal(regular.difficulty, 'Easy')
  assert.deepEqual(plain(buildPlaceRequestBody({ type: 'Business', menuImages: [] })).menuImages, [])
})

test('weekly hours and legacy schedules normalize without inventing opening days', () => {
  const { normalizeOperatingHours } = load(front + 'lib/place-operating-hours.ts')
  const weekly = normalizeOperatingHours({ Monday: { open: '09:00', close: '18:00', closed: false }, Sunday: { closed: true } })
  assert.equal(weekly.Monday.open, '09:00')
  assert.equal(weekly.Sunday.closed, true)
  assert.equal(weekly.Tuesday.closed, true)
  const legacy = normalizeOperatingHours([{ days: 'Monday - Friday', openTime: '9:00 AM', closeTime: '6:00 PM' }])
  assert.equal(legacy.Friday.close, '18:00')
  assert.equal(legacy.Saturday.closed, true)
  const daily = normalizeOperatingHours({ openTime: '09:00', closeTime: '17:00', offDays: ['Sunday'] })
  assert.equal(daily.Monday.closed, false)
  assert.equal(daily.Sunday.closed, true)
  assert.equal(normalizeOperatingHours(null), null)
})

test('legacy Always Open and explicitly empty schedules survive editing', () => {
  const { normalizeOperatingHours } = load(front + 'lib/place-operating-hours.ts')
  const alwaysOpen = normalizeOperatingHours([{ days: 'Always Open', openTime: '', closeTime: '' }])
  assert.equal(Object.keys(alwaysOpen).length, 7)
  for (const day of Object.values(alwaysOpen)) assert.deepEqual(plain(day), { open: '00:00', close: '00:00', closed: false })
  for (const day of Object.values(normalizeOperatingHours([]))) assert.equal(day.closed, true)
})

test('View modal renders translated difficulty and hides stale Business-only fields on Regular places', () => {
  const place = { _id: 'record', type: 'Regular', name: 'Trail', description: 'Description', difficulty: { en: 'Easy', es: 'Fácil' }, phone: 'stale-phone', website: 'stale-website', map: { name: 'USA' }, category: { name: 'Trail' }, media: [] }
  const { ViewPlaceModal } = load(front + 'components/dashboard/places/view-place-modal.tsx', {
    react: { useState: value => [value, () => {}], useEffect() {}, useCallback: fn => fn },
    '@/lib/utils': load(front + 'lib/utils.ts', { '@/lib/config': { env: {} } }),
    '@/lib/place-operating-hours': load(front + 'lib/place-operating-hours.ts'),
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ language: 'es', t: key => key }) },
    '@/redux/features/place/placeApi': { useGetPlaceDetailsQuery: () => ({ data: { data: place } }), useReviewRecommendedPlaceMutation: () => [() => {}, {}] },
    '@/redux/features/review/reviewApi': { useGetReviewsByPlaceQuery: () => ({ data: { data: [] } }) },
  })
  const tree = ViewPlaceModal({ placeId: 'record', open: true, onOpenChange() {} })
  assert.ok(find(tree, node => node.props?.children === 'place.easy'))
  assert.equal(find(tree, node => node.props?.href === 'tel:stale-phone'), undefined)
  place.type = 'Business'
  place.operatingHours = [{ days: 'Always Open', openTime: '', closeTime: '' }]
  const businessTree = ViewPlaceModal({ placeId: 'record', open: true, onOpenChange() {} })
  assert.ok(find(businessTree, node => node.props?.children === 'place.always_open'))
  assert.equal(find(businessTree, node => node.props?.children === 'place.difficulty'), undefined)
  assert.ok(find(businessTree, node => node.props?.href === 'tel:stale-phone'))
})

const fields = load('src/modules/place/place.fields.ts')
function serviceHarness(existing, business) {
  const writes = []
  const session = { startTransaction() {}, async commitTransaction() {}, async abortTransaction() {}, async endSession() {} }
  const updated = { ...existing, ...business, _id: 'record', status: 'Draft', toObject() { return { ...this } } }
  const query = { populate() { return this }, then(resolve, reject) { return Promise.resolve(updated).then(resolve, reject) } }
  const { PlaceService } = load('src/modules/place/place.service.ts', {
    './place.fields': fields,
    './place.model': { Place: { findById: async () => existing, findByIdAndUpdate: (id, update) => { writes.push(update); return query } } },
    '../business/business.model': { Business: { findById: async () => business, findByIdAndUpdate: (id, update) => { writes.push(update); return query } } },
    mongoose: { default: { startSession: async () => session } },
    '../../errors/ApiError': { default: class extends Error { constructor(status, message) { super(message); this.status = status } } },
    'http-status-codes': { StatusCodes: { BAD_REQUEST: 400, NOT_FOUND: 404 } },
    '../../utils/autoTranslate': { autoTranslateField: async value => value },
  })
  return { service: PlaceService, writes }
}

test('server removes inactive fields when changing Place type and preserves common content', async () => {
  for (const type of ['Regular', 'Business']) {
    const app = serviceHarness({ type: type === 'Business' ? 'Regular' : 'Business', map: 'map', status: 'Draft' })
    await app.service.updatePlace('record', { type, phone: '123', schedules: '24/7', difficulty: 'Hard', services: ['Parking'], menuImages: ['menu'] })
    const write = app.writes[0]
    assert.deepEqual(plain(write.$set.services), ['Parking'])
    for (const key of fields.inactivePlaceFields(type)) {
      assert.equal(key in write.$set, false)
      assert.equal(write.$unset[key], 1)
    }
  }
})

test('registered businesses save common fields, clear optional contacts and reject unsupported conversion', async () => {
  const app = serviceHarness(null, { contact: { phone: '123', website: 'old' }, media: { menu: 'old', photos: ['photo'] }, location: { country: 'USA' } })
  await app.service.updatePlace('record', { type: 'Business', services: ['Parking'], access: 'Ramp', accessibility: { features: ['wheelchair'] }, recommendations: { tips: 'Book ahead' }, atmosphere: 'Quiet', website: '', menuImages: [] })
  assert.equal(app.writes[0].access, 'Ramp')
  assert.deepEqual(plain(app.writes[0].services), ['Parking'])
  assert.equal(app.writes[0].recommendations.tips, 'Book ahead')
  assert.equal(app.writes[0].contact.website, '')
  assert.equal(app.writes[0].media.menu, '')
  await assert.rejects(app.service.updatePlace('record', { type: 'Regular' }), /keep their Business type/)
  await assert.rejects(app.service.updatePlace('record', { menuImages: ['one', 'two'] }), /one menu/)
})
