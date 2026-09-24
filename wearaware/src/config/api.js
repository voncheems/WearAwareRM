const configured = import.meta.env.VITE_API_ORIGIN;
export const API_ORIGIN = (configured || (import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin)).replace(/\/$/, '');
if (import.meta.env.PROD && new URL(API_ORIGIN).protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(API_ORIGIN).hostname)) throw new Error('Production API must use HTTPS.');
export const API = `${API_ORIGIN}/api`;
