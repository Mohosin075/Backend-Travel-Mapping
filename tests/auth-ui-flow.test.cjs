const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const frontRequire = require('node:module').createRequire(path.join(__dirname, '../../frontend_giovafilm_roadtripeado/package.json'));
const mapId = 'b'.repeat(24);
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function ui(file, options = {}) {
  const state = { auth: { accessToken: options.accessToken || null, user: options.user || null } };
  const params = new URLSearchParams(options.params || {});
  const storage = new Map(options.storage || []);
  const hooks = [], dependencies = [], effects = [], routes = [], actions = [], calls = {};
  let cursor = 0, Component;
  const dispatch = action => { actions.push(action); if (action.type === 'setUser') state.auth = action.payload; };
  const react = {
    useState: initial => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useRef: initial => { const index = cursor++; return hooks[index] ||= { current: initial }; },
    useMemo: fn => fn(),
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
    'next/link': 'a', 'next/navigation': { useSearchParams: () => params, useRouter: () => ({ push: path => routes.push(path), replace: path => routes.push(path) }) },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    'motion/react': { motion: new Proxy({}, { get: (_, name) => name }) },
    sonner: { toast: { success() {}, error() {}, loading() {} } },
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
      useVerifyPromoCodeQuery: () => ({ data: options.promo ? { data: options.promo } : undefined, isLoading: false, isError: false, refetch() {} }) },
    '@/redux/features/user/userApi': { useGetProfileQuery: () => ({ data: options.profile, isFetching: false }) },
    '@/redux/features/map/mapApi': { useGetMapByIdQuery: () => ({ data: { data: { _id: mapId, name: 'New Map', isPaid: true } }, isLoading: false }),
      useGetMapsQuery: () => ({ data: { data: [{ _id: mapId, name: 'New Map', isPaid: true }], meta: { totalPage: 1 } }, isFetching: false }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../frontend_giovafilm_roadtripeado', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, require: name => imports[name] ||
    (/ui\/(button|input|label|checkbox)/.test(name) ? { Button: 'button', Input: 'input', Label: 'label', Checkbox: 'checkbox' } : name === 'zod' ? require('zod') : {}),
    console, URLSearchParams, crypto: crypto.webcrypto, localStorage: storageApi, sessionStorage: storageApi,
    window: { location: { origin: 'https://example.test', assign: path => routes.push(path) } }, setTimeout: () => 0, clearTimeout() {},
  });
  Component = module.exports.default || module.exports[options.exportName];
  const render = () => {
    cursor = 0;
    let tree = Component(options.props);
    const inner = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'ClaimPromoContent');
    if (inner) tree = inner.type();
    return tree;
  };
  return { render, routes, calls, actions, storage, params, async effects() {
    for (const fn of effects.splice(0)) fn();
    await new Promise(resolve => setImmediate(resolve));
  } };
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);

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
test('new guest saves its capability before checkout and resumes its map purchase', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId }, responses: { useStartGuestMapCheckoutMutation: { data: { url: 'https://stripe.test' } } } });
  find(f.render(), 'input').props.onChange({ target: { value: 'BUYER@example.test' } });
  find(f.render(), 'form').props.onSubmit({ preventDefault() {} });
  await f.effects();
  assert.equal(f.calls.useStartGuestMapCheckoutMutation[0].email, 'buyer@example.test');
  assert.match(JSON.parse(f.storage.get(`map-checkout:${mapId}`)).token, /^[a-f\d]{64}$/);
  assert.equal(f.routes[0], 'https://stripe.test');
});
test('existing email button opens login instead of silently leaving the user on checkout', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId },
    responses: { useStartGuestMapCheckoutMutation: { data: { loginRequired: true } } } });
  find(f.render(), 'input').props.onChange({ target: { value: 'buyer@example.test' } });
  find(f.render(), 'form').props.onSubmit({ preventDefault() {} });
  await f.effects();
  const target = new URL(f.routes[0], 'https://example.test');
  assert.equal(target.pathname, '/login');
  assert.equal(target.searchParams.get('email'), 'buyer@example.test');
  assert.equal(target.searchParams.get('redirect'), `/catalog/checkout?mapId=${mapId}&resume=1`);
});
test('checkout connection timeout shows an actionable error beside the payment button', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId }, errors: { useStartGuestMapCheckoutMutation: { status: 'TIMEOUT_ERROR' } } });
  find(f.render(), 'input').props.onChange({ target: { value: 'buyer@example.test' } });
  find(f.render(), 'form').props.onSubmit({ preventDefault() {} });
  await f.effects();
  assert.ok(nodes(f.render()).some(node => node.props?.role === 'alert' && /payment server/.test(node.props.children)));
});
test('invalid purchase email explicitly explains why submission cannot continue', () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId } });
  find(f.render(), 'input').props.onInvalid();
  assert.ok(nodes(f.render()).some(node => node.props?.role === 'alert' && /valid email/.test(node.props.children)));
  assert.equal(f.calls.useStartGuestMapCheckoutMutation, undefined);
});
test('existing map owner opens the correct map without another Stripe request', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { accessToken: 'token', params: { mapId, resume: '1' }, profile: { purchasedMaps: [mapId] }, storage: [['selectedMapId', 'old-map']] });
  f.render(); await f.effects();
  assert.equal(f.storage.get('selectedMapId'), mapId);
  assert.equal(f.routes[0], '/maps');
  assert.equal(f.calls.useCreateMapCheckoutSessionMutation, undefined);
});
test('lost checkout storage does not auto-login on a success URL', async () => {
  const f = ui('components/Common/maps/map-checkout.tsx', { params: { mapId, session_id: 'cs_test' } });
  f.render(); await f.effects();
  assert.equal(f.calls.useCompleteGuestMapCheckoutMutation, undefined);
  assert.equal(f.actions.some(action => action.type === 'setUser'), false);
  assert.equal(f.routes.length, 0);
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
test('normal registration preserves the promo and selected map through OTP login', async () => {
  const redirect = `/claim-promo?code=PROMO&mapId=${mapId}`;
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
test('promo success URL cannot display success until server payment verification succeeds', async () => {
  const f = ui('app/(common)/claim-promo/page.tsx', { accessToken: 'token', params: { code: 'PROMO', success: 'true', session_id: 'cs_test' }, errors: { useVerifyPromoPaymentMutation: { data: { message: 'Payment unpaid' } } } });
  f.render(); await f.effects();
  const tree = f.render();
  assert.ok(nodes(tree).some(node => node.props?.role === 'alert' && node.props.children === 'Payment unpaid'));
  assert.equal(nodes(tree).some(node => node.props?.children === 'promo_claim.upgrade_success'), false);
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
  const source = fs.readFileSync(path.join(__dirname, '../../frontend_giovafilm_roadtripeado/redux/features/auth/authSlice.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { module, exports: module.exports, URL, window: { location: { origin: 'https://example.test', assign: path => destinations.push(path) } },
      require: name => name === '@reduxjs/toolkit' ? frontRequire(name) : name === '@/lib/utils' ? { decodeJwtPayload: () => ({ role: 'user' }) } : {} });
  for (const path of ['https://evil.test', '//evil.test', '/\\evil.test', '/claim-promo?code=PROMO', '/catalog/checkout?mapId=' + mapId]) module.exports.navigateAfterAuth(path);
  assert.deepEqual(destinations, ['/maps', '/maps', '/maps', '/claim-promo?code=PROMO', '/catalog/checkout?mapId=' + mapId]);
  const state = module.exports.default({ accessToken: 'old', user: { id: 'user', role: 'admin' } }, module.exports.setAccessToken('new'));
  assert.equal(state.user.role, 'user');
});
