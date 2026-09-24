import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const api = env.VITE_API_ORIGIN ? new URL(env.VITE_API_ORIGIN).origin : ''
  if (command === 'build' && api && !api.startsWith('https://')) throw new Error('VITE_API_ORIGIN must use HTTPS for production builds.')
  const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https://images.unsplash.com", "font-src 'self' data:", `connect-src 'self' ${api} ${api.replace(/^https:/, 'wss:')}`.trim(), "media-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'"].join('; ')
  return {
    plugins: [react(), {
      name: 'production-security-policy', apply: 'build',
      transformIndexHtml() { return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }, { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' }] },
      generateBundle() {
        // Hosts supporting _headers can apply this file; other hosts must configure equivalent headers.
        this.emitFile({ type: 'asset', fileName: '_headers', source: `/*\n  Content-Security-Policy: ${csp}; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(self), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000\n` })
      },
    }],
  }
})
