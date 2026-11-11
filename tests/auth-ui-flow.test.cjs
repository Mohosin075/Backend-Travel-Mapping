const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const frontendRoot = process.env.GIOVAFILM_FRONTEND_DIR || [
  path.resolve(__dirname, '../../frontend_giovafilm_roadtripeado'),
  path.resolve(__dirname, '../../dashboard/giovafilm_mapping'),
].find(dir => fs.existsSync(path.join(dir, 'package.json')));
const frontRequire = require('node:module').createRequire(path.join(frontendRoot, 'package.json'));
const mapId = 'b'.repeat(24);
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function ui(file, options = {}) {
  const state = { auth: { accessToken: options.accessToken || null, user: options.user || null } };
  const params = new URLSearchParams(options.params || {});
  let searchString = params.toString(), searchSnapshot = new URLSearchParams(searchString);
  const useSearchParams = () => {
    if (searchString !== params.toString()) {
      searchString = params.toString(); searchSnapshot = new URLSearchParams(searchString);
    }
    return searchSnapshot;
  };
  const storage = new Map(options.storage || []);
  const hooks = [], dependencies = [], effects = [], routes = [], actions = [], calls = {};
  let cursor = 0, Component;
  const timers = [];
  const router = { push: path => routes.push(path), replace: path => { routes.push(path); } };
  const dispatch = action => { actions.push(action); if (action.type === 'setUser') state.auth = action.payload; if (action.update && options.profile) action.update(options.profile); };
  const react = {
    useState: initial => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useRef: initial => { const index = cursor++; return hooks[index] ||= { current: initial }; },
    useMemo: (fn, deps) => {
      const index = cursor++;
      if (!dependencies[index] || deps.some((value, n) => value !== dependencies[index][n])) hooks[index] = fn();
      dependencies[index] = deps;
      return hooks[index];
    },
    useEffect: (fn, deps) => {
      const index = cursor++;
      if (!dependencies[index] || deps.some((value, n) => value !== dependencies[index][n])) effects.push(fn);
      dependencies[index] = deps;
    },
    Suspense: 'suspense',
  };
  const mutation = name => () => [body => ({ unwrap: async () => {
    (calls[name] ||= []).push(body);
    if (options.errors?.[name]) throw options.errors[name];
    return options.responses?.[name] || { success: true, data: {} };
  } }), { isLoading: false }];
  const storageApi = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const authApi = new Proxy({}, { get: (_, name) => mutation(name) });
  const imports = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    'react-redux': { useDispatch: () => dispatch },
    'react-hook-form': { useForm: () => ({ register: name => ({ name }), handleSubmit: fn => fn, setValue() {}, watch: name => options.params?.[name] || '', formState: { errors: {} } }) },
    '@hookform/resolvers/zod': { zodResolver: () => ({}) },
    'next/link': 'a', 'next/navigation': { useSearchParams, useRouter: () => router, useParams: () => ({ id: mapId }) },
    '@/components/shared/login-required-modal': { useLoginRequired: () => ({ openLoginRequired: path => (calls.loginRequired ||= []).push(path) }) },
    '@/redux/features/award/awardApi': { useGetAwardsQuery: () => ({ data: { data: options.awards || [] } }), useRedeemFreeMapMutation: mutation('useRedeemFreeMapMutation') },
    'next-themes': { useTheme: () => ({ resolvedTheme: 'light' }) },
    '@vis.gl/react-google-maps': { APIProvider: 'provider', Map: 'map', MapControl: 'control', ControlPosition: {}, useMapsLibrary: () => undefined },
    './MapFilters': { MapFilters: 'filters', SelectedMapFilter: 'selected-filter' },
    '@/lib/record-visit': { trackUsage: (...args) => (calls.tracking ||= []).push(args), normalizePinType: value => value },
    '@/lib/editor-access': { editorCanAccessMap: () => false },
    '@/redux/features/category/categoryApi': { useGetCategoriesQuery: () => ({ data: { data: [] }, isSuccess: true }) },
    '@/redux/features/visited/visitedApi': { useGetMyVisitedPlacesQuery: () => ({ data: { data: [] } }) },
    '@/redux/features/public/publicApi': { useGetPublicPlacesBusinessQuery: (args, config) => { if (!config?.skip) (calls.discovery ||= []).push(args); return { currentData: { data: [] }, isSuccess: true }; } },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    'motion/react': { motion: new Proxy({}, { get: (_, name) => name }) },
    sonner: { toast: { success() {}, error() {}, loading() {}, info() {} } },
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ language: 'en', t: key => key }) },
    '@/lib/utils': { decodeJwtPayload: () => ({ authId: 'user', email: 'buyer@example.test', role: 'user' }), getLocalized: value => typeof value === 'string' ? value : value?.en || '', getApiErrorMessage: err => err.message },
    '@/lib/roles': { isDashboardRole: role => role === 'admin' },
    '@/redux/hook': { useAppDispatch: () => dispatch, useAppSelector: fn => fn(state) },
    '@/redux/store': { persistor: { flush: async () => actions.push({ type: 'flushed' }) } },
    '@/redux/features/auth/authSlice': { selectAccessToken: state => state.auth.accessToken, setUser: payload => ({ type: 'setUser', payload }), navigateAfterAuth: path => routes.push(path), logout: () => ({ type: 'logout' }) },
    '@/redux/api/baseApi': { baseApi: { util: { resetApiState: () => ({ type: 'resetCache' }), invalidateTags: () => ({ type: 'invalidate' }) } } },
    '@/redux/features/auth/authApi': authApi,
    '@/components/shared/cross-tab-logout-listener': { broadcastLogout: () => actions.push({ type: 'broadcastLogout' }) },
    '@/redux/features/payment/paymentApi': authApi,
    '@/redux/features/promo/promoApi': { ...Object.fromEntries(['useClaimFreePromoMutation', 'useCreatePromoCheckoutSessionMutation', 'useVerifyPromoPaymentMutation'].map(name => [name, mutation(name)])),
      useVerifyPromoCodeQuery: () => ({ data: options.promo ? { data: options.promo } : undefined, isLoading: false, isError: Boolean(options.promoError), error: options.promoError, refetch() {} }) },
    '@/redux/features/user/userApi': {
      userApi: { util: { updateQueryData: (endpoint, args, update) => ({ type: 'updateProfileCache', update }) } },
      useGetProfileQuery: () => ({ data: options.profile, isFetching: Boolean(options.profileLoading), isLoading: Boolean(options.profileLoading), isError: Boolean(options.profileError), refetch: () => ({ unwrap: async () => {
        (calls.refetchProfile ||= []).push(true);
        return options.profileResponses?.shift() || options.profile;
      } }) }),
    },
    '@/redux/features/map/mapApi': { useGetMapByIdQuery: () => ({ data: { data: options.mapDetail || { _id: mapId, name: 'New Map', isPaid: true } }, isLoading: false }),
      useGetMapsQuery: () => ({ data: { data: options.maps || [{ _id: mapId, name: 'New Map', isPaid: true }], meta: { totalPage: 1 } }, isFetching: false, isSuccess: true }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(frontendRoot, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, require: name => imports[name] ||
    (/ui\/(button|input|label|checkbox)/.test(name) ? { Button: 'button', Input: 'input', Label: 'label', Checkbox: 'checkbox' } : name === 'zod' ? require('zod') : {}),
    console, URLSearchParams, process: { env: {} }, crypto: crypto.webcrypto, localStorage: storageApi, sessionStorage: storageApi,
    window: { innerWidth: 1200, addEventListener() {}, removeEventListener() {}, location: { origin: 'https://example.test', pathname: `/catalog/${mapId}`, search: '', assign: path => routes.push(path), set href(path) { routes.push(path); } } }, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  Component = module.exports.default || module.exports[options.exportName];
  const render = () => {
    cursor = 0;
    let tree = Component(options.props);
    const inner = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'ClaimPromoContent');
    if (inner) tree = inner.type();
    return tree;
  };
  return { render, routes, calls, actions, storage, params, state, timers() { for (const fn of timers.splice(0)) fn(); }, async effects() {
    for (const fn of effects.splice(0)) fn();
    await new Promise(resolve => setImmediate(resolve));
  } };
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);

for (const target of [mapId, 'New Map', 'Missing Map']) {
  test(`View-on-map target ${target} never loads the previously owned map while checking access`, async () => {
    const oldMap = 'a'.repeat(24);
    const f = ui('components/Common/maps/map.tsx', { accessToken: 'token', profile: { purchasedMaps: [oldMap] },
      maps: [{ _id: oldMap, name: 'Puerto Rico' }, { _id: mapId, name: 'New Map' }],
      storage: [['selectedMapId', oldMap], ['selectedCountryFilter', 'Puerto Rico']] });
    f.render(); await f.effects(); assert.ok(find(f.render(), 'provider')); await f.effects();
    f.params.set('focus', 'c'.repeat(24)); f.params.set('map', target);
    f.calls.discovery.length = 0; f.calls.tracking.length = 0;
    assert.equal(find(f.render(), 'provider'), undefined, 'cached route checks target before effects');
    await f.effects();
    f.params.delete('focus'); f.params.delete('map');
    assert.equal(find(f.render(), 'provider'), undefined, 'still blocked after URL consumption');
    await f.effects();
    assert.equal(f.calls.discovery.length, 0);
    assert.equal(f.calls.tracking.length, 0);
  });
}

test('View-on-map opens a purchased target and retains it after consuming the URL', async () => {
  const oldMap = 'a'.repeat(24);
  const f = ui('components/Common/maps/map.tsx', { accessToken: 'token', profile: { purchasedMaps: [mapId] },
    params: { focus: 'c'.repeat(24), map: 'New Map' }, maps: [{ _id: oldMap, name: 'Puerto Rico' }, { _id: mapId, name: 'New Map' }],
    storage: [['selectedMapId', oldMap], ['selectedCountryFilter', 'Puerto Rico']] });
  f.render(); await f.effects();
  assert.ok(find(f.render(), 'provider'));
  assert.equal(f.calls.discovery.at(-1).map, mapId);
  await f.effects(); f.params.delete('focus'); f.params.delete('map');
  assert.ok(find(f.render(), 'provider'));
  assert.equal(f.calls.discovery.at(-1).map, mapId);
});

test('profile loading, successful resolution and entitlement removal never show an unauthorized map', async () => {
  const options = { accessToken: 'token', profileLoading: true, params: { mapId } };
  const f = ui('components/Common/maps/map.tsx', options);
  f.render(); await f.effects(); assert.equal(find(f.render(), 'provider'), undefined);
  options.profileLoading = false; options.profile = { purchasedMaps: [mapId] };
  assert.ok(find(f.render(), 'provider'));
  options.profile = { purchasedMaps: [] };
  assert.equal(find(f.render(), 'provider'), undefined);
  options.profile = { purchasedMaps: [mapId] };
  assert.ok(find(f.render(), 'provider'));
  f.state.auth.accessToken = null;
  assert.equal(find(f.render(), 'provider'), undefined, 'logout unmounts even with cached entitlements');
});

for (const scenario of [
  { name: 'guest', allowed: false },
  { name: 'stale cached profile after logout', profile: { purchasedMaps: [mapId] }, allowed: false },
  { name: 'unpaid account', accessToken: 'token', profile: { role: 'user', purchasedMaps: [] }, allowed: false },
  { name: 'another map owner', accessToken: 'token', profile: { purchasedMaps: ['a'.repeat(24)] }, allowed: false },
  { name: 'profile loading', accessToken: 'token', profileLoading: true, allowed: false },
  { name: 'profile error', accessToken: 'token', profileError: true, allowed: false },
  { name: 'owner', accessToken: 'token', profile: { purchasedMaps: [mapId] }, allowed: true },
  { name: 'populated owner', accessToken: 'token', profile: { purchasedMaps: [{ _id: mapId }] }, allowed: true },
  ...['admin', 'super_admin', 'map_editor'].map(role => ({ name: role, accessToken: 'token', profile: { role, purchasedMaps: [] }, allowed: true })),
]) {
  test(`explorer gates Google Maps and discovery for ${scenario.name}`, async () => {
    const f = ui('components/Common/maps/map.tsx', { ...scenario, params: { mapId } });
    assert.equal(find(f.render(), 'provider'), undefined, 'no map before hydration');
    await f.effects();
    const tree = f.render(); await f.effects();
    assert.equal(Boolean(find(tree, 'provider')), scenario.allowed);
    assert.equal(Boolean(find(tree, 'map')), scenario.allowed);
    assert.equal(Boolean(f.calls.discovery?.length), scenario.allowed);
    assert.equal(Boolean(f.calls.tracking?.length), scenario.allowed);
  });
}

test('switching to an unpurchased map unmounts Google Maps; returning to an owned map restores it', async () => {
  const oldMap = 'a'.repeat(24);
  const f = ui('components/Common/maps/map.tsx', { accessToken: 'token', profile: { purchasedMaps: [mapId] }, params: { mapId },
    maps: [{ _id: mapId, name: 'New Map' }, { _id: oldMap, name: 'Puerto Rico' }] });
  f.render(); await f.effects();
  assert.ok(find(f.render(), 'provider'));
  f.params.set('mapId', oldMap);
  assert.equal(find(f.render(), 'provider'), undefined);
  await f.effects(); f.params.delete('mapId');
  const tree = f.render(); await f.effects();
  find(tree, 'select').props.onChange({ target: { value: mapId } });
  assert.ok(find(f.render(), 'provider'));
});

test('confirmed promo entitlement unlocks the explorer without logging in again', async () => {
  const options = { accessToken: 'token', profile: { role: 'user', purchasedMaps: [] }, params: { mapId } };
  const f = ui('components/Common/maps/map.tsx', options);
  f.render(); await f.effects();
  assert.equal(find(f.render(), 'provider'), undefined);
  options.profile = { ...options.profile, purchasedMaps: [mapId] };
  assert.ok(find(f.render(), 'provider'));
});

for (const outsideCatalogue of [false, true]) {
  test(`cached map page switches from Puerto Rico to promo map${outsideCatalogue ? ' outside first catalogue page' : ''}`, async () => {
    const oldMap = 'a'.repeat(24);
    const maps = [{ _id: oldMap, name: 'Puerto Rico' }, ...(!outsideCatalogue ? [{ _id: mapId, name: 'New Map' }] : [])];
    const f = ui('components/Common/maps/map.tsx', { maps, profile: { purchasedMaps: [oldMap, mapId] }, accessToken: 'token',
      storage: [['selectedMapId', oldMap], ['selectedCountryFilter', 'Puerto Rico'], ['mapCameraState', JSON.stringify({ center: { lat: 18, lng: -66 }, zoom: 13 })]] });
    f.render(); await f.effects(); f.render(); await f.effects();
    f.params.set('mapId', mapId);
    f.render(); await f.effects(); f.render(); await f.effects();
    assert.equal(f.calls.discovery.at(-1).map, mapId);
    assert.equal(f.storage.get('selectedMapId'), mapId);
    assert.equal(f.storage.get('selectedCountryFilter'), 'New Map');
    assert.equal(f.storage.has('mapCameraState'), false);
    assert.equal(f.routes.at(-1), '/maps');
    f.params.delete('mapId');
    f.render(); await f.effects();
    assert.equal(f.calls.discovery.at(-1).map, mapId);
    assert.equal(f.storage.get('selectedCountryFilter'), 'New Map');
  });
}

for (const paid of [false, true]) {
  test(`${paid ? 'paid' : 'free'} promo opens the fulfilled map despite stale Puerto Rico selection`, async () => {
    const oldMap = 'a'.repeat(24);
    const options = { accessToken: 'token', params: { code: 'PROMO', ...(paid ? { success: 'true', session_id: 'cs_test' } : {}) },
      profile: { verified: true, purchasedMaps: [oldMap] },
      promo: { mapId, mapName: 'New Map', price: paid ? 10 : 0 },
      storage: [['selectedMapId', oldMap], ['selectedCountryFilter', 'Puerto Rico']],
      responses: { [paid ? 'useVerifyPromoPaymentMutation' : 'useClaimFreePromoMutation']: { success: true, data: { mapId, mapName: 'New Map' } } } };
    const f = ui('app/(common)/claim-promo/page.tsx', options);
    f.render(); await f.effects();
    assert.ok(options.profile.purchasedMaps.includes(mapId));
    assert.ok(f.calls.refetchProfile.length);
    // Promo invalidation can remove its cached details before the user opens the map.
    options.promo = undefined;
    const button = nodes(f.render()).find(node => node.type === 'button' && JSON.stringify(node.props.children).includes('promo_claim.open_map'));
    assert.ok(button);
    button.props.onClick();
    assert.equal(f.routes.at(-1), `/maps?mapId=${mapId}`);
    assert.equal(f.storage.get('selectedMapId'), mapId);
    assert.notEqual(f.storage.get('selectedCountryFilter'), 'Puerto Rico');
    if (!paid) { f.timers(); assert.equal(f.routes.at(-1), `/maps?mapId=${mapId}`); }
  });
}

test('legacy paid promo return uses the verified receipt rather than the first purchased map', async () => {
  const f = ui('app/(common)/claim-promo/page.tsx', { accessToken: 'token', params: { code: 'PROMO', success: 'true' },
    profile: { purchasedMaps: ['a'.repeat(24)] }, responses: { useVerifyPromoPaymentMutation: { data: { mapId } } } });
  f.render(); await f.effects();
  const button = nodes(f.render()).find(node => node.type === 'button' && JSON.stringify(node.props.children).includes('promo_claim.open_map'));
  button.props.onClick();
  assert.equal(f.routes.at(-1), `/maps?mapId=${mapId}`);
});

test('promo fulfilment refreshes again if an older in-flight profile omits the new map', async () => {
  const options = { accessToken: 'token', params: { code: 'PROMO', success: 'true' },
    profile: { purchasedMaps: [] }, profileResponses: [{ purchasedMaps: [] }, { purchasedMaps: [mapId] }],
    responses: { useVerifyPromoPaymentMutation: { data: { mapId } } } };
  const f = ui('app/(common)/claim-promo/page.tsx', options);
  f.render(); await f.effects();
  assert.equal(f.calls.refetchProfile.length, 2);
  assert.deepEqual(options.profile.purchasedMaps, [mapId]);
});

for (const redirect of ['/catalog/checkout?mapId=' + mapId + '&resume=1', '/claim-promo?code=PROMO&mapId=' + mapId]) {
  test(`unverified login preserves return path through OTP: ${redirect}`, async () => {
    const f = ui('components/auth/Login-form.tsx', { exportName: 'LoginForm', params: { redirect }, responses: { useLoginMutation: { success: true, data: { needPassword: true } } } });
    await find(f.render(), 'form').props.onSubmit({ email: 'buyer@example.test', password: 'password', rememberMe: false });
    const next = new URL(f.routes[0], 'https://example.test');
    assert.equal(next.pathname, '/otp-verify');
    assert.equal(next.searchParams.get('redirect'), redirect);
    assert.equal(next.searchParams.get('authType'), 'invite');
  });
  test(`forgot → OTP → password setup → login preserves: ${redirect}`, async () => {
    const forgot = ui('components/auth/forgot-password-form.tsx', { exportName: 'ForgotPasswordForm', params: { redirect }, responses: { useForgetPasswordMutation: { success: true } } });
    await find(forgot.render(), 'form').props.onSubmit({ email: 'buyer@example.test' });
    const otpParams = new URL(forgot.routes[0], 'https://example.test').searchParams;
    const otp = ui('components/auth/otp-verify-form.tsx', { params: Object.fromEntries(otpParams), responses: { useVerifyAccountMutation: { success: true, data: { token: 'reset-token' } } } });
    find(otp.render(), 'input').props.onPaste({ preventDefault() {}, clipboardData: { getData: () => '123456' } });
    await find(otp.render(), 'button').props.onClick();
    const resetParams = new URL(otp.routes[0], 'https://example.test').searchParams;
    assert.equal(resetParams.get('redirect'), redirect);
    const reset = ui('components/auth/reset-password-form.tsx', { exportName: 'ResetPasswordForm', params: Object.fromEntries(resetParams), responses: { useResetPasswordMutation: { success: true } } });
    await find(reset.render(), 'form').props.onSubmit({ password: 'new-password', confirmPassword: 'new-password' });
    assert.equal(new URL(reset.routes[0], 'https://example.test').searchParams.get('redirect'), redirect);
  });
}
test('ordinary password login resets account cache and persists login before navigating', async () => {
  const f = ui('components/auth/Login-form.tsx', { exportName: 'LoginForm', responses: { useLoginMutation: { success: true, data: { accessToken: 'token' } } } });
  await find(f.render(), 'form').props.onSubmit({ email: 'buyer@example.test', password: 'password', rememberMe: false });
  assert.deepEqual(f.actions.map(action => action.type), ['setUser', 'resetCache', 'flushed']);
  assert.equal(f.routes[0], '/maps');
});
test('Google login retains selected promo destination and clears previous user cache', async () => {
  const f = ui('components/auth/Login-form.tsx', { exportName: 'LoginForm', params: { accessToken: 'google-token', redirect: '/claim-promo?code=PROMO' } });
  f.render(); await f.effects();
  assert.equal(f.routes[0], '/claim-promo?code=PROMO');
  assert.ok(f.actions.some(action => action.type === 'resetCache'));
});
test('guest Buy Now opens the login/register modal for the same map without starting payment', async () => {
  const f = ui('components/Common/maps/feature-map-detail.tsx');
  await find(f.render(), 'button').props.onClick();
  assert.deepEqual(f.calls.loginRequired, [`/catalog/${mapId}`]);
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation, undefined);
  assert.equal(f.routes.length, 0);
});

test('authenticated Buy Now retains the original Stripe checkout and return URLs', async () => {
  const f = ui('components/Common/maps/feature-map-detail.tsx', { accessToken: 'token', profile: { purchasedMaps: [] },
    responses: { useCreateMapCheckoutSessionMutation: { data: { url: 'https://stripe.test' } } } });
  await find(f.render(), 'button').props.onClick();
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation[0].mapId, mapId);
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation[0].successUrl, 'https://example.test?session_id={CHECKOUT_SESSION_ID}&success=true');
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation[0].cancelUrl, 'https://example.test/payment-failed?success=false');
  assert.equal(f.routes[0], 'https://stripe.test');
});

test('free-map award still redeems without creating a Stripe checkout', async () => {
  const f = ui('components/Common/maps/feature-map-detail.tsx', { accessToken: 'token', profile: { purchasedMaps: [] },
    awards: [{ type: 'Free Map', isUnlocked: true, config: { mapCount: 1 } }] });
  await find(f.render(), 'button').props.onClick();
  assert.equal(f.calls.useRedeemFreeMapMutation[0].mapId, mapId);
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation, undefined);
  assert.equal(f.routes[0], '/maps');
});

for (const saved of [undefined, '{broken', 'null', JSON.stringify({ email: 'buyer@example.test', token: 'invalid' })]) {
  test(`fresh checkout requires login without issuing a capability: ${saved}`, async () => {
    const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId, cancelled: '1', resume: '1' },
      storage: saved === undefined ? [] : [[`map-checkout:${mapId}`, saved]] });
    assert.equal(find(f.render(), 'input'), undefined);
    await f.effects(); f.render(); await f.effects();
    const target = new URL(f.routes[0], 'https://example.test');
    assert.equal(target.pathname, `/catalog/${mapId}`);
    assert.equal(target.searchParams.get('loginRequired'), '1');
    assert.equal(target.searchParams.get('redirect'), `/catalog/${mapId}`);
    assert.equal(f.calls.useStartGuestMapCheckoutMutation, undefined);
    assert.equal(f.storage.get(`map-checkout:${mapId}`), saved);
  });
}

const legacyStorage = () => [[`map-checkout:${mapId}`, JSON.stringify({ email: 'buyer@example.test', token: 'c'.repeat(64) })]];
test('legacy guest resumes the saved capability without changing its account or token', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId, cancelled: '1' }, storage: legacyStorage(),
    responses: { useStartGuestMapCheckoutMutation: { data: { url: 'https://stripe.test' } } } });
  f.render(); await f.effects();
  find(f.render(), 'form').props.onSubmit({ preventDefault() {} });
  await f.effects();
  assert.equal(f.calls.useStartGuestMapCheckoutMutation[0].email, 'buyer@example.test');
  assert.equal(f.calls.useStartGuestMapCheckoutMutation[0].checkoutToken, 'c'.repeat(64));
  assert.equal(f.storage.get(`map-checkout:${mapId}`), legacyStorage()[0][1]);
  assert.equal(find(f.render(), 'input'), undefined);
  assert.equal(f.routes[0], 'https://stripe.test');
});
test('existing email button opens login instead of silently leaving the user on checkout', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId }, storage: legacyStorage(),
    responses: { useStartGuestMapCheckoutMutation: { data: { loginRequired: true } } } });
  f.render(); await f.effects();
  find(f.render(), 'form').props.onSubmit({ preventDefault() {} });
  await f.effects();
  const target = new URL(f.routes[0], 'https://example.test');
  assert.equal(target.pathname, '/login');
  assert.equal(target.searchParams.get('email'), 'buyer@example.test');
  assert.equal(target.searchParams.get('redirect'), `/catalog/${mapId}`);
});
test('checkout connection timeout shows an actionable error beside the payment button', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId }, storage: legacyStorage(), errors: { useStartGuestMapCheckoutMutation: { status: 'TIMEOUT_ERROR' } } });
  f.render(); await f.effects();
  find(f.render(), 'form').props.onSubmit({ preventDefault() {} });
  await f.effects();
  assert.ok(nodes(f.render()).some(node => node.props?.role === 'alert' && /payment server/.test(node.props.children)));
});
for (const saved of [undefined, 'null', '{broken', JSON.stringify({ email: 'buyer@example.test', token: 'invalid' })]) {
test(`lost/corrupt capability during a legacy retry returns to login without creating another checkout: ${saved}`, async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId }, storage: legacyStorage() });
  f.render(); await f.effects();
  const form = find(f.render(), 'form');
  if (saved === undefined) f.storage.delete(`map-checkout:${mapId}`);
  else f.storage.set(`map-checkout:${mapId}`, saved);
  form.props.onSubmit({ preventDefault() {} });
  await f.effects();
  assert.equal(new URL(f.routes[0], 'https://example.test').searchParams.get('loginRequired'), '1');
  assert.equal(f.calls.useStartGuestMapCheckoutMutation, undefined);
});
}
test('existing map owner opens the correct map without another Stripe request', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { accessToken: 'token', params: { mapId, resume: '1' }, profile: { purchasedMaps: [mapId] }, storage: [['selectedMapId', 'old-map']] });
  f.render(); await f.effects();
  assert.equal(f.storage.get('selectedMapId'), mapId);
  assert.equal(f.routes[0], '/maps');
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation, undefined);
});
for (const saved of [undefined, 'null', '{broken', JSON.stringify({ email: 'buyer@example.test', token: 'invalid' })]) {
test(`lost/corrupt checkout storage offers recovery without auto-login or another charge: ${saved}`, async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId, session_id: 'cs_test' },
    storage: saved === undefined ? [] : [[`map-checkout:${mapId}`, saved]] });
  f.render(); await f.effects();
  assert.equal(f.calls.useCompleteGuestMapCheckoutMutation, undefined);
  assert.equal(f.actions.some(action => action.type === 'setUser'), false);
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation, undefined);
  assert.equal(f.routes.length, 0);
  const links = nodes(f.render()).filter(node => node.type === 'a');
  for (const pathname of ['/login', '/set-password']) {
    const recovery = links.find(node => new URL(node.props.href, 'https://example.test').pathname === pathname);
    assert.ok(recovery, `missing ${pathname} recovery link`);
    assert.equal(new URL(recovery.props.href, 'https://example.test').searchParams.get('redirect'), '/profile/purchased-maps');
  }
});
}

test('payment return cannot overwrite a different signed-in account', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { accessToken: 'another-account-token',
    user: { email: 'another@example.test' }, params: { mapId, session_id: 'cs_test' }, storage: legacyStorage(), profile: { purchasedMaps: [] } });
  f.render(); await f.effects();
  assert.equal(f.calls.useCompleteGuestMapCheckoutMutation, undefined);
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation, undefined);
  assert.equal(f.actions.some(action => action.type === 'setUser'), false);
  assert.ok(nodes(f.render()).some(node => node.props?.role === 'alert' && /another account/.test(node.props.children)));
});

test('legacy completion requiring normal login opens purchased maps without automatically buying again', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId, session_id: 'cs_test' }, storage: legacyStorage(),
    responses: { useCompleteGuestMapCheckoutMutation: { data: { loginRequired: true } } } });
  f.render(); await f.effects();
  const target = new URL(f.routes[0], 'https://example.test');
  assert.equal(target.pathname, '/login');
  assert.equal(target.searchParams.get('email'), 'buyer@example.test');
  assert.equal(target.searchParams.get('redirect'), '/profile/purchased-maps');
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation, undefined);
});
test('successful guest verification logs in, clears old cache, persists and opens the purchased map', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId, session_id: 'cs_test' },
    storage: [[`map-checkout:${mapId}`, JSON.stringify({ email: 'buyer@example.test', token: 'c'.repeat(64) })]],
    responses: { useCompleteGuestMapCheckoutMutation: { data: { accessToken: 'token' } } } });
  f.render(); await f.effects(); f.render(); await f.effects();
  assert.deepEqual(f.actions.map(action => action.type), ['setUser', 'resetCache', 'flushed']);
  assert.equal(f.storage.has(`map-checkout:${mapId}`), false);
  assert.equal(f.storage.get('selectedMapId'), mapId);
  assert.ok(f.routes.includes('/maps'));
});
test('existing account resumes the chosen map checkout after normal login', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { accessToken: 'token', params: { mapId, resume: '1' }, profile: { purchasedMaps: [] },
    responses: { useCreateMapCheckoutSessionMutation: { data: { url: 'https://stripe.test/existing' } } } });
  f.render(); await f.effects();
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation[0].mapId, mapId);
  assert.equal(f.routes[0], 'https://stripe.test/existing');
});
for (const redirect of [`/claim-promo?code=PROMO&mapId=${mapId}`, `/catalog/${mapId}`]) {
test(`normal registration preserves the destination through OTP login: ${redirect}`, async () => {
  const signup = ui('components/auth/register-form.tsx', { exportName: 'RegisterForm', params: { redirect },
    responses: { useRegisterMutation: { data: { email: 'buyer@example.test' } } } });
  await find(signup.render(), 'form').props.onSubmit({ fullName: 'Buyer', email: 'buyer@example.test', password: 'password' });
  const otp = ui('components/auth/otp-verify-form.tsx', { params: Object.fromEntries(new URL(signup.routes[0], 'https://example.test').searchParams),
    responses: { useVerifyAccountMutation: { success: true, data: { accessToken: 'token' } } } });
  find(otp.render(), 'input').props.onPaste({ preventDefault() {}, clipboardData: { getData: () => '123456' } });
  await find(otp.render(), 'button').props.onClick();
  assert.equal(otp.routes[0], redirect);
  assert.deepEqual(otp.actions.map(action => action.type), ['setUser', 'resetCache', 'flushed']);
});
}

test('ordinary login returns to map details without automatically starting another purchase', async () => {
  const f = ui('components/auth/Login-form.tsx', { exportName: 'LoginForm', params: { redirect: `/catalog/${mapId}` },
    responses: { useLoginMutation: { success: true, data: { accessToken: 'token' } } } });
  await find(f.render(), 'form').props.onSubmit({ email: 'buyer@example.test', password: 'password', rememberMe: false });
  assert.equal(f.routes[0], `/catalog/${mapId}`);
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation, undefined);
});
test('promo success URL cannot display success until server payment verification succeeds', async () => {
  const f = ui('app/(common)/claim-promo/page.tsx', { accessToken: 'token', params: { code: 'PROMO', success: 'true', session_id: 'cs_test' }, errors: { useVerifyPromoPaymentMutation: { data: { message: 'Payment unpaid' } } } });
  f.render(); await f.effects();
  const tree = f.render();
  assert.ok(nodes(tree).some(node => node.props?.role === 'alert' && node.props.children === 'Payment unpaid'));
  assert.equal(nodes(tree).some(node => node.props?.children === 'promo_claim.upgrade_success'), false);
});

test('paid promo return retains code, selected map and Stripe session through login', async () => {
  const f = ui('app/(common)/claim-promo/page.tsx', { params: { code: 'PROMO', mapId, success: 'true', session_id: 'cs_test' } });
  const link = nodes(f.render()).find(node => node.type === 'a' && node.props.href.startsWith('/login?'));
  const next = new URL(new URL(link.props.href, 'https://example.test').searchParams.get('redirect'), 'https://example.test');
  assert.equal(next.searchParams.get('code'), 'PROMO');
  assert.equal(next.searchParams.get('mapId'), mapId);
  assert.equal(next.searchParams.get('success'), 'true');
  assert.equal(next.searchParams.get('session_id'), 'cs_test');
  const login = ui('components/auth/Login-form.tsx', { exportName: 'LoginForm', params: { redirect: next.pathname + next.search },
    responses: { useLoginMutation: { data: { accessToken: 'token' } } } });
  await find(login.render(), 'form').props.onSubmit({ email: 'buyer@example.test', password: 'password', rememberMe: false });
  assert.equal(login.routes[0], next.pathname + next.search);
});

test('paid promo confirmation is invalid immediately after logout or account change', async () => {
  const f = ui('app/(common)/claim-promo/page.tsx', { accessToken: 'token', params: { code: 'PROMO', mapId, success: 'true', session_id: 'cs_test' },
    profile: { purchasedMaps: [] }, responses: { useVerifyPromoPaymentMutation: { data: { mapId } } } });
  f.render(); await f.effects();
  assert.ok(nodes(f.render()).some(node => node.props?.children === 'promo_claim.upgrade_success'));
  for (const token of [null, 'another-account-token']) {
    f.state.auth.accessToken = token;
    assert.equal(nodes(f.render()).some(node => node.props?.children === 'promo_claim.upgrade_success'), false);
  }
});

test('a delayed promo payment response cannot grant cached access after logout', async () => {
  let resolvePayment;
  const pending = new Promise(resolve => { resolvePayment = resolve; });
  const profile = { purchasedMaps: [] };
  const f = ui('app/(common)/claim-promo/page.tsx', { accessToken: 'token', params: { code: 'PROMO', mapId, success: 'true', session_id: 'cs_test' },
    profile, responses: { useVerifyPromoPaymentMutation: pending } });
  f.render(); await f.effects();
  f.state.auth.accessToken = null;
  f.render(); await f.effects();
  resolvePayment({ data: { mapId } });
  await f.effects();
  assert.deepEqual(profile.purchasedMaps, []);
  assert.equal(f.actions.some(action => action.type === 'updateProfileCache'), false);
  assert.equal(nodes(f.render()).some(node => node.props?.children === 'promo_claim.upgrade_success'), false);
});

test('a delayed profile refresh after promo verification cannot update another account', async () => {
  let resolveProfile;
  const pending = new Promise(resolve => { resolveProfile = resolve; });
  const options = { accessToken: 'token', params: { code: 'PROMO', mapId, success: 'true', session_id: 'cs_test' },
    profile: { purchasedMaps: [] }, profileResponses: [pending], responses: { useVerifyPromoPaymentMutation: { data: { mapId } } } };
  const f = ui('app/(common)/claim-promo/page.tsx', options);
  f.render(); await f.effects();
  options.profile = { email: 'another@example.test', purchasedMaps: [] };
  f.state.auth.accessToken = null;
  f.render(); await f.effects();
  resolveProfile({ purchasedMaps: [mapId] });
  await f.effects();
  assert.deepEqual(options.profile.purchasedMaps, []);
});

for (const failLogout of [false, true]) {
test(`promo account switching preserves the invitation and clears state only after server logout: ${failLogout}`, async () => {
  const f = ui('app/(common)/claim-promo/page.tsx', { accessToken: 'token', params: { code: 'PROMO', mapId },
    profile: { email: 'wrong@example.test', verified: true, purchasedMaps: [] }, promo: { mapId, price: 5, recipientEmail: 'buyer@example.test' },
    ...(failLogout ? { errors: { useLogoutMutation: { message: 'Cannot logout' } } } : {}) });
  const openMismatch = nodes(f.render()).find(node => node.type === 'button' && JSON.stringify(node.props.children).includes('View Mismatch Details'));
  assert.ok(openMismatch);
  openMismatch.props.onClick();
  const switchAccount = nodes(f.render()).find(node => node.type === 'button' && JSON.stringify(node.props.children).includes('Log Out & Switch Account'));
  await switchAccount.props.onClick();
  assert.equal(f.calls.useLogoutMutation.length, 1);
  if (failLogout) {
    assert.equal(f.routes.length, 0);
    assert.equal(f.actions.length, 0);
  } else {
    assert.deepEqual(f.actions.map(action => action.type), ['broadcastLogout', 'logout', 'resetCache', 'flushed']);
    const login = new URL(f.routes[0], 'https://example.test');
    assert.equal(login.searchParams.get('email'), 'buyer@example.test');
    assert.equal(login.searchParams.get('redirect'), `/claim-promo?code=PROMO&mapId=${mapId}`);
  }
  assert.equal(f.calls.useClaimFreePromoMutation, undefined);
  assert.equal(f.calls.useCreatePromoCheckoutSessionMutation, undefined);
});
}

test('free promo confirmation and pending map navigation do not survive logout', async () => {
  const f = ui('app/(common)/claim-promo/page.tsx', { accessToken: 'token', params: { code: 'PROMO', mapId },
    profile: { verified: true, purchasedMaps: [] }, promo: { mapId, price: 0 },
    responses: { useClaimFreePromoMutation: { data: { mapId } } } });
  f.render(); await f.effects();
  const confirmed = f.render();
  assert.ok(nodes(confirmed).some(node => node.type === 'button' && JSON.stringify(node.props.children).includes('promo_claim.open_map')));
  f.state.auth.accessToken = null;
  assert.equal(nodes(f.render()).some(node => node.props?.children === 'promo_claim.invitation_claimed'), false);
  await f.effects();
  f.timers();
  assert.equal(f.routes.some(route => route.startsWith('/maps')), false);
});

test('an already-used promo sends a returning buyer to purchased maps after login', () => {
  const f = ui('app/(common)/claim-promo/page.tsx', { params: { code: 'PROMO' },
    promoError: { data: { message: 'This promo link has already been used' } } });
  const loginButton = nodes(f.render()).find(node => node.type === 'button' && node.props.onClick);
  loginButton.props.onClick();
  assert.equal(new URL(f.routes[0], 'https://example.test').searchParams.get('redirect'), '/profile/purchased-maps');
});

for (const price of [0, 5]) {
test(`${price ? 'paid' : 'free'} targeted promo keeps its code/map/email for registration and login`, () => {
  const f = ui('app/(common)/claim-promo/page.tsx', { params: { code: 'PROMO', mapId },
    promo: { mapId, price, recipientEmail: 'buyer@example.test' } });
  const buttons = nodes(f.render()).filter(node => node.type === 'button' && node.props.onClick);
  for (const button of buttons) button.props.onClick();
  for (const pathname of ['/login', '/register']) {
    const target = f.routes.map(route => new URL(route, 'https://example.test')).find(url => url.pathname === pathname);
    assert.ok(target, `missing ${pathname} navigation`);
    assert.equal(target.searchParams.get('email'), 'buyer@example.test');
    assert.equal(target.searchParams.get('redirect'), `/claim-promo?code=PROMO&mapId=${mapId}`);
  }
  assert.equal(f.calls.useClaimFreePromoMutation, undefined);
  assert.equal(f.calls.useCreatePromoCheckoutSessionMutation, undefined);
});
}

test('Google login initiation retains the entire selected promo return path', async () => {
  const redirect = `/claim-promo?code=PROMO&mapId=${mapId}`;
  const f = ui('components/shared/social-login/social-login.tsx', { params: { redirect } });
  find(f.render(), 'button').props.onClick();
  assert.equal(new URL(f.routes[0]).searchParams.get('redirect'), redirect);
});
test('new guest must verify its email before auto-claiming a recipient-specific free promo', async () => {
  const f = ui('app/(common)/claim-promo/page.tsx', { accessToken: 'token', params: { code: 'PROMO' }, profile: { email: 'buyer@example.test', verified: false }, promo: { mapId, price: 0, recipientEmail: 'buyer@example.test' } });
  f.render(); await f.effects();
  assert.equal(f.calls.useClaimFreePromoMutation, undefined);
  const link = nodes(f.render()).find(node => node.type === 'a' && node.props.href.startsWith('/set-password'));
  assert.equal(new URL(link.props.href, 'https://example.test').searchParams.get('redirect'), '/claim-promo?code=PROMO');
});
test('generic promo selection retains map identity before registration/login', () => {
  const f = ui('app/(common)/claim-promo/page.tsx', { params: { code: 'PROMO' }, promo: { mapId: null, price: 0 } });
  find(f.render(), 'select').props.onChange({ target: { value: mapId } });
  assert.equal(new URL(f.routes[0], 'https://example.test').searchParams.get('mapId'), mapId);
});
test('first password setup shows verification copy and carries setup intent through OTP to Set Password', async () => {
  const redirect = `/catalog/checkout?mapId=${mapId}&resume=1`;
  const start = ui('components/auth/forgot-password-form.tsx', { exportName: 'ForgotPasswordForm', props: { mode: 'setup' },
    params: { email: 'buyer@example.test', redirect }, responses: { useForgetPasswordMutation: { success: true } } });
  const labels = nodes(start.render()).flatMap(node => typeof node.props?.children === 'string' ? [node.props.children] : []);
  assert.ok(labels.includes('auth.setup_verify_heading'));
  assert.ok(labels.includes('auth.send_verification_code'));
  assert.equal(labels.includes('auth.forgot_password'), false);
  assert.equal(labels.includes('auth.remember_password_prompt'), false);
  await find(start.render(), 'form').props.onSubmit({ email: 'buyer@example.test' });
  const otpParams = new URL(start.routes[0], 'https://example.test').searchParams;
  assert.equal(otpParams.get('authType'), 'setPassword');
  const otp = ui('components/auth/otp-verify-form.tsx', { params: Object.fromEntries(otpParams),
    responses: { useVerifyAccountMutation: { success: true, data: { token: 'setup-token' } } } });
  find(otp.render(), 'input').props.onPaste({ preventDefault() {}, clipboardData: { getData: () => '123456' } });
  await find(otp.render(), 'button').props.onClick();
  const resetParams = new URL(otp.routes[0], 'https://example.test').searchParams;
  assert.equal(resetParams.get('flow'), 'setup');
  assert.equal(resetParams.get('redirect'), redirect);
  const reset = ui('components/auth/reset-password-form.tsx', { exportName: 'ResetPasswordForm', params: Object.fromEntries(resetParams),
    responses: { useResetPasswordMutation: { success: true } } });
  const finalLabels = nodes(reset.render()).flatMap(node => typeof node.props?.children === 'string' ? [node.props.children] : []);
  assert.ok(finalLabels.includes('auth.set_password_heading'));
  assert.ok(finalLabels.includes('auth.setup_password_subtitle'));
  assert.ok(finalLabels.includes('auth.set_password_btn'));
  assert.equal(finalLabels.includes('auth.reset_password_heading'), false);
  assert.equal(finalLabels.includes('auth.set_password_subtitle'), false);
  await find(reset.render(), 'form').props.onSubmit({ password: 'new-password', confirmPassword: 'new-password' });
  assert.equal(new URL(reset.routes[0], 'https://example.test').searchParams.get('redirect'), redirect);
});
test('real forgotten password retains reset wording and reset OTP intent', async () => {
  const f = ui('components/auth/forgot-password-form.tsx', { exportName: 'ForgotPasswordForm', responses: { useForgetPasswordMutation: { success: true } } });
  const labels = nodes(f.render()).flatMap(node => typeof node.props?.children === 'string' ? [node.props.children] : []);
  assert.ok(labels.includes('auth.forgot_password'));
  assert.ok(labels.includes('auth.send_reset_link'));
  await find(f.render(), 'form').props.onSubmit({ email: 'buyer@example.test' });
  assert.equal(new URL(f.routes[0], 'https://example.test').searchParams.get('authType'), 'resetPassword');
});
test('passwordless purchase account login shows setup guidance without pretending a password matched', async () => {
  const redirect = '/profile/purchased-maps';
  const f = ui('components/auth/Login-form.tsx', { exportName: 'LoginForm', params: { redirect },
    responses: { useLoginMutation: { success: true, data: { passwordSetupRequired: true } } } });
  await find(f.render(), 'form').props.onSubmit({ email: 'buyer@example.test', password: 'arbitrary', rememberMe: false });
  assert.equal(f.routes.length, 0);
  assert.equal(f.actions.length, 0);
  const tree = f.render();
  assert.equal(find(tree, 'form'), undefined);
  assert.ok(nodes(tree).some(node => node.props?.role === 'status' && node.props.children === 'auth.login_password_not_set'));
  const link = nodes(tree).find(node => node.type === 'a' && node.props.href.startsWith('/set-password'));
  const url = new URL(link.props.href, 'https://example.test');
  assert.equal(url.searchParams.get('email'), 'buyer@example.test');
  assert.equal(url.searchParams.get('redirect'), redirect);
});
test('login offers email verification before any password needs to be entered', () => {
  const f = ui('components/auth/Login-form.tsx', { exportName: 'LoginForm', params: { email: 'buyer@example.test' } });
  const link = nodes(f.render()).find(node => node.type === 'a' && node.props.children === 'auth.login_no_password_yet');
  assert.equal(new URL(link.props.href, 'https://example.test').searchParams.get('email'), 'buyer@example.test');
  assert.equal(f.calls.useLoginMutation, undefined);
});
test('incorrect existing password stays on login without verification redirect or authentication', async () => {
  const f = ui('components/auth/Login-form.tsx', { exportName: 'LoginForm', errors: { useLoginMutation: { message: 'Incorrect password' } } });
  await find(f.render(), 'form').props.onSubmit({ email: 'buyer@example.test', password: 'incorrect', rememberMe: false });
  assert.equal(f.routes.length + f.actions.length, 0);
  assert.ok(find(f.render(), 'form'));
});

test('auth navigation rejects external and backslash destinations while retaining valid internal paths', () => {
  const module = { exports: {} }, destinations = [];
  const source = fs.readFileSync(path.join(frontendRoot, 'redux/features/auth/authSlice.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { module, exports: module.exports, URL, window: { location: { origin: 'https://example.test', assign: path => destinations.push(path) } },
      require: name => name === '@reduxjs/toolkit' ? frontRequire(name) : name === '@/lib/utils' ? { decodeJwtPayload: () => ({ role: 'user' }) } : {} });
  for (const path of ['https://evil.test', '//evil.test', '/\\evil.test', '/claim-promo?code=PROMO', '/catalog/checkout?mapId=' + mapId]) module.exports.navigateAfterAuth(path);
  assert.deepEqual(destinations, ['/maps', '/maps', '/maps', '/claim-promo?code=PROMO', '/catalog/checkout?mapId=' + mapId]);
  const state = module.exports.default({ accessToken: 'old', user: { id: 'user', role: 'admin' } }, module.exports.setAccessToken('new'));
  assert.equal(state.user.role, 'user');
});
