#!/usr/bin/env node
/**
 * One-shot backfill — pull every partner_property that has an Airbnb URL
 * in listing_urls.airbnb, fire the fetch-airbnb-title edge function for
 * each, and let the function cache the result on the row. Skips properties
 * with no Airbnb URL and properties that already have a non-empty
 * airbnb_title (so re-running is cheap).
 *
 * Run from anywhere with both env vars set:
 *
 *   VITE_SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=ey... \
 *     node scripts/backfill-airbnb-titles.mjs
 *
 * Pass `--force` to refresh titles for properties that already have one
 * cached (useful after a property's Airbnb listing title was edited).
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FORCE = process.argv.includes('--force');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const HEADERS = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function fetchProperties() {
  // We pull the whole row set in one request (~60 rows in prod) and
  // filter client-side — keeps the script obvious instead of building
  // PostgREST jsonb queries against listing_urls.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/partner_properties?select=id,property_name,listing_urls,airbnb_title`,
    { headers: HEADERS },
  );
  if (!res.ok) {
    throw new Error(`Failed to list properties: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function fetchTitle(url, propertyId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-airbnb-title`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ url, propertyId }),
  });
  return res.json().catch(() => ({ ok: false, reason: 'invalid-json' }));
}

(async () => {
  const properties = await fetchProperties();
  const candidates = properties.filter(p => {
    const url = p?.listing_urls?.airbnb;
    if (typeof url !== 'string' || !url.trim()) return false;
    if (!FORCE && typeof p.airbnb_title === 'string' && p.airbnb_title.trim()) return false;
    return true;
  });

  console.log(`Total properties: ${properties.length}`);
  console.log(`With Airbnb URL ${FORCE ? '(force-refreshing all)' : '(missing title)'}: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let ok = 0, failed = 0;
  for (const p of candidates) {
    const url = p.listing_urls.airbnb.trim();
    process.stdout.write(`• ${p.property_name || p.id} … `);
    const result = await fetchTitle(url, p.id);
    if (result?.ok && result.title) {
      console.log(`✓ ${result.title}`);
      ok++;
    } else {
      console.log(`✗ ${result?.reason || 'unknown'}`);
      failed++;
    }
    // Spread requests slightly so we're not hammering Airbnb in a
    // tight loop — they'll start serving the bot variant if we do.
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\nDone — ${ok} cached, ${failed} failed.`);
})().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
