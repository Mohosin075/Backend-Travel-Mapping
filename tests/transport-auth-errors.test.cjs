const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const back = path.resolve(__dirname, '..');
const front = path.resolve(back, '../frontend_giovafilm_roadtripeado');
function load(root, file, imports = {}, globals = {}, source) {
  const module = { exports: {} };
  const output = ts.transpileModule(source ?? fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, Error, URL, Buffer,
    console: { error() {}, warn() {}, log() {} }, ...globals,
    require: name => Object.hasOwn(imports, name) ? imports[name] : require(name),
  });
  return module.exports;
}

const endpoints = load(front, 'lib/api-endpoints.ts');
for (const [base, socket] of [
  ['https://example.test', '/socket.io'],
  ['https://example.test/api/', '/api/socket.io'],
  ['https://example.test/api/v1/', '/socket.io'],
  ['https://example.test/api/api/v1', '/api/socket.io'],
]) test(`socket endpoint preserves proxy routing for ${base}`, () => {
  const result = endpoints.getApiEndpoints(base);
  assert.equal(result.socketOrigin, 'https://example.test');
  assert.equal(result.socketPath, socket);
});

test('socket client sends its handshake to the API proxy prefix', () => {
  let connection;
  const socket = { on() {} };
  const module = load(front, 'lib/socket.ts', {
    '@/lib/config': { env: { NEXT_PUBLIC_BASEURL: 'https://example.test/api' } },
    '@/lib/api-endpoints': endpoints,
    'socket.io-client': { io: (origin, options) => { connection = { origin, options }; return socket; } },
  }, { window: {}, document: { cookie: '' } });
  assert.equal(module.getSocket(), socket);
  assert.equal(connection.origin, 'https://example.test');
  assert.equal(connection.options.path, '/api/socket.io');
});

const middleware = load(front, 'middleware.ts', {
  'next/server': { NextResponse: { next: () => ({ next: true }), redirect: url => ({ redirect: url.toString() }) } },
}).middleware;
for (const route of ['/api/socket.io/?EIO=4', '/socket.io/?EIO=4']) {
  test(`guest transport request ${route} is never redirected to login`, () => {
    const url = new URL(route, 'https://example.test');
    assert.equal(middleware({ nextUrl: url, url: url.href, cookies: { get: () => undefined } }).next, true);
  });
}
test('guest dashboard still redirects to login', () => {
  const url = new URL('https://example.test/dashboard');
  assert.match(middleware({ nextUrl: url, url: url.href, cookies: { get: () => undefined } }).redirect, /\/login\?redirect=/);
});

class ApiError extends Error {}
const translator = load(back, 'src/helpers/translateMessage.ts');
test('web login finds a deleted account so the shared login service can report its real status', async () => {
  const strategies = [];
  const deleted = { email: 'buyer@example.test', status: 'deleted' };
  const passport = { use: strategy => strategies.push(strategy), serializeUser() {}, deserializeUser() {} };
  class Strategy { constructor(options, callback) { this.callback = callback; } }
  load(back, 'src/modules/auth/passport.auth/config/passport.ts', {
    passport,
    'passport-local': { Strategy }, 'passport-google-oauth20': { Strategy },
    '../../../user/user.model': { User: { findOne: filter => ({ select: () => ({ lean: async () =>
      filter.email === deleted.email && filter.status.$in.includes(deleted.status) ? deleted : null }) }) } },
    '../../../../enum/user': { USER_ROLES: { USER: 'user' }, USER_STATUS: { ACTIVE: 'active', INACTIVE: 'inactive', DELETED: 'deleted' } },
    '../../../../config': { google: {} }, '../../../../errors/ApiError': ApiError,
  });
  const result = await new Promise((resolve, reject) => strategies[0].callback({}, ' BUYER@EXAMPLE.TEST ', 'password123',
    (error, user) => error ? reject(error) : resolve(user)));
  assert.equal(result.status, 'deleted');
});

const errors = load(back, 'src/middleware/globalErrorHandler.ts', {
  '../config': { node_env: 'production' },
  '../errors/handleZodError': {}, '../errors/handleCastError': {}, '../errors/handleValidationError': {},
  '../errors/ApiError': ApiError, '../helpers/translateMessage': translator,
}).default;
for (const lang of ['en', 'es']) test(`duplicate email race produces a localized 409 without raw database details (${lang})`, () => {
  let status, body;
  const response = { status: code => { status = code; return response; }, json: data => { body = data; } };
  errors(Object.assign(new Error('E11000 duplicate collection users secret@example.test'), {
    code: 11000, keyPattern: { email: 1 }, keyValue: { email: 'secret@example.test' },
  }), { lang }, response, () => {});
  assert.equal(status, 409);
  assert.equal(body.success, false);
  assert.equal(body.errorMessages[0].path, 'email');
  assert.match(body.message, lang === 'en' ? /already exists/ : /Ya existe/);
  assert.doesNotMatch(JSON.stringify(body), /E11000|collection|secret@example/);
});



const baselineFront = file => require('node:child_process').execFileSync('git', ['show', `HEAD:${file}`], { cwd: front, encoding: 'utf8', windowsHide: true });
const originalMiddleware = load(front, 'middleware.ts', {
  'next/server': { NextResponse: { next: () => ({ next: true }), redirect: url => ({ redirect: url.toString() }) } },
}, {}, baselineFront('middleware.ts')).middleware;
for (const identity of [null, 'user', 'admin', 'map_editor']) {
  for (const pathname of ['/', '/login', '/register', '/catalog/checkout?mapId=test', '/claim-promo?code=PROMO', '/profile', '/maps', '/dashboard', '/dashboard/users-roles', '/apiary', '/api/expand-url', '/api/api/v1/auth/signup']) {
    test(`production compatibility: ${identity || 'guest'} route ${pathname} retains its redirect and role guard`, () => {
      const url = new URL(pathname, 'https://example.test');
      const request = { nextUrl: url, url: url.href, cookies: { get: key =>
        identity && (key === 'userRole' || key === 'loggedIn') ? { value: key === 'userRole' ? identity : '1' } : undefined } };
      assert.equal(JSON.stringify(middleware(request)), JSON.stringify(originalMiddleware(request)));
    });
  }
}

function favouriteUI(token, type, rows, source) {
  const state = { queries: [], mutations: [], routes: [], messages: [] };
  const jsx = (type, props) => ({ type, props });
  const { FavouriteButton } = load(front, 'components/shared/favourite-button.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/redux/features/favourite/favouriteApi': {
      useGetFavouritesQuery: (_args, options) => { state.queries.push(options); return { data: { data: rows }, currentData: { data: rows } }; },
      useAddToFavouriteMutation: () => [payload => { state.mutations.push(payload); return { unwrap: async () => ({ success: true }) }; }, { isLoading: false }],
    },
    '@/lib/types/favourite': {}, 'lucide-react': { Heart: 'heart' },
    'next/navigation': { useRouter: () => ({ push: url => state.routes.push(url) }) },
    '@/redux/hook': { useAppSelector: selector => selector({ auth: { accessToken: token } }) },
    sonner: { toast: { error: message => state.messages.push(message), success: message => state.messages.push(message) } },
    '@/lib/utils': { getApiErrorMessage: error => error.message },
    '@/lib/i18n/LanguageContext': { useLanguage: () => ({ t: key => key }) },
  }, { window: { location: { pathname: '/catalog/map-id' } } }, source);
  return { state, button: FavouriteButton({ placeId: 'target', type }) };
}
test('guest favourites skip the protected read and still lead to login when clicked', async () => {
  const f = favouriteUI(null, 'Map', []);
  assert.equal(f.state.queries[0].skip, true);
  await f.button.props.onClick();
  assert.equal(f.state.mutations.length, 0);
  assert.equal(f.state.routes[0], '/login?redirect=%2Fcatalog%2Fmap-id');
});
const originalFavourite = baselineFront('components/shared/favourite-button.tsx');
for (const type of ['Map', 'Place', 'Offer', 'Business']) for (const existing of [false, true]) {
  test(`production compatibility: signed-in ${type} favourite ${existing ? 'remove' : 'add'} retains its payload and UI outcome`, async () => {
    const rows = existing ? [{ type, [type.toLowerCase()]: { _id: 'target' } }] : [];
    const old = favouriteUI('token', type, rows, originalFavourite);
    const current = favouriteUI('token', type, rows);
    await old.button.props.onClick(); await current.button.props.onClick();
    assert.equal(current.state.queries[0].skip, false);
    for (const key of ['mutations', 'routes', 'messages']) assert.equal(JSON.stringify(current.state[key]), JSON.stringify(old.state[key]));
  });
}
