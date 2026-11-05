const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const frontend = path.resolve(root, '../dashboard/giovafilm_mapping')
const stage = path.join(root, '.user-fixes-stage')
const jsx = (type, props) => ({ type, props })
const plain = value => JSON.parse(JSON.stringify(value))
function source(file) {
  if (file.startsWith('front/')) {
    const relative = file.slice(6)
    return fs.readFileSync(fs.existsSync(path.join(stage, relative)) ? path.join(stage, relative) : path.join(frontend, relative), 'utf8')
  }
  return fs.readFileSync(path.join(root, file), 'utf8')
}
function evaluate(text, imports = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: name => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'fragment' } : imports[name] || {}, console, ...globals })
  return exports
}
const load = (file, imports, globals) => evaluate(source(file), imports, globals)
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(item => nodes(item, predicate))
  if (!tree || typeof tree !== 'object') return []
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)]
}
function textOf(tree) {
  if (Array.isArray(tree)) return tree.map(textOf).join(' ')
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  return tree?.props ? textOf(tree.props.children) : ''
}
const utils = {
  getLocalized: (value, language = 'en') => typeof value === 'object' && value ? value[language] || value.en || value.es || '' : value || '',
  getProfileImageUrl: value => value || '/default-avatar.png',
}
const language = { useLanguage: () => ({ language: 'en', t: value => value }) }

function countryFixture({ allowAll, savedId = 'cr', savedCountry = 'Costa Rica' }) {
  let cursor = 0
  const state = [], effects = [], storage = new Map([['selectedMapId', savedId], ['selectedCountryFilter', savedCountry]])
  const resolve = load('front/lib/offer-country.ts')
  const hooks = load('front/components/shared/country-filter.tsx', {
    react: { useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => state[i] = value] }, useEffect: fn => effects.push(fn) },
    '@/redux/features/map/mapApi': { useGetMapsQuery: () => ({ isLoading: false, data: { data: [{ _id: 'pr', country: 'Puerto Rico', name: 'Puerto Rico' }, { _id: 'cr', country: 'Costa Rica', name: 'Costa Rica' }] } }) },
    '@/lib/i18n/LanguageContext': language, '@/lib/utils': utils, '@/lib/offer-country': resolve,
  }, { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } })
  const render = () => { cursor = 0; return hooks.useCountryFilter({ allowAll }) }
  assert.equal(render().ready, false)
  effects.shift()()
  return { render, storage, CountryFilter: hooks.CountryFilter }
}

test('country-only filters restore the selected country, omit All countries, and reject empty changes', () => {
  const fixture = countryFixture({ allowAll: false })
  let filter = fixture.render()
  assert.equal(filter.country, 'Costa Rica')
  assert.equal(filter.value, 'cr')
  const tree = fixture.CountryFilter({ filter })
  const options = nodes(tree, node => node.type === 'option')
  assert.equal(options.some(node => node.props.value === ''), false)
  assert.equal(textOf(tree).includes('All countries'), false)
  filter.change(''); filter = fixture.render()
  assert.equal(filter.country, 'Costa Rica')
  assert.equal(fixture.storage.get('selectedMapId'), 'cr')
  filter.change('pr'); filter = fixture.render()
  assert.equal(filter.country, 'Puerto Rico')
  assert.equal(fixture.storage.get('selectedCountryFilter'), 'Puerto Rico')
})

test('country-only filters recover a stale saved map ID using its country; optional All behavior stays available', () => {
  const stale = countryFixture({ allowAll: false, savedId: 'deleted', savedCountry: 'Costa Rica' })
  assert.equal(stale.render().value, 'cr')
  const optional = countryFixture({ allowAll: true })
  optional.render().change('')
  const all = optional.render()
  assert.equal(all.country, '')
  assert.equal(optional.CountryFilter({ filter: all }).props.value, '')
})

test('a saved country outside the current map page must not silently switch to the first country', () => {
  const fixture = countryFixture({ allowAll: false, savedId: 'mx', savedCountry: 'Mexico' })
  const filter = fixture.render()
  assert.equal(filter.country, 'Mexico')
  assert.equal(filter.value, 'mx')
  const select = fixture.CountryFilter({ filter })
  assert.equal(select.props.value, 'mx')
  assert.ok(textOf(select).includes('Mexico'))
  assert.equal(textOf(select).includes('All countries'), false)
})

function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$and') return value.every(condition => matches(row, condition))
    if (key === '$or') return value.some(condition => matches(row, condition))
    if (value?.$in) return value.$in.some(id => String(id) === String(row[key]))
    return String(value) === String(row[key])
  })
}
const chain = rows => ({ select: () => ({ lean: async () => rows }) })

test('favorites apply country and authenticated ownership before pagination and total counting', async () => {
  const rows = [
    { _id: 'pr-map', user: 'owner', map: 'map-pr' },
    { _id: 'cr-map', user: 'owner', map: 'map-cr' },
    { _id: 'pr-place', user: 'owner', place: 'place-pr' },
    { _id: 'cr-place', user: 'owner', place: 'place-cr' },
    { _id: 'pr-business', user: 'owner', business: 'business-pr' },
    { _id: 'cr-business', user: 'owner', business: 'business-cr' },
    { _id: 'pr-offer', user: 'owner', offer: 'offer-pr' },
    { _id: 'cr-offer', user: 'owner', offer: 'offer-cr' },
    { _id: 'someone-else', user: 'other', place: 'place-pr' },
  ]
  let match, pipeline
  class ObjectId { constructor(value) { this.value = value } toString() { return this.value } }
  const { FavouriteService } = load('src/modules/favourite/favourite.service.ts', {
    mongoose: { default: { Types: { ObjectId } } },
    '../../helpers/countryScope': { getCountryScope: async country => ({ mapIds: [`map-${country}`], countries: [country] }) },
    '../place/place.model': { Place: { find: query => chain([{ _id: `place-${query.$or[0].country.$in[0]}` }]) } },
    '../business/business.model': { Business: { find: query => chain([{ _id: `business-${query['location.country'].$in[0]}` }]) } },
    '../offer/offer.model': { Offer: { find: query => chain([{ _id: `offer-${query.$or[0].place.$in[0].split('-')[1]}` }]) } },
    './favourite.model': { Favourite: {
      aggregate: async stages => { pipeline = stages; const skip = stages.find(stage => stage.$skip !== undefined).$skip; const limit = stages.find(stage => stage.$limit !== undefined).$limit; return rows.filter(row => matches(row, stages[0].$match)).slice(skip, skip + limit) },
      countDocuments: async query => { match = query; return rows.filter(row => matches(row, query)).length },
    } },
  })
  for (const country of ['pr', 'cr']) {
    const result = await FavouriteService.getMyFavourites('owner', { user: 'other', country, page: 2, limit: 2 })
    assert.equal(result.meta.total, 4)
    assert.equal(result.meta.totalPage, 2)
    assert.deepEqual(plain(result.data.map(row => row._id)), [`${country}-business`, `${country}-offer`])
    assert.equal(String(match.user), 'owner')
    assert.equal(match.country, undefined)
    assert.equal(pipeline[0].$match, match)
  }
  assert.equal((await FavouriteService.getMyFavourites('owner', {})).meta.total, 8, 'unfiltered consumers still work')
})

test('favorites reset pagination on country changes and never show the previous country while loading', () => {
  let cursor = 0, country = 'Puerto Rico', fetching = false
  const state = [], requests = []
  const pr = Array.from({ length: 20 }, (_, i) => ({ _id: `pr-${i}`, place: { _id: `place-${i}`, name: `Puerto place ${i}`, type: 'Regular' } }))
  const cr = [{ _id: 'cr', place: { _id: 'costa', name: 'Costa place', type: 'Regular' } }]
  const { default: FavoritePlaces } = load('front/components/Common/profile/favorite-places/favorite-places.tsx', {
    react: { useMemo: fn => fn(), useState: initial => {
      const i = cursor++; if (!(i in state)) state[i] = initial
      return [state[i], value => state[i] = typeof value === 'function' ? value(state[i]) : value]
    } },
    'next/link': { default: 'link' }, 'lucide-react': { Building2: 'business', ChevronLeft: 'previous', ChevronRight: 'next', MapPin: 'pin', Search: 'search' },
    '@/components/ui/input': { Input: 'input' }, '@/lib/others/others': { NoImage: 'no-image' },
    '@/lib/utils': { ...utils, getImageUrl: value => value }, '@/lib/i18n/LanguageContext': language,
    '@/components/shared/country-filter': { CountryFilter: 'country-filter', useCountryFilter: () => ({ ready: true, country, change: next => country = next }) },
    '@/redux/features/favourite/favouriteApi': {
      useGetFavouritesQuery: (args, options) => {
        requests.push({ args, options })
        return { data: { data: pr }, currentData: fetching ? undefined : { data: country === 'Puerto Rico' ? pr : cr }, isFetching: fetching }
      }, useAddToFavouriteMutation: () => [() => {}], useRemoveFavouriteMutation: () => [() => {}, {}],
    },
  })
  const render = () => { cursor = 0; return FavoritePlaces() }
  let tree = render()
  for (let i = 0; i < 2; i++) {
    nodes(tree, node => node.type === 'button' && nodes(node.props.children, child => child.type === 'next').length)[0].props.onClick()
    tree = render()
  }
  assert.equal(state[2], 3)
  const selector = nodes(tree, node => node.type === 'country-filter')[0]
  selector.props.filter.change('Costa Rica'); selector.props.onChange()
  tree = render()
  assert.equal(state[2], 1)
  assert.equal(requests.at(-1).args.country, 'Costa Rica')
  assert.equal(requests.at(-1).options.skip, false)
  assert.ok(textOf(tree).includes('Costa place'))
  assert.equal(textOf(tree).includes('Puerto place'), false)
  fetching = true; tree = render()
  assert.equal(textOf(tree).includes('Puerto place'), false)
  assert.equal(textOf(tree).includes('places.no_favorites'), false)
})

test('own and community reviews share identity/layout, with Edit only in the top-right header of own reviews', () => {
  let edited = 0
  const { ReviewItem } = load('front/components/Common/reviews/review-item.tsx', {
    'next/link': { default: 'link' }, 'lucide-react': { Pencil: 'pencil', Star: 'star' },
    '@/components/ui/avatar': { Avatar: 'avatar', AvatarImage: 'avatar-image', AvatarFallback: 'avatar-fallback' },
    '@/components/ui/button': { Button: 'button' }, '@/lib/utils': utils, '@/lib/i18n/LanguageContext': language,
  })
  const review = { reviewer: { _id: 'owner', name: 'Ana Explorer', profile: '/ana.jpg', level: 2 }, rating: 4, review: 'Beautiful place', createdAt: '2026-11-05' }
  const own = ReviewItem({ review, onEdit: () => edited++ })
  const publicReview = ReviewItem({ review })
  assert.equal(own.props.className, publicReview.props.className)
  for (const tree of [own, publicReview]) {
    assert.ok(textOf(tree).includes('Ana Explorer'))
    assert.equal(nodes(tree, node => node.type === 'avatar-image')[0].props.src, '/ana.jpg')
    assert.equal(nodes(tree, node => node.type === 'link')[0].props.href, '/explorer/owner')
  }
  assert.equal(nodes(publicReview, node => node.type === 'button').length, 0)
  const header = own.props.children[0]
  const button = nodes(header, node => node.type === 'button')[0]
  assert.ok(header.props.className.includes('justify-between'))
  button.props.onClick(); assert.equal(edited, 1)
})

test('anonymous community reviews cannot inherit the signed-in viewer identity or profile link', () => {
  const { ReviewItem } = load('front/components/Common/reviews/review-item.tsx', {
    'next/link': { default: 'link' }, '@/components/ui/avatar': { Avatar: 'avatar', AvatarImage: 'avatar-image', AvatarFallback: 'avatar-fallback' },
    '@/lib/utils': utils, '@/lib/i18n/LanguageContext': language,
  })
  const tree = ReviewItem({ review: { reviewer: { isAnonymous: true, name: 'Anonymous User', profile: '' }, rating: 5 }, fallbackReviewer: { _id: 'me', name: 'My real name', profile: '/me.jpg' } })
  assert.equal(nodes(tree, node => node.type === 'link').length, 0)
  assert.ok(textOf(tree).includes('Anonymous User'))
  assert.equal(textOf(tree).includes('My real name'), false)
  assert.equal(nodes(tree, node => node.type === 'avatar-image')[0].props.src, '/default-avatar.png')
})

test('fractional review ratings retain their half-star fill', () => {
  const { ReviewItem } = load('front/components/Common/reviews/review-item.tsx', {
    'next/link': { default: 'link' }, 'lucide-react': { Star: 'star' },
    '@/components/ui/avatar': { Avatar: 'avatar', AvatarImage: 'avatar-image', AvatarFallback: 'avatar-fallback' },
    '@/lib/utils': utils, '@/lib/i18n/LanguageContext': language,
  })
  const tree = ReviewItem({ review: { rating: 4.5, reviewer: { name: 'Ana' }, review: 'My review' } })
  assert.equal(nodes(tree, node => node.props?.style?.width === '100%').length, 4)
  assert.equal(nodes(tree, node => node.props?.style?.width === '50%').length, 1)
  assert.ok(nodes(tree, node => node.props?.['aria-label'] === '4.5 / 5').length)
  assert.ok(textOf(tree).includes('4.5'))
})

test('profile review edit keeps the correct review/target IDs for place and business reviews', () => {
  for (const business of [false, true]) {
    let open = false
    const { ReviewCard } = load('front/components/Common/profile/contributions-reviews/review-card.tsx', {
      react: { useState: () => [false, value => open = value] },
      'next/link': { default: 'link' }, '@/lib/utils': utils, '@/lib/i18n/LanguageContext': language,
      '../../maps/review-modal': { ReviewModal: 'review-modal' }, '../../reviews/review-item': { ReviewItem: 'review-item' },
    })
    const tree = ReviewCard({ review: { _id: 'review-id', [business ? 'businessId' : 'placeId']: 'target-id', review: { en: 'My review' }, rating: 4, status: 'Pending' } })
    nodes(tree, node => node.type === 'review-item')[0].props.onEdit()
    assert.equal(open, true)
    const modal = nodes(tree, node => node.type === 'review-modal')[0]
    assert.equal(modal.props[business ? 'businessId' : 'placeId'], 'target-id')
    assert.equal(modal.props.initialData._id, 'review-id')
    assert.equal(modal.props.initialData.review, 'My review')
  }
})

test('mobile profile content scrolls independently of its fixed-size logout footer', () => {
  const code = source('front/components/shared/navigation/header.tsx')
  const file = ts.createSourceFile('header.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let drawer
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.getText(file).includes('isMobileProfileMenuOpen')) drawer = node
    ts.forEachChild(node, visit)
  }
  visit(file); assert.ok(drawer)
  const icons = Object.fromEntries(['X', 'User', 'Settings', 'Share2', 'Check', 'Grid2x2', 'Map', 'Edit2', 'Loader2'].map(name => [name, name]))
  const tree = evaluate(`exports.drawer = (${drawer.getText(file)});`, {}, {
    ...icons, isMobileProfileMenuOpen: true, ThemeToggle: 'theme', LanguageSwitcher: 'language', closeMenus() {}, Image: 'image',
    getProfileImageUrl: () => '/avatar.jpg', DEFAULT_AVATAR: '/avatar.jpg', user: { name: 'Ana', _id: 'owner' },
    t: key => key, currentLevelNumber: 2, currentLevelName: 'Explorer', maxPoints: 100, Progress: 'progress', progress: 50,
    isEs: false, Link: 'link', Button: 'button', handleEditProfile() {}, handleShareProfile() {}, isSharingProfile: false, shareCopied: false, isAdminOrEditor: true,
    visibleMenuItems: [{ icon: 'icon', href: '/profile', label: 'My routes' }], handleLogout() {}, isLoggingOut: false,
  }).drawer
  const scroll = nodes(tree, node => node.props?.['data-profile-menu-scroll'] !== undefined)[0]
  const footer = nodes(tree, node => node.props?.['data-profile-menu-footer'] !== undefined)[0]
  assert.ok(scroll.props.className.includes('min-h-0 flex-1 overflow-y-auto'))
  assert.equal(nodes(scroll, node => node === footer).length, 0)
  assert.ok(footer.props.className.includes('shrink-0'))
  const container = tree.props.children
  assert.ok(container.props.className.includes('h-[100dvh]'))
  assert.ok(container.props.className.includes('overflow-hidden'))
  assert.equal(nodes(footer, node => node.type === 'button').length, 1)
})
