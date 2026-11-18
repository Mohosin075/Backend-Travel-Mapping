const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const front = process.env.GIOVAFILM_FRONTEND_DIR || path.resolve(__dirname, '../../giovafilm_mapping');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

function fixture(handler) {
  const calls = [], actions = [];
  const imports = {
    '@reduxjs/toolkit/query/react': {
      fetchBaseQuery: () => async (args, api) => {
        const url = typeof args === 'string' ? args : args.url;
        const call = { url, token: api.getState().auth.accessToken, api }; calls.push(call);
        return handler(call);
      },
      createApi: options => options,
    },
    '../features/auth/authSlice': { logout: () => ({ type: 'logout' }), setAccessToken: payload => ({ type: 'token', payload }) },
    '@/lib/config': { env: { NEXT_PUBLIC_BASEURL: 'https://example.test/api' } },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(front, 'redux/api/baseApi.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module, exports: module.exports, require: name => imports[name] || {} });
  function store(id = 'first') {
    const state = { auth: { user: { id, email: id + '@example.test' }, accessToken: 'expired' } };
    const api = { getState: () => state, dispatch(action) {
      actions.push({ id, ...action });
      if (action.type === 'token') state.auth.accessToken = action.payload;
      if (action.type === 'logout') state.auth = { accessToken: null, user: null };
    } };
    return { state, api, query: url => module.exports.baseApi.baseQuery(url, api, {}) };
  }
  return { store, calls, actions };
}

test('one hundred expired requests share a single refresh and each retry once', async () => {
  const gate = deferred();
  const f = fixture(async call => call.url === '/auth/refresh-token'
    ? (await gate.promise, { data: { success: true, data: { accessToken: 'renewed' } } })
    : call.token === 'renewed' ? { data: { ok: true } } : { error: { status: 401 } });
  const s = f.store(); const requests = Array.from({ length: 100 }, (_, i) => s.query('/resource/' + i));
  await tick();
  assert.equal(f.calls.filter(c => c.url === '/auth/refresh-token').length, 1);
  gate.resolve();
  assert.ok((await Promise.all(requests)).every(r => r.data?.ok));
  assert.equal(f.calls.length, 201);
  assert.equal(f.actions.filter(a => a.type === 'token').length, 1);
});

test('a late 401 reuses an already-refreshed token instead of refreshing again', async () => {
  const gate = deferred();
  const f = fixture(async call => {
    if (call.url === '/auth/refresh-token') return { data: { success: true, data: { accessToken: 'renewed' } } };
    if (call.url === '/slow' && call.token === 'expired') await gate.promise;
    return call.token === 'renewed' ? { data: { ok: true } } : { error: { status: 401 } };
  });
  const s = f.store(); const slow = s.query('/slow');
  await s.query('/fast'); gate.resolve();
  assert.equal((await slow).data.ok, true);
  assert.equal(f.calls.filter(c => c.url === '/auth/refresh-token').length, 1);
});

test('a late 401 cannot replay an old mutation after the same customer signs in again', async () => {
  const gate = deferred();
  const f = fixture(async () => { await gate.promise; return { error: { status: 401 } }; });
  const s = f.store(); const oldRequest = s.query('/purchase');
  s.state.auth = { user: { id: 'first' }, accessToken: 'new-login-token' };
  gate.resolve();
  await oldRequest;
  assert.equal(f.calls.length, 1);
  assert.equal(f.actions.length, 0);
});

for (const status of [429, 500, 503, 'FETCH_ERROR', 'TIMEOUT_ERROR']) {
  test(`temporary refresh failure ${status} does not sign out the customer`, async () => {
    const f = fixture(async call => ({ error: { status: call.url === '/auth/refresh-token' ? status : 401 } }));
    const s = f.store(); const result = await s.query('/resource');
    assert.equal(result.error.status, status);
    assert.equal(s.state.auth.accessToken, 'expired');
    assert.equal(f.actions.length, 0);
  });
}

for (const status of [401, 403]) {
  test(`confirmed refresh rejection ${status} still logs out`, async () => {
    const f = fixture(async call => ({ error: { status: call.url === '/auth/refresh-token' ? status : 401 } }));
    const s = f.store(); await s.query('/resource');
    assert.equal(s.state.auth.accessToken, null);
    assert.equal(f.actions.filter(a => a.type === 'logout').length, 1);
  });
}

for (const change of ['logout', 'switch', 'same-account-new-login']) {
  test(`a pending refresh cannot overwrite ${change} or replay its old mutation`, async () => {
    const gate = deferred();
    const f = fixture(async call => call.url === '/auth/refresh-token'
      ? (await gate.promise, { data: { success: true, data: { accessToken: 'stale-renewal' } } }) : { error: { status: 401 } });
    const s = f.store(); const result = s.query('/purchase'); await tick();
    s.state.auth = change === 'logout' ? { user: null, accessToken: null }
      : { user: { id: change === 'switch' ? 'second' : 'first' }, accessToken: 'new-login-token' };
    gate.resolve(); await result;
    assert.equal(f.actions.length, 0);
    assert.equal(s.state.auth.accessToken, change === 'logout' ? null : 'new-login-token');
    assert.equal(f.calls.filter(c => c.url === '/purchase').length, 1);
  });
}

test('different Redux stores never share credentials or their refresh tasks', async () => {
  const gate = deferred();
  const f = fixture(async call => call.url === '/auth/refresh-token'
    ? (await gate.promise, { data: { success: true, data: { accessToken: call.api.getState().auth.user.id + '-token' } } })
    : call.token === 'expired' ? { error: { status: 401 } } : { data: { ok: true } });
  const a = f.store('first'), b = f.store('second');
  const requests = [a.query('/private'), b.query('/private')]; await tick();
  assert.equal(f.calls.filter(c => c.url === '/auth/refresh-token').length, 2);
  gate.resolve(); await Promise.all(requests);
  assert.equal(a.state.auth.accessToken, 'first-token');
  assert.equal(b.state.auth.accessToken, 'second-token');
});

test('a rejected retried request cannot enter an infinite refresh loop', async () => {
  const f = fixture(async call => call.url === '/auth/refresh-token'
    ? { data: { success: true, data: { accessToken: 'renewed' } } } : { error: { status: 401 } });
  const result = await f.store().query('/resource');
  assert.equal(result.error.status, 401);
  assert.equal(f.calls.length, 3);
});

test('a non-authentication error never triggers refresh', async () => {
  const f = fixture(async () => ({ error: { status: 400 } }));
  assert.equal((await f.store().query('/resource')).error.status, 400);
  assert.equal(f.calls.length, 1);
});

test('notification polling cancels its interval on visibility changes and cleans up its listener', () => {
  let state, effect;
  const listeners = new Set();
  const document = { hidden: true, addEventListener: (_name, listener) => listeners.add(listener), removeEventListener: (_name, listener) => listeners.delete(listener) };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(front, 'hooks/use-visible-polling-interval.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module, exports: module.exports, document,
    require: () => ({ useState: initial => { state ??= initial; return [state, value => { state = value; }]; }, useEffect: fn => { effect = fn; } }),
  });
  assert.equal(module.exports.useVisiblePollingInterval(30000), 30000);
  const cleanup = effect();
  assert.equal(state, 0, 'a page initially hidden must also pause polling');
  document.hidden = false; for (const listener of listeners) listener();
  assert.equal(state, 30000);
  document.hidden = true; for (const listener of listeners) listener();
  assert.equal(state, 0);
  cleanup(); assert.equal(listeners.size, 0);
});
