const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, imports = {}, source) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source ?? fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, Date, Buffer, console: { log() {}, error() {} },
    require: name => name === '../../helpers/stripePaymentTotals' ? totals : imports[name] || {} });
  return module.exports;
}
const totals = load('src/helpers/stripePaymentTotals.ts');
const baseline = file => require('node:child_process').execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true });
class ApiError extends Error { constructor(status, message) { super(message); this.statusCode = status; } }
const mapId = 'a'.repeat(24), userId = 'b'.repeat(24);
const paidSession = (tax = 315, country = 'US') => ({ id: 'cs_tax', payment_status: 'paid',
  payment_intent: 'pi_tax', currency: 'usd', amount_subtotal: 3500, amount_total: 3500 + tax,
  total_details: { amount_tax: tax, amount_discount: 0 }, automatic_tax: { enabled: true, status: 'complete' },
  customer_details: { address: { country } }, metadata: { userId, mapId } });
const query = value => { const q = { then: (yes, no) => Promise.resolve(value).then(yes, no) };
  for (const key of ['populate', 'session', 'sort', 'select']) q[key] = () => q; return q; };

function fixture({ enabled = true, status = 'pending', session = paidSession(), source, checkoutKey, catalogPrice = 35 } = {}) {
  const state = { grants: 0, receipts: 0, checkouts: [], created: [], upserts: [], refunds: [], commits: 0, aborts: 0 };
  const payment = { _id: 'c'.repeat(24), userId, mapId, amount: 35, currency: 'USD', status,
    userEmail: 'buyer@example.test', paymentIntentId: 'cs_tax', metadata: { checkoutSessionId: 'cs_tax' }, save: async () => {} };
  payment.populate = async () => payment;
  payment.guestCheckoutKey = checkoutKey;
  let event;
  const transaction = { startTransaction() {}, commitTransaction: async () => state.commits++,
    abortTransaction: async () => state.aborts++, endSession() {} };
  const imports = {
    '../../config': { clientUrl: 'https://example.test', node_env: 'production', stripe: {
      automaticTaxEnabled: enabled, taxCode: 'txcd_test', paymentWebhookSecret: 'whsec_test' } },
    '../../errors/ApiError': ApiError,
    'http-status-codes': { StatusCodes: { CONFLICT: 409, BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500 } },
    mongoose: { Types: { ObjectId: { isValid: () => true } } },
    '../../helpers/localize': { localizeField: () => 'Map' },
    '../map/map.model': { Map: { findById: async () => ({ _id: mapId, isPaid: true, price: catalogPrice }) } },
    '../user/user.model': { User: { findById: async () => ({ purchasedMaps: [] }), findByIdAndUpdate: async (_id, change) => {
      if (change.$addToSet?.purchasedMaps) state.grants++; return {};
    } } },
    '../../helpers/emailHelper': { emailHelper: { sendEmail: async () => state.receipts++ } },
    './payment.model': { Payment: { findOne: filter => query(filter.guestCheckoutKey && filter.guestCheckoutKey !== payment.guestCheckoutKey ? null : payment), findById: async () => payment,
      startSession: async () => transaction, create: async data => state.created.push(data),
      updateOne: async (_filter, change) => state.upserts.push(change),
      findByIdAndUpdate: (_id, change) => { Object.assign(payment, change); return query(payment); } } },
    '../../config/stripe': {
      checkout: { sessions: { retrieve: async () => session, create: async (...args) => {
        state.checkouts.push(args); return { id: 'cs_tax', status: 'open', url: 'https://stripe.test', amount_total: 3500,
          amount_subtotal: 3500, currency: 'usd', automatic_tax: args[0].automatic_tax || { enabled: false } };
      } } },
      refunds: { create: async args => { state.refunds.push(args); return { id: 're_tax', amount: 3815 }; } },
      webhooks: { constructEvent: () => event },
    },
    './webhook.service': { WebhookService: {} },
  };
  const service = load('src/modules/payment/payment.service.ts', imports, source).PaymentServices;
  const webhook = load('src/modules/payment/webhook.service.ts', imports).WebhookService;
  return { state, payment, service, emit: async (type, object) => {
    event = { type, data: { object } };
    return webhook.handleWebhook({ headers: { 'stripe-signature': 'test' }, body: Buffer.from('{}') });
  } };
}

test('tax-enabled map checkout collects an address and adds tax to the server price', async () => {
  const f = fixture();
  await f.service.createCheckoutSession({ authId: userId, email: 'buyer@example.test' }, { mapId, amount: 1, currency: 'eur' });
  const request = f.state.checkouts[0][0];
  assert.equal(request.automatic_tax.enabled, true);
  assert.equal(request.billing_address_collection, 'required');
  assert.equal(request.line_items[0].price_data.unit_amount, 3500);
  assert.equal(request.line_items[0].price_data.tax_behavior, 'exclusive');
  assert.equal(request.line_items[0].price_data.product_data.tax_code, 'txcd_test');
  assert.equal(f.state.created[0].amount, 35, 'a pending order does not invent tax before the address is collected');
});
test('direct PaymentIntent cannot bypass address-based tax when collection is enabled', async () => {
  const f = fixture();
  await assert.rejects(f.service.createPaymentIntent({ authId: userId }, { mapId }),
    error => error.statusCode === 400 && /billing address/.test(error.message));
  assert.equal(f.state.created.length, 0);
});
test('tax-disabled checkout matches the original Stripe request and order contract', async () => {
  const old = fixture({ enabled: false, source: baseline('src/modules/payment/payment.service.ts') });
  const current = fixture({ enabled: false });
  for (const f of [old, current]) await f.service.createCheckoutSession({ authId: userId, email: 'buyer@example.test' }, { mapId });
  assert.equal(JSON.stringify(current.state.checkouts), JSON.stringify(old.state.checkouts));
  assert.equal(JSON.stringify(current.state.created), JSON.stringify(old.state.created));
});
test('saved guest checkout keeps its existing quote after price and tax configuration changes', async () => {
  const session = { ...paidSession(0), status: 'open', payment_status: 'unpaid', automatic_tax: { enabled: false }, url: 'https://stripe.test/old' };
  const f = fixture({ catalogPrice: 99, checkoutKey: 'old-key', session });
  const result = await f.service.createCheckoutSession({ authId: userId, email: 'buyer@example.test' }, { mapId }, 'old-key');
  assert.equal(f.state.checkouts.length, 0, 'do not issue a new Stripe creation request with changed parameters');
  assert.equal(result.url, session.url);
  assert.equal(f.state.upserts[0].$setOnInsert.amount, 35);
});
test('completed guest retry returns to the original success URL instead of creating a charge', async () => {
  const f = fixture({ checkoutKey: 'paid-key' });
  const result = await f.service.createCheckoutSession({ authId: userId }, { mapId, successUrl: 'https://example.test/return?session_id={CHECKOUT_SESSION_ID}' }, 'paid-key');
  assert.equal(result.url, 'https://example.test/return?session_id=cs_tax');
  assert.equal(f.state.checkouts.length, 0);
  assert.equal(f.state.upserts[0].$setOnInsert.subtotalAmount, 35);
  assert.equal(f.state.upserts[0].$setOnInsert.amount, 38.15);
});
for (const [tax, country] of [[315, 'US'], [700, 'GB'], [0, 'US']]) test(`Stripe tax ${tax} cents for ${country} is saved without a hardcoded rate`, () => {
  const payment = { amount: 35, currency: 'USD' };
  totals.applyStripeCheckoutTotals(payment, paidSession(tax, country));
  assert.equal(payment.amount, (3500 + tax) / 100);
  assert.equal(payment.subtotalAmount, 35);
  assert.equal(payment.taxAmount, tax / 100);
  assert.equal(payment.taxCountry, country);
});
test('Stripe discounts and actual tax are stored separately from the final charge', () => {
  const payment = { amount: 35, currency: 'USD' };
  const session = { ...paidSession(270), amount_total: 3270, total_details: { amount_discount: 500, amount_tax: 270 } };
  totals.applyStripeCheckoutTotals(payment, session);
  assert.equal(payment.amount, 32.70); assert.equal(payment.discountAmount, 5); assert.equal(payment.subtotalAmount, 35);
});
test('missing tax location or incomplete calculation cannot fulfil a paid order', async () => {
  const session = { ...paidSession(), automatic_tax: { enabled: true, status: 'requires_location_inputs' } };
  const f = fixture({ session });
  await assert.rejects(f.service.verifyCheckoutSession('cs_tax'), /tax calculation/);
  assert.equal(f.payment.status, 'pending'); assert.equal(f.state.grants, 0);
});
test('unpaid tax checkout does not grant map access', async () => {
  const f = fixture({ session: { ...paidSession(), payment_status: 'unpaid' } });
  await f.emit('checkout.session.completed', { id: 'cs_tax' });
  assert.equal(f.state.grants, 0); assert.equal(f.payment.status, 'pending');
});
for (const first of ['intent', 'checkout', 'browser']) test(`tax totals and map access remain consistent when ${first} completes first`, async () => {
  const f = fixture();
  const intent = () => f.emit('payment_intent.succeeded', { id: 'pi_tax', currency: 'usd', amount: 3815, amount_received: 3815, metadata: { userId, mapId } });
  const checkout = () => f.emit('checkout.session.completed', { id: 'cs_tax' });
  const browser = () => f.service.verifyCheckoutSession('cs_tax');
  await ({ intent, checkout, browser })[first]();
  await checkout(); await browser(); await intent();
  assert.equal(f.payment.amount, 38.15); assert.equal(f.payment.taxAmount, 3.15);
  assert.equal(f.payment.paymentIntentId, 'pi_tax');
  assert.equal(f.state.grants, 1); assert.equal(f.state.receipts, 1);
});
test('refunded order cannot be reactivated by a later checkout or intent event', async () => {
  const f = fixture({ status: 'refunded' });
  await f.emit('checkout.session.completed', { id: 'cs_tax' });
  await f.emit('payment_intent.succeeded', { id: 'pi_tax', amount_received: 3815 });
  assert.equal(f.payment.status, 'refunded'); assert.equal(f.state.grants, 0);
});
test('full refund resolves a legacy session and refunds the actual Stripe charge including tax', async () => {
  const f = fixture({ status: 'succeeded' });
  await f.service.refundPayment(f.payment._id, 'customer request');
  assert.equal(f.state.refunds[0].payment_intent, 'pi_tax');
  assert.equal(f.state.refunds[0].amount, undefined);
  assert.equal(f.payment.refundAmount, 38.15);
});

function subscriptionFixture(enabled, source) {
  const requests = [];
  class Stripe { constructor() {
    this.checkout = { sessions: { create: async args => { requests.push(args); return { id: 'cs_sub' }; } } };
    this.prices = { create: async args => { requests.push(args); return { id: 'price_new' }; } };
    this.subscriptions = { create: async args => { requests.push(args); return { id: 'sub_new' }; } };
  } }
  const service = load('src/modules/subscription/stripe.service.ts', {
    stripe: Stripe, '../../config': { stripe: { stripeSecretKey: 'sk_test_mock', automaticTaxEnabled: enabled } },
    '../../errors/ApiError': ApiError, 'http-status-codes': { StatusCodes: { BAD_REQUEST: 400 } },
  }, source).stripeService;
  return { service, requests };
}
test('new hosted subscription collects and saves customer billing address for automatic tax', async () => {
  const f = subscriptionFixture(true);
  await f.service.createCheckoutSession({ customerId: 'cus_test', priceId: 'price_test', trialPeriodDays: 10,
    successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel', metadata: { businessId: 'business' } });
  const request = f.requests[0];
  assert.equal(request.automatic_tax.enabled, true); assert.equal(request.customer_update.address, 'auto');
  assert.equal(request.mode, 'subscription'); assert.equal(request.subscription_data.trial_period_days, 10);
});
test('direct subscription creation cannot bypass tax-enabled hosted checkout', async () => {
  const f = subscriptionFixture(true);
  await assert.rejects(f.service.createSubscription({ customerId: 'cus_test', priceId: 'price_test' }),
    error => error.statusCode === 400 && /Checkout/.test(error.message));
  assert.equal(f.requests.length, 0);
});
test('tax-disabled subscription preserves its original Checkout Session contract', async () => {
  const old = subscriptionFixture(false, baseline('src/modules/subscription/stripe.service.ts'));
  const current = subscriptionFixture(false);
  const params = { customerId: 'cus_test', priceId: 'price_test', successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel' };
  await old.service.createCheckoutSession(params); await current.service.createCheckoutSession(params);
  assert.equal(JSON.stringify(current.requests), JSON.stringify(old.requests));
});
test('tax-disabled direct subscription creation retains its existing payment and trial behavior', async () => {
  const old = subscriptionFixture(false, baseline('src/modules/subscription/stripe.service.ts'));
  const current = subscriptionFixture(false);
  const params = { customerId: 'cus_test', priceId: 'price_test', trialPeriodDays: 10, paymentMethodId: 'pm_test' };
  await old.service.createSubscription(params); await current.service.createSubscription(params);
  assert.equal(JSON.stringify(current.requests), JSON.stringify(old.requests));
});
test('new subscription prices explicitly exclude tax when tax collection is enabled', async () => {
  const f = subscriptionFixture(true);
  await f.service.createPrice({ productId: 'prod_test', unitAmount: 1500, currency: 'usd', interval: 'month' });
  assert.equal(f.requests[0].tax_behavior, 'exclusive');
});
