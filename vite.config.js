import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The deployed origin + base path. This is the ONE place either is written down:
// index.html gets it via %SITE_URL% below, and robots.txt / sitemap.xml are
// generated from it, so a domain or repo rename is a single-line edit here.
const BASE = '/Kalculator/'
const ORIGIN = 'https://kiarashfa.github.io'
const SITE_URL = ORIGIN + BASE

// Emits robots.txt and sitemap.xml into the build with real, base-aware URLs,
// rather than shipping hand-written files that go stale.
function seoFiles() {
  return {
    name: 'kalculator-seo-files',
    transformIndexHtml: (html) =>
      html.replaceAll('%SITE_URL%', SITE_URL).replaceAll('%BASE_URL%', BASE),
    generateBundle() {
      const lastmod = new Date().toISOString().slice(0, 10)
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
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

export default defineConfig({
  plugins: [react(), seoFiles()],
  base: BASE,
  build: {
    rollupOptions: {
      // 404.html is a second HTML entry so it runs through the same pipeline as
      // index.html (and so %SITE_URL% is substituted in it too).
      input: { main: 'index.html', notFound: '404.html' },
    },
  },
})
