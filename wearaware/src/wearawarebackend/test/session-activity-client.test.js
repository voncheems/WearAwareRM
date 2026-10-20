const { test } = require('node:test');
const assert = require('node:assert/strict');
const client = import('../../utils/session-activity.js');
const auth = import('../../utils/auth-session.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
function events() {
  const listeners = new Map();
  return { visibilityState: 'visible', addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); }, emit(name, event = {}) { listeners.get(name)?.(event); }, listeners };
}
async function fixture(requestOverride) {
  const { installSessionActivity } = await client;
  const page = events(), browser = events(), calls = [], expired = [];
  const values = new Map([['token', 'isolated-token']]);
  const storage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) };
  let tick, time = 0, cleared = false;
  const stop = installSessionActivity('/api', { page, browser, storage,
    request: async (url, options) => { calls.push({ url, options }); return requestOverride ? requestOverride(url, options) : { status: 200 }; },
    now: () => time, schedule: callback => { tick = callback; return 7; }, unschedule: value => { cleared = value === 7; },
    expire: token => expired.push(token) });
  await flush();
  return { page, browser, calls, expired, storage, values, stop, tick: () => tick(), advance: value => { time += value; }, cleared: () => cleared };
}

test('initial load, polling and visibility changes validate only and never renew', async () => {
  const f = await fixture();
  f.tick(); await flush();
  f.page.emit('visibilitychange'); await flush();
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => call.url === '/api/auth/session' && call.options.method === 'GET'));
  f.stop();
});

test('only trusted foreground user input renews; synthetic and hidden events do not', async () => {
  const f = await fixture();
  f.page.emit('keydown', { isTrusted: false }); await flush();
  f.page.visibilityState = 'hidden';
  f.page.emit('pointerdown', { isTrusted: true }); await flush();
  assert.equal(f.calls.length, 1);
  f.page.visibilityState = 'visible';
  f.page.emit('pointerdown', { isTrusted: true }); await flush();
  assert.equal(f.calls[1].url, '/api/auth/activity');
  assert.equal(f.calls[1].options.method, 'POST');
  assert.equal(f.calls[1].options.body, undefined);
  f.stop();
});

test('foreground signals are throttled and timers never replay earlier activity', async () => {
  const f = await fixture();
  f.page.emit('keydown', { isTrusted: true }); await flush();
  f.page.emit('wheel', { isTrusted: true }); await flush();
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
  f.advance(30000); f.tick(); await flush();
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
  f.page.emit('keydown', { isTrusted: true }); await flush();
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 2);
  f.stop();
});

test('slow read-only checks do not discard foreground activity or multiply concurrent renewals', async () => {
  let finishRead, finishRenew;
  const f = await fixture((_url, options) => new Promise(resolve => {
    if (options.method === 'GET') finishRead = resolve;
    else finishRenew = resolve;
  }));
  f.page.emit('pointerdown', { isTrusted: true }); await flush();
  f.advance(30000);
  f.page.emit('keydown', { isTrusted: true }); await flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].options.method, 'POST');
  finishRenew({ status: 200 }); finishRead({ status: 200 }); await flush();
  f.stop();
});

test('401 triggers session expiry; network and service failures do not fabricate expiry', async () => {
  const expired = await fixture(() => ({ status: 401 }));
  assert.deepEqual(expired.expired, ['isolated-token']); expired.stop();
  for (const request of [() => ({ status: 503 }), () => { throw new Error('isolated offline'); }]) {
    const f = await fixture(request);
    assert.deepEqual(f.expired, []);
    f.stop();
  }
});

test('expiration clears only the matching browser session and emits a login notification', async () => {
  const { expireSession, AUTH_SESSION_EXPIRED } = await auth;
  const values = new Map([['token', 'new-login'], ['user', 'test-user']]);
  const storage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) };
  const notifications = [];
  const options = { storage, notify: name => notifications.push(name) };
  assert.equal(expireSession('old-login', options), false);
  assert.equal(storage.getItem('token'), 'new-login');
  assert.equal(expireSession('new-login', options), true);
  assert.equal(storage.getItem('token'), null);
  assert.equal(storage.getItem('user'), null);
  assert.deepEqual(notifications, [AUTH_SESSION_EXPIRED]);
});

test('signed-out pages send no authentication request and teardown removes listeners and timer', async () => {
  const f = await fixture();
  f.values.delete('token'); f.tick(); await flush();
  f.page.emit('pointerdown', { isTrusted: true }); await flush();
  assert.equal(f.calls.length, 1);
  f.stop();
  assert.equal(f.cleared(), true);
  assert.equal(f.page.listeners.size, 0);
  assert.equal(f.browser.listeners.size, 0);
  assert.equal(f.calls[0].options.signal.aborted, true);
});
