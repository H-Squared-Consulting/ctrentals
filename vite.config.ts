import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Mirrors the production Vercel rewrites so /brochures/<slug> and
// /agent-brochures/<slug> work against the local dev server too. Without
// these, Vite's SPA fallback serves index.html for the path, which dumps
// the user on the React app's wildcard redirect (→ /dashboard).
//
//   /brochures/CTR0011        → /brochure.html?slug=CTR0011
//   /agent-brochures/CTR0011  → /brochure.html?slug=CTR0011&brand=agent-anon
//
// The api/brochure.js function (Vercel) only handles OG-meta injection for
// social previews; in dev we serve brochure.html directly. brochure.html
// reads the slug + brand from the URL on its own.
const brochureRewrite = () => ({
  name: 'brochures-rewrite',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url || '';
      const branded = url.match(/^\/brochures\/([^/?#]+)(\?.*)?$/);
      const anon    = url.match(/^\/agent-brochures\/([^/?#]+)(\?.*)?$/);
      if (branded) {
        req.url = `/brochure.html?slug=${encodeURIComponent(branded[1])}${branded[2] ? '&' + branded[2].slice(1) : ''}`;
      } else if (anon) {
        req.url = `/brochure.html?slug=${encodeURIComponent(anon[1])}&brand=agent-anon${anon[2] ? '&' + anon[2].slice(1) : ''}`;
      }
      next();
    });
  },
});

// Build identifier shared by the bundle (via __BUILD_ID__) and the emitted
// version.json. Sourced from Vercel's commit SHA in production so every
// deploy produces a distinct ID; falls back to a build-time timestamp for
// local builds (and any future case where this runs outside Vercel).
const buildId = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now());

// Writes dist/version.json after Vite finishes bundling. The runtime auto-
// update check (src/lib/autoUpdate.ts) polls this file and reloads the tab
// when the served buildId no longer matches the one baked into the bundle.
const emitVersionJson = () => ({
  name: 'emit-version-json',
  apply: 'build' as const,
  writeBundle(options: { dir?: string }) {
    const outDir = options.dir || 'dist';
    const body = JSON.stringify({ buildId, builtAt: new Date().toISOString() }) + '\n';
    writeFileSync(join(outDir, 'version.json'), body);
  },
});

export default defineConfig({
  plugins: [react(), brochureRewrite(), emitVersionJson()],
  define: {
    // Inlined as a string literal at build time. Compared against the
    // /version.json buildId at runtime to detect new deploys.
    __BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    port: 5173,
    strictPort: false,
    open: true,
  },
})
