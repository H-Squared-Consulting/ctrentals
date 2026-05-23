import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Mirrors the production Vercel rewrite ({ "source": "/brochures/:slug",
// "destination": "/api/brochure?slug=:slug" }) so /brochures/<slug> works
// against the local dev server too. Without this, Vite's SPA fallback
// serves index.html for /brochures/anything, which dumps the user on the
// React app's wildcard redirect.
const brochureRewrite = () => ({
  name: 'brochures-rewrite',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url || '';
      const m = url.match(/^\/brochures\/([^/?#]+)(\?.*)?$/);
      if (m) {
        // The api/brochure.js function is only deployed on Vercel; locally we
        // skip OG-tag injection and serve brochure.html directly. The page
        // reads the slug from the pathname so the original URL is preserved
        // in the browser bar.
        req.url = `/brochure.html?slug=${encodeURIComponent(m[1])}${m[2] ? '&' + m[2].slice(1) : ''}`;
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
