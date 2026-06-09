/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // Optional: map views fall back to a list when this is unset.
  readonly VITE_MAPBOX_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Inlined by Vite's `define` config from process.env.VERCEL_GIT_COMMIT_SHA
// (or a timestamp fallback for local builds). Compared at runtime against
// /version.json to detect when a new deploy has landed.
declare const __BUILD_ID__: string;
