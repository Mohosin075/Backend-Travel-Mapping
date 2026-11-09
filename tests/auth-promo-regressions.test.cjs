const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const userId = 'a'.repeat(24), mapId = 'b'.repeat(24), otherId = 'c'.repeat(24);
const clone = value => value == null ? value : structuredClone(value);
const get = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
function matches(object, query) {
  return !!object && Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(q => matches(object, q));
    if (key === '$and') return value.every(q => matches(object, q));
    const actual = get(object, key);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$gt' in value) return actual > value.$gt;
      if ('$lte' in value) return actual <= value.$lte;
      if ('$ne' in value) return actual !== value.$ne;
      if ('$nin' in value) return !value.$nin.includes(actual);
      if ('$in' in value) return value.$in.includes(actual);
    }
    return value == null ? actual == null : String(actual) === String(value);
  });
}
function update(object, changes) {
  const setters = Object.keys(changes).some(key => key.startsWith('$')) ? changes.$set || {} : changes;
  for (const [key, value] of Object.entries(setters)) {
    const parts = key.split('.');
    const last = parts.pop();
    const target = parts.reduce((value, part) => value[part] ||= {}, object);
    target[last] = clone(value);
  }
  for (const key of Object.keys(changes.$unset || {})) delete object[key];
  for (const [key, value] of Object.entries(changes.$addToSet || {})) {
    object[key] ||= [];
    if (!object[key].some(id => String(id) === String(value))) object[key].push(String(value));
  }
  return object;
}
function query(value) {
  const result = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const name of ['select', 'lean', 'sort', 'session', 'populate']) result[name] = () => result;
  return result;
}
class ApiError extends Error { constructor(status, message) { super(message); this.statusCode = status; } }
const enums = { USER_STATUS: { ACTIVE: 'active', INACTIVE: 'inactive', DELETED: 'deleted' }, USER_ROLES: { USER: 'user' } };
function load(file, imports) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, require: name => imports[name] || (name.startsWith('.') ? {} : require(name)),
    console: { log() {}, error() {}, warn() {} }, Date, Buffer, URL, process: { env: { NODE_ENV: 'production' } } });
  return module.exports;
}
function promoFixture(options = {}) {
  const state = {
    user: options.user === null ? null : { _id: userId, email: 'buyer@example.test', status: 'active', verified: true, purchasedMaps: [], ...options.user },
    promo: options.promo === null ? null : { code: 'PROMO', mapId, price: 0, isUsed: false, recipientEmail: 'buyer@example.test', ...options.promo },
    payments: [], sessions: new Map(), keys: new Map(), stripeCalls: [], updates: [], verified: [], failWrite: options.failWrite,
  };
  const doc = () => state.promo ? { ...clone(state.promo), toObject: () => clone(state.promo) } : null;
  const imports = {
    crypto, '../../enum/user': enums, '../../errors/ApiError': ApiError,
    '../../config': { clientUrl: 'https://example.test' }, '../../helpers/localize': { localizeField: () => 'Map' },
    mongoose: { Types: { ObjectId: class { constructor(id) { return new String(id); } static isValid(id) { return /^[a-f\d]{24}$/i.test(id); } } } },
    '../map/map.model': { Map: { findById: () => query(options.missingMap ? null : { _id: mapId, name: 'Map', status: 'Published', isPaid: true, isActive: true, ...options.map }) } },
    '../user/user.model': { User: {
      findById: async () => clone(state.user),
      findOneAndUpdate: async (filter, changes, opts) => {
        state.updates.push({ filter, changes, opts });
        if (options.failGrant) throw new Error('database interrupted');
        if (!matches(state.user, filter)) return null;
        return update(state.user, changes);
      },
    } },
    './promo.model': { PromoLink: {
      findOne: filter => query(matches(state.promo, filter) ? doc() : null),
      findOneAndUpdate: (filter, changes) => {
        if (!matches(state.promo, filter)) return query(null);
        update(state.promo, changes); return query(doc());
      },
      updateOne: async (filter, changes) => { if (matches(state.promo, filter)) update(state.promo, changes); },
      startSession: async () => ({
        withTransaction: async fn => {
          const before = { promo: clone(state.promo), user: clone(state.user) };
          try { return await fn(); } catch (error) { Object.assign(state, before); throw error; }
        }, endSession: async () => {},
      }),
    } },
    '../payment/payment.model': { Payment: {
      init: async () => {},
      findOne: filter => query(state.payments.find(row => matches(row, filter)) || null),
      updateOne: async (filter, changes) => {
        if (state.failWrite) { state.failWrite = false; throw new Error('payment write interrupted'); }
        if (!state.payments.some(row => matches(row, filter))) state.payments.push(clone(changes.$setOnInsert));
      },
    } },
    '../../config/stripe': { checkout: { sessions: {
      create: async (request, options) => {
        state.stripeCalls.push({ request, options });
        if (state.keys.has(options.idempotencyKey)) return state.sessions.get(state.keys.get(options.idempotencyKey));
        const id = `cs_test_${state.keys.size + 1}`;
        const session = { id, url: `https://stripe.test/${id}`, payment_status: 'unpaid', status: 'open' };
        state.keys.set(options.idempotencyKey, id); state.sessions.set(id, session); return session;
      },
      retrieve: async id => state.sessions.get(id),
      expire: async id => { state.sessions.get(id).status = 'expired'; },
    } } },
    '../payment/payment.service': { PaymentServices: { verifyCheckoutSession: async id => {
      state.verified.push(id);
      const payment = state.payments.find(row => row.metadata.checkoutSessionId === id);
      const session = state.sessions.get(id);
      if (payment && session?.payment_status === 'paid') { payment.status = 'succeeded'; state.promo.isUsed = true; }
      return payment || { status: 'pending' };
    } } },
  };
  return { state, service: load('src/modules/promo/promo.service.ts', imports).PromoServices };
}
test('free targeted promo grants exactly once to a verified recipient', async () => {
  const f = promoFixture();
  await f.service.claimFreePromo(userId, 'PROMO');
  assert.equal(f.state.promo.isUsed, true);
  assert.deepEqual(f.state.user.purchasedMaps, [mapId]);
  await assert.rejects(f.service.claimFreePromo(userId, 'PROMO'), /already been used/);
  assert.equal(f.state.updates.length, 1);
  assert.ok(f.state.updates[0].opts.session);
});
test('free promo grant failure rolls back consumption so it can be retried', async () => {
  const f = promoFixture({ failGrant: true });
  await assert.rejects(f.service.claimFreePromo(userId, 'PROMO'), /interrupted/);
  assert.equal(f.state.promo.isUsed, false);
  assert.deepEqual(f.state.user.purchasedMaps, []);
});
for (const method of ['claimFreePromo', 'createPromoCheckoutSession']) {
  for (const [label, options] of [
    ['wrong recipient', { user: { email: 'other@example.test' } }],
    ['guest email not verified', { user: { verified: false, provider: 'guest_purchase' } }],
    ['inactive', { user: { status: 'inactive' } }],
    ['deleted', { user: { status: 'deleted' } }],
    ['missing user', { user: null }],
    ['expired', { promo: { expiresAt: new Date(0) } }],
    ['used', { promo: { isUsed: true } }],
    ['invalid code', { promo: null }],
  ]) test(`${method}: ${label} grants no access and creates no charge`, async () => {
    const f = promoFixture({ ...options, ...(method === 'createPromoCheckoutSession' && options.promo ? { promo: options.promo && { price: 5, ...options.promo } } : {}) });
    await assert.rejects(f.service[method](method === 'claimFreePromo' ? userId : { authId: userId }, 'PROMO'));
    assert.equal(f.state.updates.length + f.state.stripeCalls.length, 0);
  });
}
test('public free promo remains usable by a signed-in guest account', async () => {
  const f = promoFixture({ user: { verified: false }, promo: { recipientEmail: null } });
  await f.service.claimFreePromo(userId, 'PROMO');
  assert.equal(f.state.user.purchasedMaps[0], mapId);
});
test('paid promo charges the server discount and database email, retaining its promo metadata', async () => {
  const f = promoFixture({ promo: { price: 5 } });
  await f.service.createPromoCheckoutSession({ authId: userId, email: 'wrong-jwt@example.test', amount: 1 }, 'PROMO');
  const { request } = f.state.stripeCalls[0];
  assert.equal(request.line_items[0].price_data.unit_amount, 500);
  assert.equal(request.customer_email, 'buyer@example.test');
  assert.equal(request.metadata.promoCode, 'PROMO');
  assert.match(request.success_url, /session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.equal(f.state.payments[0].amount, 5);
});
test('cancelled promo checkout resumes the existing session with one order', async () => {
  const f = promoFixture({ promo: { price: 5 } });
  const first = await f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO');
  const second = await f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO');
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(f.state.stripeCalls.length, 1);
  assert.equal(f.state.payments.length, 1);
});
test('payment write failure retries with the same Stripe key/session and one saved order', async () => {
  const f = promoFixture({ promo: { price: 5 }, failWrite: true });
  await assert.rejects(f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO'), /interrupted/);
  await f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO');
  assert.equal(f.state.stripeCalls[0].options.idempotencyKey, f.state.stripeCalls[1].options.idempotencyKey);
  assert.equal(f.state.sessions.size, 1);
  assert.equal(f.state.payments.length, 1);
});
test('a second user cannot create another checkout for a reserved public promo', async () => {
  const f = promoFixture({ promo: { price: 5, recipientEmail: null } });
  await f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO');
  f.state.user._id = otherId;
  await assert.rejects(f.service.createPromoCheckoutSession({ authId: otherId }, 'PROMO'), /already in checkout/);
  assert.equal(f.state.sessions.size, 1);
});
test('a paid session is fulfilled on retry rather than charging again', async () => {
  const f = promoFixture({ promo: { price: 5 } });
  const checkout = await f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO');
  f.state.sessions.get(checkout.sessionId).payment_status = 'paid';
  await assert.rejects(f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO'), /already been paid/);
  assert.deepEqual(f.state.verified, [checkout.sessionId]);
  assert.equal(f.state.sessions.size, 1);
});
test('an already owned map is not charged again or allowed to consume a paid promo', async () => {
  const f = promoFixture({ user: { purchasedMaps: [mapId] }, promo: { price: 5 } });
  await assert.rejects(f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO'), /already own/);
  assert.equal(f.state.stripeCalls.length, 0);
  assert.equal(f.state.promo.isUsed, false);
});
test('payment success query alone cannot verify unpaid, refunded, wrong-user or wrong-code promos', async () => {
  const f = promoFixture({ promo: { price: 5 } });
  const checkout = await f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO');
  await assert.rejects(f.service.verifyPromoPayment(userId, 'PROMO', checkout.sessionId), /not completed/);
  f.state.sessions.get(checkout.sessionId).payment_status = 'paid';
  await assert.rejects(f.service.verifyPromoPayment(otherId, 'PROMO', checkout.sessionId), /No payment/);
  await assert.rejects(f.service.verifyPromoPayment(userId, 'OTHER', checkout.sessionId), /No payment/);
  await assert.rejects(f.service.verifyPromoPayment(userId, 'PROMO', 'cs_other'), /No payment/);
  const result = await f.service.verifyPromoPayment(userId, 'PROMO', checkout.sessionId);
  assert.equal(result.mapId, mapId);
  f.state.payments[0].status = 'refunded';
  await assert.rejects(f.service.verifyPromoPayment(userId, 'PROMO', checkout.sessionId), /No payment/);
});
test('legacy paid return URLs without a session ID still require a real payment for that user and code', async () => {
  const f = promoFixture({ promo: { price: 5 } });
  const checkout = await f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO');
  f.state.sessions.get(checkout.sessionId).payment_status = 'paid';
  assert.equal((await f.service.verifyPromoPayment(userId, 'PROMO')).mapId, mapId);
});
for (const price of [0, 5]) test(`generic ${price ? 'paid' : 'free'} promo uses the selected map`, async () => {
  const f = promoFixture({ promo: { mapId: null, recipientEmail: null, price } });
  await f.service[price ? 'createPromoCheckoutSession' : 'claimFreePromo'](price ? { authId: userId } : userId, 'PROMO', mapId);
  assert.equal(String(price ? f.state.payments[0].mapId : f.state.user.purchasedMaps[0]), mapId);
});
test('invalid selected map is rejected without consuming a generic promo', async () => {
  const f = promoFixture({ promo: { mapId: null } });
  await assert.rejects(f.service.claimFreePromo(userId, 'PROMO', 'invalid'), /Invalid map/);
  assert.equal(f.state.promo.isUsed, false);
});
test('bound promo cannot be redirected to a different map by client input', async () => {
  const f = promoFixture();
  await f.service.claimFreePromo(userId, 'PROMO', otherId);
  assert.deepEqual(f.state.user.purchasedMaps, [mapId]);
});
test('already-owned free map does not consume the promo', async () => {
  const f = promoFixture({ user: { purchasedMaps: [mapId] } });
  await assert.rejects(f.service.claimFreePromo(userId, 'PROMO'), /already own/);
  assert.equal(f.state.promo.isUsed, false);
});
test('expired reservation closes the prior unpaid checkout before allowing a new one', async () => {
  const f = promoFixture({ promo: { price: 5, recipientEmail: null } });
  const first = await f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO');
  f.state.promo.checkoutExpiresAt = new Date(0);
  f.state.user._id = otherId;
  const second = await f.service.createPromoCheckoutSession({ authId: otherId }, 'PROMO');
  assert.equal(f.state.sessions.get(first.sessionId).status, 'expired');
  assert.notEqual(first.sessionId, second.sessionId);
});
test('simultaneous paid promo requests share one chargeable session and order', async () => {
  const f = promoFixture({ promo: { price: 5 } });
  const results = await Promise.all([f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO'), f.service.createPromoCheckoutSession({ authId: userId }, 'PROMO')]);
  assert.equal(results[0].sessionId, results[1].sessionId);
  assert.equal(f.state.sessions.size, 1);
  assert.equal(f.state.payments.length, 1);
});

function authFixture(options = {}) {
  const state = { user: { _id: userId, email: 'buyer@example.test', role: 'user', name: 'Buyer', status: 'active',
    password: 'hash', verified: false, authentication: { oneTimeCode: '123456', expiresAt: new Date(Date.now() + 60000),
      authType: 'createAccount', wrongLoginAttempts: 0, requestCount: 0 }, ...options.user }, tokens: [], resets: [], emails: [] };
  const userModel = {
    findOne: () => query(clone(state.user)), findById: () => query(clone(state.user)),
    findByIdAndUpdate: async (_id, changes) => clone(update(state.user, changes)),
    findOneAndUpdate: async (filter, changes) => matches(state.user, filter) ? clone(update(state.user, changes)) : null,
    isPasswordMatched: async password => password === 'correctpass',
  };
  const helpers = { createToken: (...args) => { state.tokens.push(args); return { accessToken: 'access', refreshToken: 'refresh' }; } };
  const response = (status, message, role, accessToken, refreshToken, token, needPassword) => ({ status, message, role, accessToken, refreshToken, token, needPassword });
  const email = { sendEmail: async data => state.emails.push(data) };
  const templates = { createAccount: value => value, userInvitation: value => value, resetPassword: value => value };
  const common = load('src/modules/auth/common.ts', {
    '../../enum/user': enums, '../user/user.model': { User: userModel }, './auth.helper': { AuthHelper: helpers },
    '../../errors/ApiError': ApiError, '../../utils/crypto': { generateOtp: () => '654321' },
    '../../shared/emailTemplate': { emailTemplate: templates }, '../../helpers/emailHelper': { emailHelper: email },
  });
  const custom = load('src/modules/auth/custom.auth/custom.auth.service.ts', {
    '../../../enum/user': enums, '../../user/user.model': { User: userModel }, '../auth.helper': { AuthHelper: helpers },
    '../../../errors/ApiError': ApiError, '../../../config': { bcrypt_salt_rounds: '10', jwt: { jwt_refresh_secret: 'test' } },
    '../common': { authResponse: response, AuthCommonServices: common.AuthCommonServices },
    '../../../helpers/jwtHelper': { jwtHelper: { verifyToken: () => ({ authId: userId, role: 'admin' }) } },
    '../../../utils/crypto': Object.assign(() => 'reset-token', { generateOtp: () => '654321' }),
    '../../../shared/emailTemplate': { emailTemplate: templates }, '../../../helpers/emailHelper': { emailHelper: email },
    bcrypt: { hash: async password => `hashed:${password}` },
    '../../token/token.model': { Token: {
      create: async data => { state.resets.push(data); return data; },
      findOne: filter => query(state.resets.find(token => token.token === filter.token)),
      findOneAndDelete: async filter => { const index = state.resets.findIndex(token => matches(token, filter)); return index < 0 ? null : state.resets.splice(index, 1)[0]; },
      deleteOne: async filter => { state.resets = state.resets.filter(token => token.token !== filter.token); },
    } },
  }).CustomAuthServices;
  return { state, service: custom, common: common.AuthCommonServices };
}
test('ordinary signup OTP logs in once; replay cannot mint a password-reset token', async () => {
  const f = authFixture();
  assert.equal((await f.service.verifyAccount('buyer@example.test', '123456')).accessToken, 'access');
  assert.equal(f.state.user.verified, true);
  await assert.rejects(f.service.verifyAccount('buyer@example.test', '123456'), /No active code/);
  assert.equal(f.state.tokens.length, 1);
  assert.equal(f.state.resets.length, 0);
});
for (const password of [undefined, 'existing-hash']) test(`unverified account password recovery (${password ? 'existing password' : 'guest'}) issues reset token, then sets password`, async () => {
  const f = authFixture({ user: { password } });
  await f.service.forgetPassword('buyer@example.test');
  assert.equal(f.state.emails[0].isSetup, !password);
  const verified = await f.service.verifyAccount('buyer@example.test', '654321');
  assert.equal(verified.accessToken, undefined);
  assert.equal(verified.token, 'reset-token');
  await f.service.resetPassword(verified.token, { newPassword: 'new-password', confirmPassword: 'new-password' });
  assert.equal(f.state.user.verified, true);
  assert.equal(f.state.user.password, 'hashed:new-password');
  await assert.rejects(f.service.resetPassword(verified.token, { newPassword: 'again', confirmPassword: 'again' }));
});
test('passwordless invitation OTP retains its first-password setup flow', async () => {
  const f = authFixture({ user: { password: undefined } });
  const result = await f.service.verifyAccount('buyer@example.test', '123456');
  assert.equal(result.needPassword, true);
  assert.equal(result.token, 'reset-token');
  assert.equal(result.accessToken, undefined);
});
for (const [label, options, code] of [
  ['wrong', {}, '654321'], ['expired', { expiresAt: new Date(0) }, '123456'],
  ['missing expiration', { expiresAt: undefined }, '123456'],
]) test(`${label} OTP cannot log in or set a password`, async () => {
  const f = authFixture(); Object.assign(f.state.user.authentication, options);
  await assert.rejects(f.service.verifyAccount('buyer@example.test', code));
  assert.equal(f.state.tokens.length + f.state.resets.length, 0);
});
test('verified old user uses normal password login and preserves profile/role', async () => {
  const f = authFixture({ user: { verified: true, role: 'admin' } });
  const result = await f.common.handleLoginLogic({ password: 'correctpass', email: f.state.user.email }, clone(f.state.user));
  assert.equal(result.accessToken, 'access');
  assert.equal(f.state.tokens[0][1], 'admin');
  assert.equal(f.state.user.password, 'hash');
});
test('incorrect password issues no tokens and increments login attempts', async () => {
  const f = authFixture({ user: { verified: true } });
  await assert.rejects(f.common.handleLoginLogic({ password: 'wrongpass' }, clone(f.state.user)), /Incorrect password/);
  assert.equal(f.state.tokens.length, 0);
  assert.equal(f.state.user.authentication.wrongLoginAttempts, 1);
});
test('unverified login sends OTP without granting access', async () => {
  const f = authFixture();
  const result = await f.common.handleLoginLogic({ password: 'correctpass', email: f.state.user.email }, clone(f.state.user));
  assert.equal(result.accessToken, undefined);
  assert.equal(f.state.emails.length, 1);
});
for (const password of ['random-input', 'another-wrong-password']) test(`passwordless guest login (${password}) issues no authentication or automatic OTP`, async () => {
  const f = authFixture({ user: { provider: 'guest_purchase', password: undefined } });
  const result = await f.common.handleLoginLogic({ email: f.state.user.email, password }, clone(f.state.user));
  assert.equal(result.passwordSetupRequired, true);
  assert.equal(result.accessToken, undefined);
  assert.equal(result.refreshToken, undefined);
  assert.equal(f.state.tokens.length + f.state.emails.length, 0);
});
test('unverified password account cannot obtain an OTP redirect with an incorrect password', async () => {
  const f = authFixture();
  await assert.rejects(f.common.handleLoginLogic({ email: f.state.user.email, password: 'wrongpass' }, clone(f.state.user)), /Incorrect password/);
  assert.equal(f.state.tokens.length + f.state.emails.length, 0);
});
test('legacy passwordless invitation keeps its email-verification flow', async () => {
  const f = authFixture({ user: { password: undefined } });
  const result = await f.common.handleLoginLogic({ email: f.state.user.email, password: 'unused' }, clone(f.state.user));
  assert.equal(result.needPassword, true);
  assert.equal(result.passwordSetupRequired, undefined);
  assert.equal(f.state.emails.length, 1);
  assert.equal(f.state.tokens.length, 0);
});
test('returning buyer without a password verifies email, sets a password and logs into the same purchased maps', async () => {
  const f = authFixture({ user: { provider: 'guest_purchase', password: undefined, purchasedMaps: [mapId] } });
  const first = await f.common.handleLoginLogic({ email: f.state.user.email, password: 'arbitrary' }, clone(f.state.user));
  assert.equal(first.passwordSetupRequired, true);
  assert.equal(f.state.tokens.length, 0);
  await f.service.forgetPassword(f.state.user.email);
  const verified = await f.service.verifyAccount(f.state.user.email, '654321');
  await f.service.resetPassword(verified.token, { newPassword: 'correctpass', confirmPassword: 'correctpass' });
  const login = await f.common.handleLoginLogic({ email: f.state.user.email, password: 'correctpass' }, clone(f.state.user));
  assert.equal(login.accessToken, 'access');
  assert.equal(login.passwordSetupRequired, undefined);
  assert.deepEqual(f.state.user.purchasedMaps, [mapId]);
  assert.equal(f.state.user._id, userId);
});
for (const status of ['inactive', 'deleted']) test(`${status} account cannot refresh tokens`, async () => {
  const f = authFixture({ user: { status } });
  await assert.rejects(f.service.getRefreshToken('refresh'));
  assert.equal(f.state.tokens.length, 0);
});
test('refresh uses the current database role rather than a stale privileged token role', async () => {
  const f = authFixture();
  await f.service.getRefreshToken('refresh');
  assert.equal(f.state.tokens[0][1], 'user');
});
test('concurrent OTP submissions issue only one login', async () => {
  const f = authFixture();
  const results = await Promise.allSettled([f.service.verifyAccount('buyer@example.test', '123456'), f.service.verifyAccount('buyer@example.test', '123456')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.state.tokens.length, 1);
});
test('concurrent password resets can consume a reset token only once', async () => {
  const f = authFixture({ user: { password: undefined } });
  await f.service.forgetPassword('buyer@example.test');
  const verified = await f.service.verifyAccount('buyer@example.test', '654321');
  const results = await Promise.allSettled([
    f.service.resetPassword(verified.token, { newPassword: 'first-password', confirmPassword: 'first-password' }),
    f.service.resetPassword(verified.token, { newPassword: 'second-password', confirmPassword: 'second-password' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
});

test('password login forwards email and remember-me and sets a cross-site secure cookie', async () => {
  const cookies = [], payloads = [];
  const controller = load('src/modules/auth/passport.auth/passport.auth.controller.ts', {
    '../../../config': { node_env: 'production' }, '../../../shared/catchAsync': fn => fn,
    '../../../shared/sendResponse': () => {}, '../common': { AuthCommonServices: { handleLoginLogic: async payload => {
      payloads.push(payload); return { status: 200, accessToken: 'access', refreshToken: 'refresh' };
    } } },
  }).PassportAuthController;
  await controller.login({ user: { email: 'buyer@example.test' }, body: { password: 'password', rememberMe: true } }, { cookie: (...args) => cookies.push(args) });
  assert.equal(payloads[0].email, 'buyer@example.test');
  assert.equal(payloads[0].rememberMe, true);
  assert.equal(cookies[0][2].sameSite, 'none');
  assert.equal(cookies[0][2].httpOnly, true);
  assert.equal(cookies[0][2].secure, true);
});
test('logout clears the refresh cookie with matching production scope', async () => {
  let cleared;
  const controller = load('src/modules/auth/custom.auth/custom.auth.controller.ts', {
    '../../../shared/catchAsync': fn => fn, '../../../shared/sendResponse': () => {},
    '../../token/token.service': { TokenServices: { logout: async () => ({}) } },
  }).CustomAuthController;
  await controller.logout({ user: { authId: userId } }, { clearCookie: (...args) => { cleared = args; } });
  assert.equal(cleared[0], 'refreshToken');
  assert.equal(cleared[1].path, '/');
  assert.equal(cleared[1].sameSite, 'none');
  assert.equal(cleared[1].secure, true);
});
test('OTP-only custom login does not overwrite an existing refresh cookie with undefined', async () => {
  const cookies = [];
  const controller = load('src/modules/auth/custom.auth/custom.auth.controller.ts', {
    '../../../shared/catchAsync': fn => fn, '../../../shared/sendResponse': () => {},
    './custom.auth.service': { CustomAuthServices: { customLogin: async () => ({ status: 200 }) } },
  }).CustomAuthController;
  await controller.customLogin({ body: {} }, { cookie: (...args) => cookies.push(args) });
  assert.equal(cookies.length, 0);
});

function fulfillmentFixture(options = {}) {
  const state = { status: options.status || 'pending', maps: [], used: false, receipts: 0, commits: 0, aborts: 0 };
  let staged;
  const payment = { userId: { _id: userId, email: 'buyer@example.test', name: 'Buyer' }, mapId,
    amount: 5, currency: 'USD', userEmail: 'buyer@example.test', metadata: { promoCode: 'PROMO', checkoutSessionId: 'cs_test' },
    get status() { return state.status; }, set status(value) { staged.status = value; },
    save: async () => {}, populate: async () => payment };
  const transaction = { startTransaction: () => { staged = { status: state.status, maps: [...state.maps], used: state.used }; },
    commitTransaction: async () => { Object.assign(state, staged); state.commits++; },
    abortTransaction: async () => { state.aborts++; }, endSession() {} };
  const imports = {
    '../../config': { clientUrl: 'https://example.test', node_env: 'production', stripe: { paymentWebhookSecret: 'test' } },
    '../../errors/ApiError': ApiError,
    './payment.model': { Payment: { findOne: () => query(payment), startSession: async () => transaction } },
    '../user/user.model': { User: { findByIdAndUpdate: async () => { if (!staged.maps.includes(mapId)) staged.maps.push(mapId); return {}; } } },
    '../promo/promo.model': { PromoLink: { findOneAndUpdate: async () => {
      if (options.claimedByOther) return null;
      staged.used = true; return {};
    } } },
    '../../helpers/emailHelper': { emailHelper: { sendEmail: async () => { state.receipts++; if (options.failReceipt) throw new Error('Email down'); } } },
    '../../config/stripe': { checkout: { sessions: { retrieve: async () => ({ id: 'cs_test', payment_status: 'paid', payment_intent: 'pi_test', metadata: { promoCode: 'PROMO', mapId, userId } }) } },
      webhooks: { constructEvent: () => ({ type: 'checkout.session.completed', data: { object: { id: 'cs_test' } } }) } },
    './webhook.service': { WebhookService: {} },
  };
  return { state, payment: load('src/modules/payment/payment.service.ts', imports).PaymentServices,
    webhook: load('src/modules/payment/webhook.service.ts', imports).WebhookService };
}
test('actual promo fulfilment grants map and consumes promo once when browser returns before webhook', async () => {
  const f = fulfillmentFixture();
  await f.payment.verifyCheckoutSession('cs_test');
  assert.equal(f.state.status, 'succeeded');
  assert.equal(f.state.used, true);
  assert.deepEqual(f.state.maps, [mapId]);
  await f.webhook.handleWebhook({ headers: { 'stripe-signature': 'valid' }, body: Buffer.from('{}') });
  assert.deepEqual(f.state.maps, [mapId]);
  assert.equal(f.state.receipts, 1);
});
test('actual promo fulfilment is idempotent when webhook arrives before browser verification', async () => {
  const f = fulfillmentFixture();
  await f.webhook.handleWebhook({ headers: { 'stripe-signature': 'valid' }, body: Buffer.from('{}') });
  await f.payment.verifyCheckoutSession('cs_test');
  assert.equal(f.state.used, true);
  assert.deepEqual(f.state.maps, [mapId]);
  assert.equal(f.state.receipts, 1);
});
test('promo claimed by another account aborts the entire fulfilment without losing the payment record', async () => {
  const f = fulfillmentFixture({ claimedByOther: true });
  await assert.rejects(f.payment.verifyCheckoutSession('cs_test'), /another account/);
  assert.equal(f.state.status, 'pending');
  assert.deepEqual(f.state.maps, []);
  assert.equal(f.state.aborts, 1);
});
test('receipt email failure cannot roll back a successful promo payment and map entitlement', async () => {
  const f = fulfillmentFixture({ failReceipt: true });
  await f.payment.verifyCheckoutSession('cs_test');
  assert.equal(f.state.status, 'succeeded');
  assert.deepEqual(f.state.maps, [mapId]);
  assert.equal(f.state.aborts, 0);
});
for (const password of [undefined, 'existing-password-hash']) test(`existing Google login preserves ${password ? 'password account' : 'Google-only account'} and its role`, async () => {
  let writes = 0, subject;
  const user = { _id: userId, email: 'buyer@example.test', status: 'active', verified: true, role: 'admin', password };
  const service = load('src/modules/auth/passport.auth/passport.auth.service.ts', {
    '../../../enum/user': enums, '../../../errors/ApiError': ApiError,
    '../../user/user.model': { User: { findOne: async () => user, findByIdAndUpdate: async () => writes++ } },
    '../auth.helper': { AuthHelper: { createToken: (...args) => { subject = args; return { accessToken: 'access' }; } } },
    '../common': { authResponse: (_status, _message, role, accessToken) => ({ role, accessToken }) },
  }).PassportAuthServices;
  const result = await service.handleGoogleLogin({ profile: { emails: [{ value: user.email }], id: 'google' } });
  assert.equal(result.accessToken, 'access');
  assert.equal(result.role, 'admin');
  assert.equal(subject[0], userId);
  assert.equal(user.password, password);
  assert.equal(writes, 0);
});
test('inactive Google account cannot bypass its status by social login or create a replacement account', async () => {
  let created = 0, issued = 0;
  const service = load('src/modules/auth/passport.auth/passport.auth.service.ts', {
    '../../../enum/user': enums, '../../../errors/ApiError': ApiError,
    '../../user/user.model': { User: { findOne: async () => ({ status: 'inactive' }), create: async () => created++ } },
    '../auth.helper': { AuthHelper: { createToken: () => issued++ } },
  }).PassportAuthServices;
  await assert.rejects(service.handleGoogleLogin({ profile: { emails: [{ value: 'buyer@example.test' }], id: 'google' } }), /not active/);
  assert.equal(created + issued, 0);
});
