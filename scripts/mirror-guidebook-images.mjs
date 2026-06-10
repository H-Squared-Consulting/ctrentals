#!/usr/bin/env node
// Re-host Hostfully-served images already sitting in our guidebook tables.
//
// The importer now mirrors images at import time, but rows imported before
// that change (and any hand-pasted Hostfully URL) still hot-link
// storage.googleapis.com/hostfully-dev-filestack / gb-cdn.hostfully.com —
// which die when the Hostfully account closes. This scans every guidebook
// row, downloads each referenced image into the public `guidebook-images`
// bucket, and rewrites the URLs in place. Text content is otherwise
// untouched, so it's safe to run on guidebooks that have been edited
// since import. Idempotent: mirrored URLs no longer match the scan.
//
// Usage:
//   SUPABASE_SERVICE_KEY=… node scripts/mirror-guidebook-images.mjs

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mnvxitexcdgohzgtvwzg.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!serviceKey) { console.error('needs SUPABASE_SERVICE_KEY in the environment'); process.exit(1); }
const sb = createClient(SUPABASE_URL, serviceKey);

const BUCKET = 'guidebook-images';
const URL_RE = /https?:\/\/[^"'\s)<>]+/g;
const isHostfullyHosted = (u) => /hostfully|filestack/i.test(u);
const cache = new Map();

async function mirrorUrl(folder, url) {
  if (cache.has(url)) return cache.get(url);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!type.startsWith('image/')) throw new Error(`not an image (${type})`);
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' }[type] || 'jpg';
    const path = `${folder}/${createHash('sha1').update(url).digest('hex').slice(0, 12)}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: true });
    if (error) throw new Error(error.message);
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    cache.set(url, data.publicUrl);
    return data.publicUrl;
  } catch (err) {
    console.warn(`  ⚠ mirror failed (${err.message}): ${url}`);
    cache.set(url, url);
    return url;
  }
}

// (table, key column, string columns to scan, folder column for the bucket path)
const TARGETS = [
  { table: 'guidebooks',                 cols: ['hero_image_url', 'host_photo_url', 'welcome_html', 'directions_text'], folderCol: 'slug' },
  { table: 'guidebook_house_manuals',    cols: ['body_html', 'image_url'],                                              folderCol: 'slug' },
  { table: 'guidebook_recommendations',  cols: ['description', 'image_url'],                                            folderCol: 'slug' },
];

let updatedRows = 0;
for (const t of TARGETS) {
  const { data: rows, error } = await sb.from(t.table).select(`id, ${t.folderCol}, ${t.cols.join(', ')}`);
  if (error) { console.error(`${t.table}: ${error.message}`); process.exit(1); }
  for (const row of rows) {
    const patch = {};
    for (const col of t.cols) {
      const v = row[col];
      if (typeof v !== 'string' || !v) continue;
      const urls = [...new Set((v.match(URL_RE) || []).filter(isHostfullyHosted))];
      if (!urls.length) continue;
      // Folder by the row's own slug so bucket paths stay browsable.
      let next = v;
      for (const u of urls) next = next.split(u).join(await mirrorUrl(row[t.folderCol] || 'misc', u));
      if (next !== v) patch[col] = next;
    }
    if (Object.keys(patch).length) {
      const { error: upErr } = await sb.from(t.table).update(patch).eq('id', row.id);
      if (upErr) { console.error(`${t.table}/${row.id}: ${upErr.message}`); continue; }
      updatedRows++;
      console.log(`  ✓ ${t.table} · ${row[t.folderCol]} (${Object.keys(patch).join(', ')})`);
    }
  }
}
const mirrored = [...cache.entries()].filter(([a, b]) => a !== b).length;
console.log(`\nDone: ${mirrored} images mirrored, ${updatedRows} rows updated.`);
