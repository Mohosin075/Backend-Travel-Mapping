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
const mapId = 'a'.repeat(24), userId = 'b'.repeat(24), token = 'c'.repeat(64);
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
function load(file, imports) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, require: name => imports[name] || (name.startsWith('.') ? {} : require(name)), console, Date, Buffer, URL });
  return module.exports;
}
function fixture(options = {}) {
  const calls = { created: [], checkout: [], fulfilled: [], cookies: [], tokens: [], stripe: [] };
  let user = options.user || null;
  let attempt = options.attempt ? { tokenHash, userId, mapId, email: 'buyer@example.test',
    expiresAt: new Date(Date.now() + 60000), sessionId: 'cs_test', save: async () => {}, ...options.attempt } : null;
  const payment = { amount: 35, currency: 'USD', status: 'pending', ...options.payment };
  const session = { id: 'cs_test', status: 'complete', payment_status: 'paid', amount_total: 3500, currency: 'usd',
    metadata: { userId, mapId }, ...options.session };
  const matches = (object, query) => Object.entries(query).every(([key, val]) => {
    if (val && typeof val === 'object' && '$exists' in val) return (object[key] !== undefined) === val.$exists;
    if (val && typeof val === 'object' && '$gt' in val) return object[key] > val.$gt;
    return String(object[key]) === String(val);
  });
  const imports = {
    '../../config': { clientUrl: 'https://example.test', node_env: 'production', ...options.config },
    '../../shared/catchAsync': fn => fn,
    '../../shared/sendResponse': (res, data) => { res.output = data; },
    '../../enum/user': { USER_ROLES: { USER: 'user' }, USER_STATUS: { ACTIVE: 'active' } },
    '../../errors/ApiError': class extends Error { constructor(status, message) { super(message); this.statusCode = status; } },
    '../map/map.model': { Map: { findById: async () => options.map === null ? null : ({ _id: mapId, status: 'Published', isActive: true, isPaid: true, price: 35, ...options.map }) } },
    '../user/user.model': { User: {
      findOne: async () => user,
      findById: async () => user,
      create: async data => {
        if (options.duplicateEmail) throw Object.assign(new Error('Duplicate'), { code: 11000 });
        calls.created.push(data); user = { _id: userId, ...data }; return user;
      },
    } },
    './guest-checkout.model': { GuestCheckout: {
      init: async () => {},
      findOne: async query => attempt && matches(attempt, query) ? attempt : null,
      create: async data => { attempt = { _id: 'attempt1', ...data, save: async () => {} }; return attempt; },
      findOneAndUpdate: async (_query, update) => {
        if (options.concurrentRedeem || attempt.redeemedAt) return null;
        Object.assign(attempt, update.$set); return attempt;
      },
    } },
    './payment.model': { Payment: { init: async () => {}, findOne: async () => options.missingPayment ? null : payment } },
    './payment.service': { PaymentServices: {
      createCheckoutSession: async (...args) => { calls.checkout.push(args); return { sessionId: 'cs_test', url: 'https://checkout.stripe.test' }; },
      verifyCheckoutSession: async id => { calls.fulfilled.push(id); },
    } },
    '../../config/stripe': { checkout: { sessions: { retrieve: async id => { calls.stripe.push(id); return session; } } } },
    '../auth/auth.helper': { AuthHelper: { createToken: (...args) => { calls.tokens.push(args); return { accessToken: 'access', refreshToken: 'refresh' }; } } },
  };
  imports['../../helpers/checkoutOrigin'] = load('src/helpers/checkoutOrigin.ts', {
    '../config': imports['../../config'], '../errors/ApiError': imports['../../errors/ApiError'],
  });
  const controller = load('src/modules/payment/guest-checkout.controller.ts', imports).GuestCheckoutController;
  const res = { cookie: (...args) => calls.cookies.push(args) };
  return { controller, calls, res, attempt: () => attempt, user: () => user };
}
const guestUser = { _id: userId, email: 'buyer@example.test', provider: 'guest_purchase', role: 'user', status: 'active', verified: false };
test('new guest purchase requires login without creating an account, attempt, payment or token', async () => {
  const f = fixture();
  await f.controller.start({ body: { email: ' Buyer@Example.Test ', mapId, checkoutToken: token, amount: 1 } }, f.res);
  assert.equal(f.res.output.data.loginRequired, true);
  assert.equal(f.calls.created.length, 0);
  assert.equal(f.calls.checkout.length, 0);
  assert.equal(f.calls.stripe.length, 0);
  assert.equal(f.attempt(), null);
  assert.equal(f.user(), null);
  assert.equal(f.calls.tokens.length, 0);
  assert.equal(f.calls.cookies.length, 0);
});
for (const user of [guestUser, { ...guestUser, provider: 'google' }, { ...guestUser, password: 'hash' }, { ...guestUser, status: 'deleted' }]) {
  test(`existing ${user.provider}/${user.status}/${!!user.password} account requires login, untouched`, async () => {
    const f = fixture({ user });
    await f.controller.start({ body: { email: user.email, mapId, checkoutToken: token } }, f.res);
    assert.equal(f.res.output.data.loginRequired, true);
    assert.equal(f.calls.created.length + f.calls.checkout.length + f.calls.tokens.length, 0);
  });
}
test('an old client with a new capability cannot start another guest purchase', async () => {
  const f = fixture({ user: guestUser, attempt: {} });
  await f.controller.start({ body: { email: guestUser.email, mapId, checkoutToken: 'd'.repeat(64) } }, f.res);
  assert.equal(f.res.output.data.loginRequired, true);
  assert.equal(f.calls.created.length + f.calls.checkout.length + f.calls.tokens.length, 0);
  assert.equal(f.attempt().tokenHash, tokenHash);
});
for (const change of [{ email: 'other@example.test' }, { mapId: 'd'.repeat(24) },
  { expiresAt: new Date(0) }, { redeemedAt: new Date() }]) {
  test(`legacy resume with mismatched or unavailable attempt (${Object.keys(change)[0]}) requires login`, async () => {
    const f = fixture({ user: guestUser, attempt: change });
    await f.controller.start({ body: { email: guestUser.email, mapId, checkoutToken: token } }, f.res);
    assert.equal(f.res.output.data.loginRequired, true);
    assert.equal(f.calls.created.length + f.calls.checkout.length + f.calls.tokens.length + f.calls.stripe.length, 0);
  });
}
test('cancelled checkout resumes the same Stripe session without another account or payment', async () => {
  const f = fixture({ user: guestUser, attempt: {}, session: { status: 'open', url: 'https://stripe.test/resume' } });
  await f.controller.start({ body: { email: guestUser.email, mapId, checkoutToken: token } }, f.res);
  assert.equal(f.res.output.data.url, 'https://stripe.test/resume');
  assert.equal(f.calls.created.length + f.calls.checkout.length, 0);
});
test('invalid map creates no account', async () => {
  const f = fixture({ map: null });
  await assert.rejects(f.controller.start({ body: { email: guestUser.email, mapId, checkoutToken: token } }, f.res));
  assert.equal(f.calls.created.length, 0);
});
for (const origin of ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
  test(`development checkout returns to its original browser origin: ${origin}`, async () => {
    const f = fixture({ user: guestUser, attempt: { sessionId: undefined, returnOrigin: origin }, config: { node_env: 'development' } });
    await f.controller.start({ headers: { origin }, body: { email: guestUser.email, mapId, checkoutToken: token } }, f.res);
    assert.equal(new URL(f.calls.checkout[0][1].successUrl).origin, origin);
    assert.equal(new URL(f.calls.checkout[0][1].cancelUrl).origin, origin);
    assert.equal(f.attempt().returnOrigin, origin);
  });
}
test('production backend permits an explicitly configured localhost frontend without redirecting it to production', async () => {
  const origin = 'http://localhost:3000';
  const f = fixture({ user: guestUser, attempt: { sessionId: undefined, returnOrigin: origin }, config: { cors_origins: [origin] } });
  await f.controller.start({ headers: { origin }, body: { email: guestUser.email, mapId, checkoutToken: token } }, f.res);
  assert.equal(new URL(f.calls.checkout[0][1].successUrl).origin, origin);
});
test('normal production checkout retains the production frontend origin', async () => {
  const origin = 'https://example.test';
  const f = fixture({ user: guestUser, attempt: { sessionId: undefined, returnOrigin: origin } });
  await f.controller.start({ headers: { origin }, body: { email: guestUser.email, mapId, checkoutToken: token,
    successUrl: 'https://evil.test', cancelUrl: 'https://evil.test' } }, f.res);
  assert.equal(new URL(f.calls.checkout[0][1].successUrl).origin, origin);
  assert.equal(new URL(f.calls.checkout[0][1].cancelUrl).origin, origin);
});
for (const origin of ['https://evil.test', 'https://example.test.evil.test', 'http://localhost:3000',
  'https://user:password@example.test', 'https://example.test/path', 'https://example.test?url=evil', 'null']) {
  test(`unapproved/malformed production origin cannot create an account or checkout: ${origin}`, async () => {
    const f = fixture();
    await assert.rejects(f.controller.start({ headers: { origin }, body: { email: guestUser.email, mapId, checkoutToken: token } }, f.res));
    assert.equal(f.calls.created.length + f.calls.checkout.length, 0);
  });
}
test('a completed legacy checkout can recover on localhost without another payment', async () => {
  const f = fixture({ user: guestUser, attempt: {}, config: { node_env: 'development' }, session: { status: 'complete', url: null } });
  await f.controller.start({ headers: { origin: 'http://localhost:3000' }, body: { email: guestUser.email, mapId, checkoutToken: token } }, f.res);
  assert.equal(new URL(f.res.output.data.url).origin, 'http://localhost:3000');
  assert.equal(new URL(f.res.output.data.url).searchParams.get('session_id'), 'cs_test');
  assert.equal(f.calls.checkout.length + f.calls.created.length, 0);
});
test('a checkout cannot be resumed or redeemed from another approved frontend origin', async () => {
  const f = fixture({ user: guestUser, attempt: { returnOrigin: 'http://localhost:3000' }, config: { node_env: 'development' } });
  const headers = { origin: 'https://example.test' };
  await assert.rejects(f.controller.start({ headers, body: { email: guestUser.email, mapId, checkoutToken: token } }, f.res), /where it was started/);
  await assert.rejects(f.controller.complete({ headers, body: { sessionId: 'cs_test', checkoutToken: token } }, f.res), /where checkout was started/);
  assert.equal(f.calls.tokens.length, 0);
});
for (const map of [{ status: 'Draft' }, { isActive: false }, { isPaid: false }, { price: 0 }, { price: -1 }]) {
  test(`unavailable map ${JSON.stringify(map)} cannot create an account or checkout`, async () => {
    const f = fixture({ map });
    await assert.rejects(f.controller.start({ body: { email: guestUser.email, mapId, checkoutToken: token } }, f.res));
    assert.equal(f.calls.created.length + f.calls.checkout.length, 0);
  });
}
test('paid checkout fulfils before issuing tokens; leaves email unverified; cookie is secure/httpOnly', async () => {
  const f = fixture({ user: guestUser, attempt: {} });
  await f.controller.complete({ body: { checkoutToken: token, sessionId: 'cs_test' } }, f.res);
  assert.deepEqual(f.calls.fulfilled, ['cs_test']);
  assert.equal(f.res.output.data.accessToken, 'access');
  assert.equal(f.user().verified, false);
  assert.equal(f.calls.cookies[0][2].secure, true);
  assert.equal(f.calls.cookies[0][2].httpOnly, true);
  assert.ok(f.attempt().redeemedAt);
  await assert.rejects(f.controller.complete({ body: { checkoutToken: token, sessionId: 'cs_test' } }, f.res));
  assert.equal(f.calls.tokens.length, 1);
});
for (const [label, options, body] of [
  ['wrong token', {}, { checkoutToken: 'd'.repeat(64) }],
  ['wrong session', {}, { sessionId: 'cs_other' }],
  ['expired', { attempt: { expiresAt: new Date(0) } }],
  ['already used', { attempt: { redeemedAt: new Date() } }],
  ['unpaid', { session: { payment_status: 'unpaid' } }],
  ['incomplete', { session: { status: 'open' } }],
  ['wrong amount', { session: { amount_total: 1 } }],
  ['wrong currency', { session: { currency: 'eur' } }],
  ['wrong owner', { session: { metadata: { userId: 'attacker', mapId } } }],
  ['wrong map', { session: { metadata: { userId, mapId: 'other' } } }],
  ['refunded', { payment: { status: 'refunded' } }],
  ['missing payment', { missingPayment: true }],
]) test(`${label}: no login granted`, async () => {
  const f = fixture({ user: guestUser, attempt: {}, ...options });
  await assert.rejects(f.controller.complete({ body: { checkoutToken: token, sessionId: 'cs_test', ...body } }, f.res));
  assert.equal(f.calls.tokens.length, 0);
});
for (const change of [{ password: 'new hash' }, { verified: true }, { appId: 'google' }, { status: 'inactive' }, { role: 'admin' }]) {
  test(`account changed during payment (${Object.keys(change)[0]}): purchase retained, login required`, async () => {
    const f = fixture({ user: { ...guestUser, ...change }, attempt: {} });
    await f.controller.complete({ body: { checkoutToken: token, sessionId: 'cs_test' } }, f.res);
    assert.equal(f.res.output.data.loginRequired, true);
    assert.equal(f.calls.tokens.length, 0);
  });
}
test('concurrent token redemption grants at most one login', async () => {
  const f = fixture({ user: guestUser, attempt: {}, concurrentRedeem: true });
  await f.controller.complete({ body: { checkoutToken: token, sessionId: 'cs_test' } }, f.res);
  assert.equal(f.res.output.data.loginRequired, true);
  assert.equal(f.calls.tokens.length, 0);
});
for (const [label, payload] of [['missing', {}], ['bad email', { email: 'bad' }], ['bad token', { checkoutToken: '123' }], ['bad map', { mapId: '../admin' }]]) {
  test(`invalid input (${label}) rejected before account creation`, async () => {
    const f = fixture();
    const body = label === 'missing' ? payload : { email: guestUser.email, mapId, checkoutToken: token, ...payload };
    await assert.rejects(f.controller.start({ body }, f.res));
    assert.equal(f.calls.created.length, 0);
  });
}

function serviceFixture(owned = false) {
  const calls = { stripe: [], writes: [] };
  const service = load('src/modules/payment/payment.service.ts', {
    './webhook.service': { WebhookService: {} },
    '../../config': { clientUrl: 'https://example.test' },
    '../../errors/ApiError': class extends Error { constructor(_status, message) { super(message); } },
    '../map/map.model': { Map: { findById: async () => ({ _id: mapId, isPaid: true, price: 35 }) } },
    '../user/user.model': { User: { findById: async () => ({ purchasedMaps: owned ? [mapId] : [] }) } },
    '../../helpers/localize': { localizeField: () => 'Map' },
    './payment.model': { Payment: {
      updateOne: async (...args) => calls.writes.push(args), create: async data => calls.writes.push(data),
    } },
    '../../config/stripe': { checkout: { sessions: { create: async (...args) => {
      calls.stripe.push(args);
      return { id: 'cs_test', url: 'https://stripe.test', amount_total: 3500, currency: 'usd', status: 'open' };
    } } } },
  }).PaymentServices;
  return { service, calls };
}
test('guest retries use the same Stripe key and payment upsert; trusted ownership overrides metadata', async () => {
  const f = serviceFixture();
  for (let i = 0; i < 2; i++) await f.service.createCheckoutSession({ authId: userId, email: guestUser.email },
    { mapId, metadata: { userId: 'attacker', mapId: 'wrong' } }, 'stable-key');
  assert.equal(f.calls.stripe[0][1].idempotencyKey, 'stable-key');
  assert.equal(f.calls.stripe[1][1].idempotencyKey, 'stable-key');
  assert.equal(f.calls.stripe[0][0].metadata.userId, userId);
  assert.equal(f.calls.stripe[0][0].metadata.mapId, mapId);
  assert.equal(f.calls.writes[0][0].guestCheckoutKey, 'stable-key');
  assert.equal(f.calls.writes[1][0].guestCheckoutKey, 'stable-key');
  assert.equal(f.calls.writes[0][1].$setOnInsert.amount, 35);
  assert.equal(f.calls.writes[0][2].upsert, true);
});
test('already purchased map rejected before authenticated Stripe checkout', async () => {
  const f = serviceFixture(true);
  await assert.rejects(f.service.createCheckoutSession({ authId: userId, email: guestUser.email }, { mapId }), /already own/);
  assert.equal(f.calls.stripe.length, 0);
});
test('regular authenticated checkout keeps normal payment creation', async () => {
  const f = serviceFixture();
  await f.service.createCheckoutSession({ authId: userId, email: guestUser.email }, { mapId });
  assert.equal(f.calls.stripe[0][1], undefined);
  assert.equal(f.calls.writes[0].userId, userId);
});

for (const [label, signature, secret, throws] of [
  ['invalid signature', 'invalid', 'configured', true],
  ['missing signature', undefined, 'configured', false],
  ['missing configuration', undefined, undefined, false],
]) test(`production webhook rejects ${label} without processing an event`, async () => {
  let processed = 0;
  const service = load('src/modules/payment/webhook.service.ts', {
    '../../config': { node_env: 'production', stripe: { paymentWebhookSecret: secret } },
    '../../errors/ApiError': class extends Error { constructor(_status, message) { super(message); } },
    './payment.model': { Payment: { startSession: () => { processed++; } } },
    '../../config/stripe': { webhooks: { constructEvent: () => { if (throws) throw new Error('signature mismatch'); } } },
  }).WebhookService;
  await assert.rejects(service.handleWebhook({ headers: { 'stripe-signature': signature },
    body: Buffer.from(JSON.stringify({ type: 'payment_intent.succeeded', data: { object: {} } })) }));
  assert.equal(processed, 0);
});
test('unpaid checkout completion event does not grant map access', async () => {
  let writes = 0;
  const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_test' } } };
  const service = load('src/modules/payment/webhook.service.ts', {
    '../../config': { node_env: 'production', stripe: { paymentWebhookSecret: 'configured' } },
    '../../errors/ApiError': class extends Error { constructor(_status, message) { super(message); } },
    './payment.model': { Payment: { startSession: () => { writes++; } } },
    '../../config/stripe': { webhooks: { constructEvent: () => event }, checkout: { sessions: { retrieve: async () => ({ payment_status: 'unpaid' }) } } },
  }).WebhookService;
  await service.handleWebhook({ headers: { 'stripe-signature': 'valid' }, body: Buffer.from('{}') });
  assert.equal(writes, 0);
});

for (const claim of ['authId', 'userId']) test(`refresh preserves account ID for ${claim} tokens`, async () => {
  let subject;
  const service = load('src/modules/auth/custom.auth/custom.auth.service.ts', {
    '../../../enum/user': { USER_STATUS: { ACTIVE: 'active' } },
    '../../user/user.model': { User: { findById: async () => ({ status: 'active', role: 'user' }) } },
    '../../../config': { jwt: { jwt_refresh_secret: 'test' } },
    '../../../helpers/jwtHelper': { jwtHelper: { verifyToken: () => ({ [claim]: userId, role: 'user' }) } },
    '../auth.helper': { AuthHelper: { createToken: id => { subject = id; return { accessToken: 'refreshed' }; } } },
  }).CustomAuthServices;
  const result = await service.getRefreshToken('refresh');
  assert.equal(subject, userId);
  assert.equal(result.accessToken, 'refreshed');
});

test('Google claim verifies only the new guest account and retires its purchase capability', async () => {
  const writes = [];
  const service = load('src/modules/auth/passport.auth/passport.auth.service.ts', {
    '../../../enum/user': { USER_STATUS: { ACTIVE: 'active' } },
    '../../user/user.model': { User: { findOne: async () => guestUser, findByIdAndUpdate: async (...args) => writes.push(args) } },
    '../auth.helper': { AuthHelper: { createToken: () => ({ accessToken: 'google-access', refreshToken: 'refresh' }) } },
    '../common': { authResponse: (...args) => args },
  }).PassportAuthServices;
  await service.handleGoogleLogin({ profile: { emails: [{ value: guestUser.email }], photos: [], id: 'google-id' } });
  assert.equal(writes[0][1].$set.verified, true);
  assert.equal(writes[0][1].$set.appId, 'google-id');
});

test('legacy checkout returns remain public while other protected routes retain their guard', () => {
  const { middleware } = load(path.join(frontendRoot, 'middleware.ts'), {
    'next/server': { NextResponse: { next: () => 'allowed', redirect: url => url } },
  });
  const request = pathname => ({ nextUrl: new URL(`https://example.test${pathname}`), url: `https://example.test${pathname}`, cookies: { get: () => undefined } });
  assert.equal(middleware(request('/catalog/checkout?mapId=' + mapId)), 'allowed');
  assert.equal(middleware(request('/set-password?email=buyer@example.test')), 'allowed');
  for (const route of ['/profile', '/saved-routes', '/route-planner']) {
    assert.equal(middleware(request(route)).searchParams.get('loginRequired'), '1');
  }
  assert.equal(middleware(request('/dashboard')).pathname, '/login');
});

for (const type of ['checkout.session.expired', 'payment_intent.payment_failed', 'payment_intent.succeeded']) {
  for (const status of ['succeeded', 'refunded']) {
    test(`${type} preserves ${status} payment on a repeated/out-of-order event`, async () => {
      let saves = 0;
      const payment = { status, save: async () => saves++ };
      const transaction = { startTransaction() {}, commitTransaction: async () => {}, abortTransaction: async () => {}, endSession() {} };
      const event = { type, data: { object: { id: 'pi_test' } } };
      const service = load('src/modules/payment/webhook.service.ts', {
        '../../config': { node_env: 'production', stripe: { paymentWebhookSecret: 'configured' } },
        './payment.model': { Payment: { startSession: async () => transaction, findOne: () => ({ session: async () => payment }) } },
        '../../config/stripe': { webhooks: { constructEvent: () => event } },
      }).WebhookService;
      await service.handleWebhook({ headers: { 'stripe-signature': 'valid' }, body: Buffer.from('{}') });
      assert.equal(payment.status, status);
      assert.equal(saves, 0);
    });
  }
}
