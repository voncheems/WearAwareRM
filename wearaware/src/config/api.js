const configured = import.meta.env.VITE_API_ORIGIN;
// Keep local development pointed at the local API. The hosted demo has a
// Render API, so a missing Vercel build variable must not silently fall back
// to the Vercel static site (which produces a misleading "Failed to fetch").
const defaultOrigin = import.meta.env.DEV ? 'http://localhost:5000' : 'https://wearaware-api.onrender.com';
export const API_ORIGIN = (configured || defaultOrigin).replace(/\/$/, '');
if (import.meta.env.PROD && new URL(API_ORIGIN).protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(API_ORIGIN).hostname)) throw new Error('Production API must use HTTPS.');
export const API = `${API_ORIGIN}/api`;
