// Caches Supabase Storage property images locally so the browser stops
// doing a forced revalidation roundtrip per image on every modal open.
//
// Why this exists: Supabase's public bucket endpoint emits
// `cache-control: no-cache` regardless of the metadata stored on the object,
// so manually-uploaded images (which live in Storage) hammer the network on
// every property open. Apify-scraped properties don't hit this because their
// images are on Airbnb's muscache CDN, which sets `max-age=300`.
//
// Each image URL contains a UUID, so cache entries never need to be busted
// in place — a new upload yields a new URL, an old URL stays valid forever.

const CACHE_NAME = 'ct-rentals-storage-v1';
const STORAGE_PREFIX = 'https://mnvxitexcdgohzgtvwzg.supabase.co/storage/v1/object/public/property-images/';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (!req.url.startsWith(STORAGE_PREFIX)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      // Offline / network error — fail loud so the calling <img> shows broken.
      throw err;
    }
  })());
});
