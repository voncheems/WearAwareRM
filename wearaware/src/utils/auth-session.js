export const AUTH_SIGNED_OUT = 'wearaware:signed-out';
export const AUTH_SESSION_CHANGED = 'wearaware:session-changed';
const notifyBrowser = name => window.dispatchEvent(new Event(name));

export function storeAccessToken(token, { storage = localStorage, notify = notifyBrowser } = {}) {
  storage.setItem('token', token);
  notify(AUTH_SESSION_CHANGED);
}

export async function signOut(api, { storage = localStorage, request = fetch, notify = notifyBrowser } = {}) {
  const token = storage.getItem('token');
  if (token) {
    let response;
    try {
      response = await request(`${api}/auth/logout`, { method: 'POST',
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    } catch {
      throw new Error('Could not sign out securely. Check your connection and retry.');
    }
    // An expired/revoked credential is already unusable. Other failures must
    // not be presented as successful server-side revocation.
    if (!response.ok && response.status !== 401) throw new Error('Could not sign out securely. Please retry or contact your administrator.');
  }
  // Do not clear a newer login that completed while logout was in flight.
  if (storage.getItem('token') !== token) return false;
  storage.removeItem('token');
  storage.removeItem('user');
  notify(AUTH_SIGNED_OUT);
  return true;
}
