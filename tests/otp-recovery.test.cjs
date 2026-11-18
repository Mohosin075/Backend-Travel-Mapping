const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const express = require('express');

function load(file, imports = {}, globals = {}) {
  const m = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.isAbsolute(file) ? file : path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { module: m, exports: m.exports, require: name => imports[name] || require(name), console, process, Date, URL, ...globals });
  return m.exports;
}

test('real auth routes isolate accounts and keep sending limits separate from verification', async () => {
  const limits = load('src/middleware/rateLimit.ts');
  const pass = (_req, _res, next) => next();
  const controllers = new Proxy({}, { get: (_, name) => (req, res) => res.status(name === 'verifyAccount' && !req.body.valid ? 400 : 200).json({ handler: name }) });
  const router = load('src/modules/auth/auth.route.ts', {
    passport: { authenticate: () => pass },
    './passport.auth/passport.auth.controller': { PassportAuthController: controllers },
    './custom.auth/custom.auth.controller': { CustomAuthController: controllers },
    '../../middleware/validateRequest': () => pass,
    './auth.validation': { AuthValidations: {} },
    '../../enum/user': { USER_ROLES: {} },
    '../../middleware/auth': () => pass,
    '../../middleware/rateLimit': limits,
  }).AuthRoutes;
  const app = express(); app.set('trust proxy', 1); app.use(express.json()); app.use('/auth', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const request = (route, email, valid = false, ip = '192.0.2.1') => fetch(`http://127.0.0.1:${server.address().port}/auth/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ email, valid }),
  });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await request(i % 2 ? 'resend-otp' : 'forget-password', 'first@example.test')).status, 200);
    const blockedSend = await request('resend-otp', ' FIRST@EXAMPLE.TEST ');
    assert.equal(blockedSend.status, 429);
    assert.ok((await blockedSend.json()).retryAfter > 0);
    assert.equal((await request('resend-otp', 'second@example.test')).status, 200);
    assert.equal((await request('verify-account', 'first@example.test', true)).status, 200);
    for (let i = 0; i < 10; i++) assert.equal((await request('verify-account', 'guesses@example.test')).status, 400);
    assert.equal((await request('verify-account', ' GUESSES@example.test ', true, '192.0.2.2')).status, 429);
    assert.equal((await request('verify-account', 'second@example.test', true)).status, 200);
    assert.equal((await request('resend-otp', 'guesses@example.test')).status, 200);
    for (let i = 0; i < 12; i++) assert.equal((await request('verify-account', 'success@example.test', true)).status, 200);
    for (let i = 0; i < 100; i++) assert.equal((await request('verify-account', `bulk${i}@example.test`, true, '203.0.113.1')).status, 200);
    assert.equal((await request('verify-account', 'another@example.test', true, '203.0.113.1')).status, 429);
  } finally {
    server.close(); server.closeAllConnections();
    for (const limiter of Object.values(limits)) limiter.resetKey?.('unused');
  }
});

test('old resend budget resets after fifteen minutes; recent budget is retained', () => {
  const { getOtpRequestCount } = load('src/modules/auth/otp-request-count.ts');
  const now = Date.now();
  assert.equal(getOtpRequestCount({ requestCount: 5, latestRequestAt: new Date(now - 900000) }, now), 0);
  assert.equal(getOtpRequestCount({ requestCount: 5, latestRequestAt: new Date(now - 899999) }, now), 5);
  assert.equal(getOtpRequestCount({ requestCount: 5 }, now), 0);
  assert.equal(getOtpRequestCount(undefined, now), 0);
});

test('client error reports validate payloads and redact secrets before server logging', () => {
  const logs = [];
  const reporter = load('src/modules/auth/client-error-report.ts', {}, { console: { error: line => logs.push(JSON.parse(line)) } });
  const text = reporter.redactClientError('code=123456 at https://example.test/app.js?token=secret person@example.test Bearer abcdefghijklmnopqrstuvwxyz012345678901234567890');
  assert.doesNotMatch(text, /123456|token=|person@|Bearer|abcdefghijkl/);
  assert.match(text, /https:\/\/example.test\/app.js/);
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  reporter.reportClientError({ body: { pathname: '/otp-verify?otp=123456' } }, response);
  assert.equal(response.code, 400);
  assert.equal(logs.length, 0);
  reporter.reportClientError({ body: { name: 'NotFoundError', message: 'The object can not be found here.', stack: 'at https://example.test/app.js?token=secret', pathname: '/otp-verify' } }, response);
  assert.equal(response.code, 202);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].pathname, '/otp-verify');
  assert.equal(logs[0].event, 'client_error');
  assert.doesNotMatch(JSON.stringify(logs[0]), /token=secret/);
  assert.equal(response.body.id, logs[0].id);
});

test('browser crash reporting excludes account URLs and credentials and tolerates network failures', async () => {
  const calls = [];
  const reporter = load(path.resolve(__dirname, '../../giovafilm_mapping/lib/report-client-error.ts'), {
    '@/lib/config': { env: { NEXT_PUBLIC_BASEURL: 'https://example.test/api/' } },
  }, {
    window: { location: { pathname: '/otp-verify', search: '?email=private@example.test&otp=123456' } },
    fetch: async (url, options) => { calls.push({ url, options }); throw new Error('offline'); },
  });
  assert.doesNotThrow(() => reporter.reportClientError(Object.assign(new Error('Code 123456 failure at https://example.test/otp-verify?email=private@example.test&otp=123456'), { stack: 'at https://example.test/app.js?token=secret' })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].url, 'https://example.test/api/api/v1/client-errors');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.doesNotMatch(calls[0].options.body, /private@|123456|token=secret/);
  assert.equal(JSON.parse(calls[0].options.body).pathname, '/otp-verify');
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test('resend service cooldown reaches the production HTTP response with a Retry-After header', () => {
  const ApiError = load('src/errors/ApiError.ts').default;
  const handler = load('src/middleware/globalErrorHandler.ts', {
    '../config': { node_env: 'production' },
    '../errors/ApiError': ApiError,
    '../errors/handleZodError': () => {}, '../errors/handleCastError': () => {}, '../errors/handleValidationError': () => {},
    '../helpers/translateMessage': { translateMessage: message => message },
  }).default;
  const headers = {};
  const response = { setHeader(name, value) { headers[name] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  handler(Object.assign(new ApiError(429, 'Try later'), { retryAfter: 45 }), { lang: 'en' }, response, () => {});
  assert.equal(response.code, 429);
  assert.equal(headers['Retry-After'], '45');
  assert.equal(response.body.retryAfter, 45);
  assert.equal(response.body.stack, undefined);
});
