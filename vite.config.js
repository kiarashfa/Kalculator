import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { PRIVACY } from './src/privacy.js'

// The deployed origin + base path. This is the ONE place either is written down:
// index.html gets it via %SITE_URL% below, and robots.txt / sitemap-index.xml are
// generated from it, so a domain or repo rename is a single-line edit here.
const BASE = '/Kalculator/'
const ORIGIN = 'https://kiarashfa.github.io'
const SITE_URL = ORIGIN + BASE

// The dev server must run on 4321: that is the origin registered with Google
// (http://localhost:4321) and the Dropbox redirect (http://localhost:4321/Kalculator/).
const DEV_PORT = 4321

// The privacy policy as plain HTML for <noscript>, from the same text the app shows
// (src/privacy.js), so a reader that does not run scripts (a crawler, a reviewer)
// finds the policy at /Kalculator/#privacy too.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const inline = (p) => typeof p === 'string' ? esc(p)
  : p.map((x) => typeof x === 'string' ? esc(x) : `<a href="${esc(x.href)}">${esc(x.text)}</a>`).join('')
const PRIVACY_HTML =
  '<main id="privacy" style="max-width:640px;margin:0 auto;padding:24px;color:#eceef4;font:15px/1.6 system-ui,sans-serif">' +
  '<h1>Kalculator privacy policy</h1>' +
  PRIVACY.map((s) => `<h2>${esc(s.title)}</h2>${s.text.map((p) => `<p>${inline(p)}</p>`).join('')}`).join('') +
  '</main>'

// Emits robots.txt and sitemap-index.xml into the build with real, base-aware URLs,
// rather than shipping hand-written files that go stale.
function seoFiles() {
  return {
    name: 'kalculator-seo-files',
    transformIndexHtml: (html) =>
      html.replaceAll('%SITE_URL%', SITE_URL).replaceAll('%BASE_URL%', BASE).replaceAll('%PRIVACY_HTML%', PRIVACY_HTML),
    generateBundle() {
      const lastmod = new Date().toISOString().slice(0, 10)
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap-index.xml\n`,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap-index.xml',
        source:
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          `  <url>\n    <loc>${SITE_URL}</loc>\n    <lastmod>${lastmod}</lastmod>\n` +
          `    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>\n` +
          `</urlset>\n`,
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Cloud save ids: GOOGLE_CLIENT_ID and DROPBOX_APP_KEY, from .env locally and from the
  // repository variables in CI. Both are public by design (they ship in the page); only
  // these two names are exposed to the app, nothing else in .env.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  return {
    plugins: [react(), seoFiles()],
    base: BASE,
    define: {
      __GOOGLE_CLIENT_ID__: JSON.stringify(env.GOOGLE_CLIENT_ID || ''),
      __DROPBOX_APP_KEY__: JSON.stringify(env.DROPBOX_APP_KEY || ''),
    },
    server: { port: DEV_PORT, strictPort: true },
    preview: { port: DEV_PORT, strictPort: true },
    build: {
      rollupOptions: {
        // 404.html is a second HTML entry so it runs through the same pipeline as
        // index.html (and so %SITE_URL% is substituted in it too).
        input: { main: 'index.html', notFound: '404.html' },
      },
    },
  }
})
