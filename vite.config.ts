import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  plugins: [react(), brochureRewrite()],
  server: {
    port: 5173,
    strictPort: false,
    open: true,
  },
})
