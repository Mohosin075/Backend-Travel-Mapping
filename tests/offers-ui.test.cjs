const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const front = path.resolve(__dirname, '../../frontend_giovafilm_roadtripeado')
const jsx = (type, props) => ({ type, props })
function load(file, imports = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(front, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : imports[name] || {}, ...globals })
  return exports
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(item => nodes(item, predicate))
  if (!tree || typeof tree !== 'object') return []
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)]
}
const country = load('lib/offer-country.ts')
const search = load('lib/offer-search.ts')
const maps = [{ _id: 'pr', name: 'Puerto Rico', country: 'Puerto Rico' }, { _id: 'cr', name: 'Costa Rica', country: 'Costa Rica' }]
const records = [
  { _id: 'offer-pr', title: { en: 'Breakfast', es: 'Desayuno' }, place: { _id: 'place-pr', name: { en: 'Beach', es: 'Playa' }, map: maps[0] } },
  { _id: 'offer-cr', title: 'Costa Rica Deal', place: { _id: 'place-cr', name: 'Cafe', map: maps[1] } },
]

function harness({ saved = {}, error = false, storageBlocked = false } = {}) {
  const hooks = [], effects = [], requests = [], storage = new Map(Object.entries(saved))
  let cursor = 0, dirty = true, tree, retries = 0, favouriteOptions
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], value => {
        const next = typeof value === 'function' ? value(hooks[index]) : value
        if (!Object.is(hooks[index], next)) { hooks[index] = next; dirty = true }
      }]
    },
    useEffect(fn, deps) {
      const index = cursor++, previous = hooks[index]
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous[i]))) {
        hooks[index] = deps; effects.push(fn)
      }
    },
  }
  const Component = load('components/Common/offer/offer-section.tsx', {
    react,
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ language: 'en', t: (key, fallback) => fallback || key }) },
    '@/redux/hook': { useAppSelector: fn => fn({ auth: { accessToken: null } }) },
    '@/redux/features/user/userApi': { useGetProfileQuery: () => ({}) },
    '@/redux/features/map/mapApi': { useGetMapsQuery: () => ({ data: { data: maps }, isLoading: false }) },
    '@/redux/features/offer/offerApi': { useGetOffersQuery: (params, options) => {
      requests.push({ params, options })
      return { currentData: error ? undefined : { data: records }, isFetching: false, isError: error, refetch: () => retries++ }
    } },
    '@/redux/features/favourite/favouriteApi': { useGetFavouritesQuery: (_params, options) => { favouriteOptions = options; return {} } },
    '@/lib/offer-country': country, '@/lib/offer-search': search,
    '@/lib/utils': { getLocalized: value => typeof value === 'object' ? value?.en || value?.es || '' : value || '', getImageUrl: () => '/test.png' },
    '@/lib/offer-label': { formatOfferDiscountLabel: () => '10%' },
    '@/components/ui/button': { Button: 'button' }, '@/components/ui/input': { Input: 'input' },
    '@/components/ui/skeleton': { Skeleton: 'skeleton' },
    '@/components/shared/favourite-button': { FavouriteButton: 'favourite' },
    'next/link': { default: 'link' }, 'next/image': { default: 'image' },
    'lucide-react': { Lock: 'lock', Search: 'search' },
  }, { localStorage: {
    getItem: key => { if (storageBlocked) throw Error('Storage unavailable'); return storage.get(key) },
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  } }).default
  function render() {
    let count = 0
    do {
      assert.ok(count++ < 10, 'effects settle')
      dirty = false; cursor = 0; tree = Component()
      while (effects.length) effects.shift()()
    } while (dirty)
    return tree
  }
  const cards = () => nodes(tree, node => node.type === 'link')
  return { render, cards, requests, retries: () => retries, favouriteOptions: () => favouriteOptions }
}

test('new visitors see offers across countries and guests skip the authenticated favourites request', () => {
  for (const storageBlocked of [false, true]) {
    const app = harness({ storageBlocked })
    app.render()
    const query = app.requests.at(-1)
    assert.equal(query.options.skip, false)
    assert.equal(query.params.map, undefined)
    assert.equal(query.params.country, undefined)
    assert.equal(app.cards().length, 2)
    assert.equal(app.favouriteOptions().skip, true)
  }
})

test('saved map selection remains authoritative over a conflicting country label', () => {
  const app = harness({ saved: { selectedMapId: 'cr', selectedCountryFilter: 'Puerto Rico' } })
  app.render()
  assert.equal(app.requests.at(-1).params.map, 'cr')
  assert.equal(app.cards().length, 1)
  assert.equal(app.cards()[0].props.href, '/places/place-cr')
})

test('translated offer search renders safely and filters cards and suggestions consistently', () => {
  const app = harness()
  const tree = app.render()
  const input = nodes(tree, node => node.type === 'input')[0]
  input.props.onChange({ target: { value: 'Desayuno' } })
  input.props.onFocus()
  const searched = app.render()
  assert.equal(app.cards().length, 1)
  assert.equal(app.cards()[0].props.href, '/places/place-pr')
  const suggestion = nodes(searched, node => node.type === 'button' && node.props.onMouseDown)[0]
  assert.ok(suggestion)
  suggestion.props.onClick()
  app.render()
  assert.equal(app.cards().length, 1)
})

test('offer request errors provide a retry action instead of pretending no offers exist', () => {
  const app = harness({ error: true })
  const tree = app.render()
  const retry = nodes(tree, node => node.type === 'button')[0]
  assert.ok(retry)
  retry.props.onClick()
  assert.equal(app.retries(), 1)
  assert.equal(app.cards().length, 0)
})

test('dashboard uses the managed list and shows fetch errors with retry', () => {
  for (const error of [false, true]) {
    let request, retries = 0
    const { OffersTable } = load('components/dashboard/offers/offers-table.tsx', {
      react: { useState: initial => [initial, () => {}], useEffect() {} },
      'next/navigation': { useSearchParams: () => ({ get: () => '' }) },
      '@/redux/features/user/userApi': { useGetProfileQuery: () => ({ data: { role: 'map_editor' } }) },
      '@/redux/features/map/mapApi': { useGetAvailableCountriesQuery: () => ({ data: [] }) },
      '@/redux/features/offer/offerApi': {
        useGetManagedOffersQuery: (params, options) => {
          request = { params, options }
          return { currentData: error ? undefined : { data: records, meta: { total: 2 } }, isFetching: false, isError: error, refetch: () => retries++ }
        },
        useDeleteOfferMutation: () => [() => {}],
      },
      '@/lib/i18n/LanguageContext': { useLanguage: () => ({ language: 'en', t: key => key }) },
      '@/lib/utils': { getLocalized: value => typeof value === 'object' ? value?.en || '' : value || '' },
      '@/lib/offer-label': { formatOfferDiscountLabel: () => '10%' },
      '@/components/ui/input': { Input: 'input' },
      '@/components/dashboard/shared/table-pagination': { TablePagination: 'pagination' },
      'lucide-react': { Edit: 'edit', Play: 'play', Search: 'search', Trash2: 'trash' },
    })
    const tree = OffersTable({})
    assert.equal(request.params.page, 1)
    assert.equal(request.options.refetchOnMountOrArgChange, true)
    const rows = nodes(tree, node => node.type === 'tr' && node.props.children?.[0]?.props?.className?.includes('font-medium'))
    if (error) {
      const retry = nodes(tree, node => node.type === 'button' && node.props.children === 'Retry')[0]
      assert.ok(retry)
      retry.props.onClick()
      assert.equal(retries, 1)
    } else {
      assert.equal(rows.length, 2, 'server-scoped editor rows are not filtered again after pagination')
    }
  }
})

test('managed list shares offer mutation invalidation while public discovery keeps its own URL', () => {
  let definitions
  load('redux/features/offer/offerApi.ts', {
    '@/redux/api/baseApi': { baseApi: { injectEndpoints: ({ endpoints }) => {
      definitions = endpoints({ query: value => value, mutation: value => value })
      return {}
    } } },
  }, { URLSearchParams })
  assert.equal(definitions.getManagedOffers.query({ page: 2 }).url, '/offer/managed')
  assert.equal(definitions.getManagedOffers.query({ page: 2 }).params.page, 2)
  assert.ok(definitions.getManagedOffers.providesTags.includes('Offer'))
  for (const mutation of ['createOffer', 'updateOffer', 'deleteOffer']) {
    assert.ok(definitions[mutation].invalidatesTags.includes('Offer'))
  }
  assert.equal(definitions.getOffers.query({ country: '', page: 1 }), '/offer?page=1')
})
