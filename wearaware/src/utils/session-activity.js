import { AUTH_SESSION_CHANGED, expireSession } from './auth-session.js';

// No fetch interception: scanner frames, polling, reloads and WebSocket messages
// do not count as activity. The server owns all deadlines and timestamps.
export function installSessionActivity(api, {
  browser = window, page = document, storage = localStorage, request = fetch,
  now = Date.now, schedule = setInterval, unschedule = clearInterval,
  expire = token => expireSession(token, { storage }),
} = {}) {
  let stopped = false;
  const pending = new Set();
  let previousToken;
  let lastAttempt = -Infinity;
  const controller = new AbortController();
  async function contact(renew) {
    const token = storage.getItem('token');
    if (!token || pending.has(renew) || stopped) return;
    if (token !== previousToken) { previousToken = token; lastAttempt = -Infinity; }
    if (renew && now() - lastAttempt < 30000) return;
    if (renew) lastAttempt = now();
    // A slow read-only poll must not discard a real foreground interaction.
    // Deduplicate reads and renewals separately; the server arbitrates expiry.
    pending.add(renew);
    try {
      const response = await request(`${api}/auth/${renew ? 'activity' : 'session'}`, {
        method: renew ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (!stopped && response.status === 401) expire(token);
      // A network/503 error is not evidence of expiry. Protected operations
      // still fail closed on the server; keep the credential for safe retry.
    } catch { /* No token, employee data or response bodies are logged. */ }
    finally { pending.delete(renew); }
  }
  const interact = event => {
    if (event.isTrusted === true && page.visibilityState === 'visible') void contact(true);
  };
  const validate = () => { void contact(false); };
  const visible = () => { if (page.visibilityState === 'visible') validate(); };
  const events = ['pointerdown', 'keydown', 'wheel'];
  for (const event of events) page.addEventListener(event, interact, { passive: true, capture: true });
  page.addEventListener('visibilitychange', visible);
  browser.addEventListener(AUTH_SESSION_CHANGED, validate);
  const timer = schedule(validate, 30000);
  validate();
  return () => {
    stopped = true;
    controller.abort();
    unschedule(timer);
    for (const event of events) page.removeEventListener(event, interact, { capture: true });
    page.removeEventListener('visibilitychange', visible);
    browser.removeEventListener(AUTH_SESSION_CHANGED, validate);
  };
}
