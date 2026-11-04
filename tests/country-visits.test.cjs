const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(file, imports = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => imports[name] || {}, console, ...globals })
  return exports
}
const plain = value => JSON.parse(JSON.stringify(value))
const id = '123456789012345678901234'
class ObjectId { constructor(value) { this.value = value } toString() { return this.value } static isValid(value) { return /^[a-f\d]{24}$/i.test(String(value)) } }
function chain(rows) {
  const query = { then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) }
  for (const key of ['select', 'lean', 'sort', 'skip', 'limit', 'populate', 'session']) query[key] = () => query
  return query
}
test('country scope recognizes canonical and translated map labels and escapes regex input', async () => {
  const queries = []
  const { getCountryScope } = load('src/helpers/countryScope.ts', {
    '../modules/map/map.model': { Map: { find: query => { queries.push(query); return chain([{ _id: id, country: 'Costa Rica', name: { en: 'Costa Rica', es: 'Mapa de Costa Rica' } }]) } } },
  })
  const result = await getCountryScope('Costa Rica')
  assert.deepEqual(plain(result.mapIds), [id])
  assert.ok(result.countries.some(regex => regex.test('Mapa de Costa Rica')))
  assert.equal(result.countries.some(regex => regex.test('Other Costa Rica')), false)
  await getCountryScope('Country (test)+')
  assert.equal(queries[1].$or[0].country.test('Country (test)+'), true)
  assert.equal(queries[1].$or[0].country.test('Country testtt'), false)
})

test('route country filter scopes stops and total before pagination, preserving route ownership', async () => {
  const queries = []
  const { RoutePlanService } = load('src/modules/route-plan/route-plan.service.ts', {
    mongoose: { default: { Types: { ObjectId } } },
    '../../helpers/countryScope': { getCountryScope: async () => ({ countries: [/^Costa Rica$/i], mapIds: [id] }) },
    '../place/place.model': { Place: { find: () => chain([{ _id: 'place-cr' }]) } },
    '../business/business.model': { Business: { find: () => chain([{ _id: 'business-cr' }]) } },
    './route-plan.model': { RoutePlan: {
      find: query => { queries.push(query); return chain([{ _id: 'route-cr' }]) },
      countDocuments: async query => { queries.push(query); return 1 },
    } },
  })
  const result = await RoutePlanService.getMyRoutePlans(id, { country: 'Costa Rica', limit: 1, page: 2 })
  assert.equal(queries[0].user.toString(), id)
  assert.deepEqual(plain(queries[0].$or), [{ 'stops.place': { $in: ['place-cr'] } }, { 'stops.business': { $in: ['business-cr'] } }])
  assert.equal(queries[0], queries[1])
  assert.equal(result.meta.total, 1)
  queries.length = 0
  await RoutePlanService.getMyRoutePlans(id, {})
  assert.equal(queries[0].$or, undefined, 'all countries keeps routes without stops')
})

test('visited country scope filters places and businesses before facet pagination', async () => {
  let pipeline
  const { VisitedService } = load('src/modules/visited/visited.service.ts', {
    mongoose: { default: { Types: { ObjectId } } },
    '../../helpers/countryScope': { getCountryScope: async () => ({ countries: [/^Costa Rica$/i], mapIds: [id] }) },
    './visited.model': { Visited: { aggregate: async value => { pipeline = value; return [{ data: [], totalCount: [] }] } } },
  })
  await VisitedService.getMyVisitedPlaces(id, { country: 'Costa Rica', page: 2, limit: 12 })
  const matchIndex = pipeline.findIndex(stage => stage.$match?.$or?.some(part => part['place.country']))
  const facetIndex = pipeline.findIndex(stage => stage.$facet)
  assert.ok(matchIndex > 0 && matchIndex < facetIndex)
  assert.ok(pipeline[matchIndex].$match.$or.some(part => part['business.location.country']))
  assert.ok(pipeline[matchIndex].$match.$or.some(part => part['place.map._id']))
  assert.equal(pipeline[0].$match.user.toString(), id)
  assert.equal(pipeline[facetIndex].$facet.data[1].$skip, 12)
})

test('marking and unmarking places or businesses preserves existing points and levels', async () => {
  for (const business of [false, true]) for (const visited of [false, true]) {
    const updates = [], tx = []
    const session = { startTransaction() {}, commitTransaction: async () => tx.push('commit'), abortTransaction: async () => tx.push('abort'), endSession() {} }
    const target = { _id: id, pointsAwarded: 25, type: business ? 'Business' : 'Place' }
    const { VisitedService } = load('src/modules/visited/visited.service.ts', {
      mongoose: { default: { Types: { ObjectId }, startSession: async () => session } },
      './visited.model': { Visited: {
        findOne: () => chain(visited ? { _id: 'visit', type: target.type, ...(business ? { business: id } : { place: id }) } : null),
        findByIdAndDelete: () => chain(null), create: async () => [{}],
      } },
      '../place/place.model': { Place: { findById: () => chain(business ? null : target) } },
      '../business/business.model': { Business: { findById: () => chain(target), findByIdAndUpdate: async () => {} } },
      '../user/user.model': { User: { findByIdAndUpdate: async (_id, update) => { updates.push(update); return { visitedPlaces: visited ? [] : [id], points: 100, level: 2 } } } },
    })
    const result = await VisitedService.toggleVisited(id, { placeId: id })
    assert.equal(result.isVisited, !visited)
    assert.equal(result.visitedCount, visited ? 0 : 1)
    assert.deepEqual(tx, ['commit'])
    for (const update of updates) {
      assert.equal(update.$set?.points, undefined)
      assert.equal(update.$set?.level, undefined)
      assert.equal(update.$inc?.points, undefined)
    }
  }
})

test('country selector restores saved map, puts it first and persists changes', () => {
  let cursor = 0; const state = [], effects = [], storage = new Map([['selectedMapId', 'cr'], ['selectedCountryFilter', 'Wrong label']])
  const { resolveOfferMap } = load('../frontend_giovafilm_roadtripeado/lib/offer-country.ts')
  const { useCountryFilter } = load('../frontend_giovafilm_roadtripeado/components/shared/country-filter.tsx', {
    react: { useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value }] }, useEffect: fn => { if (!state.length || !effects.length) effects.push(fn) } },
    '@/redux/features/map/mapApi': { useGetMapsQuery: () => ({ data: { data: [{ _id: 'pr', country: 'Puerto Rico' }, { _id: 'cr', country: 'Costa Rica' }] }, isLoading: false }) },
    '@/lib/offer-country': { resolveOfferMap }, '@/lib/utils': { getLocalized: value => value?.en || value || '' },
  }, { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } })
  let filter = useCountryFilter(); assert.equal(filter.ready, false)
  effects.shift()(); cursor = 0; filter = useCountryFilter()
  assert.equal(filter.country, 'Costa Rica')
  assert.equal(filter.options[0]._id, 'cr')
  filter.change('pr'); cursor = 0; filter = useCountryFilter()
  assert.equal(filter.country, 'Puerto Rico')
  assert.equal(storage.get('selectedMapId'), 'pr')
  filter.change(''); cursor = 0; filter = useCountryFilter()
  assert.equal(filter.country, '')
  assert.equal(storage.has('selectedMapId'), false)
})
