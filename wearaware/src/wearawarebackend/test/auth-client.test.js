const { test } = require('node:test');
const assert = require('node:assert/strict');
const client = import('../../utils/auth-session.js');

function fixture() {
  const values = new Map([['token', 'isolated-client-token'], ['user', 'isolated-client-user']]);
  return { storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    events: [], values };
}

test('sign-out waits for server revocation before removing browser credentials', async () => {
  const { signOut, AUTH_SIGNED_OUT } = await client;
  const { storage, events } = fixture();
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const signedOut = signOut('/api', { storage, notify: event => events.push(event), request: async (url, options) => {
    assert.equal(url, '/api/auth/logout');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer isolated-client-token');
    return pending;
  } });
  assert.equal(storage.getItem('token'), 'isolated-client-token');
  assert.deepEqual(events, []);
  resolve({ ok: true, status: 200 });
  assert.equal(await signedOut, true);
  assert.equal(storage.getItem('token'), null);
  assert.equal(storage.getItem('user'), null);
  assert.deepEqual(events, [AUTH_SIGNED_OUT]);
});

test('server, old-backend and network errors retain the credential rather than claiming secure logout', async () => {
  const { signOut } = await client;
  for (const request of [async () => ({ ok: false, status: 500 }), async () => ({ ok: false, status: 503 }), async () => ({ ok: false, status: 404 }), async () => { throw new TypeError('isolated network error'); }]) {
    const { storage, events } = fixture();
    await assert.rejects(signOut('/api', { storage, request, notify: event => events.push(event) }), /Could not sign out securely/);
    assert.equal(storage.getItem('token'), 'isolated-client-token');
    assert.deepEqual(events, []);
  }
});

test('already-revoked credentials can be cleared and missing credentials do not make a server request', async () => {
  const { signOut } = await client;
  const { storage } = fixture();
  assert.equal(await signOut('/api', { storage, request: async () => ({ ok: false, status: 401 }), notify: () => {} }), true);
  assert.equal(storage.getItem('token'), null);
  assert.equal(await signOut('/api', { storage, request: () => { throw new Error('Must not send a tokenless request'); }, notify: () => {} }), true);
});

test('an in-flight logout cannot clear a newer login', async () => {
  const { signOut } = await client;
  const { storage, events } = fixture();
  const result = await signOut('/api', { storage, notify: event => events.push(event), request: async () => {
    storage.setItem('token', 'isolated-new-login');
    return { ok: true, status: 200 };
  } });
  assert.equal(result, false);
  assert.equal(storage.getItem('token'), 'isolated-new-login');
  assert.deepEqual(events, []);
});

test('MFA/profile replacement updates stored access and emits a token-free session event', async () => {
  const { storeAccessToken, AUTH_SESSION_CHANGED } = await client;
  const { storage, events } = fixture();
  storeAccessToken('isolated-replacement', { storage, notify: event => events.push(event) });
  assert.equal(storage.getItem('token'), 'isolated-replacement');
  assert.deepEqual(events, [AUTH_SESSION_CHANGED]);
});
