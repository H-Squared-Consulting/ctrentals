#!/usr/bin/env node
// Recompress oversized originals in `property-images` Storage and update the
// owning row in `partner_properties`. Mirrors the in-browser pipeline in
// src/components/ImageManager.tsx (1920px max edge, JPEG q82, year-long cache).
//
// Usage:
//   node scripts/recompress-property-images.mjs <property_id> [--canary]
//
// --canary processes only the hero + first gallery image so you can eyeball
// the result before running the full sweep.

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const SUPABASE_URL = 'https://mnvxitexcdgohzgtvwzg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_KEY) {
  console.error('set SUPABASE_SERVICE_KEY env var (service_role key)');
  process.exit(1);
}
const BUCKET = 'property-images';
const MAX_DIM = 1920;
const JPEG_QUALITY = 82;
const STORAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

const propertyId = process.argv[2];
const canary = process.argv.includes('--canary');
if (!propertyId) {
  console.error('usage: recompress-property-images.mjs <property_id> [--canary]');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function storagePathFromUrl(url) {
  if (!url || !url.startsWith(STORAGE_PREFIX)) return null;
  return url.slice(STORAGE_PREFIX.length);
}

async function recompressOne(url) {
  const path = storagePathFromUrl(url);
  if (!path) {
    console.log(`  skip (not a Supabase Storage URL): ${url.slice(0, 80)}…`);
    return url;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const inputBytes = Buffer.from(await res.arrayBuffer());
  const inputSize = inputBytes.length;

  const out = await sharp(inputBytes)
    .rotate()
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  const folder = path.split('/').slice(0, -1).join('/') || propertyId;
  const newName = `${crypto.randomUUID()}.jpg`;
  const newPath = `${folder}/${newName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(newPath, out, {
    cacheControl: '31536000',
    upsert: false,
    contentType: 'image/jpeg',
  });
  if (error) throw new Error(`upload ${newPath}: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(newPath);
  const newUrl = data.publicUrl;
  console.log(`  ${(inputSize / 1024 / 1024).toFixed(2)}MB -> ${(out.length / 1024).toFixed(0)}KB  ${newName}`);
  return newUrl;
}

async function main() {
  const { data: rows, error } = await supabase
    .from('partner_properties')
    .select('id, property_name, hero_image_url, gallery_images')
    .eq('id', propertyId);
  if (error) throw error;
  if (!rows?.length) throw new Error(`no property ${propertyId}`);
  const prop = rows[0];

  const hero = prop.hero_image_url || null;
  const gallery = Array.isArray(prop.gallery_images) ? prop.gallery_images : [];
  console.log(`property: ${prop.property_name}`);
  console.log(`hero: ${hero ? '1' : '0'}, gallery: ${gallery.length}`);

  const targets = canary
    ? [hero, gallery[0]].filter(Boolean)
    : [hero, ...gallery].filter(Boolean);
  console.log(`processing ${targets.length} image(s)${canary ? ' (canary)' : ''}\n`);

  const urlMap = new Map();
  for (const url of targets) {
    if (urlMap.has(url)) continue;
    try {
      const newUrl = await recompressOne(url);
      urlMap.set(url, newUrl);
    } catch (e) {
      console.error(`  FAIL ${url}: ${e.message}`);
      throw e;
    }
  }

  if (canary) {
    console.log('\ncanary done — DB not updated. Re-run without --canary to apply.');
    return;
  }

  const newHero = hero && urlMap.get(hero) ? urlMap.get(hero) : hero;
  const newGallery = gallery.map((u) => urlMap.get(u) || u);

  const { error: updErr } = await supabase
    .from('partner_properties')
    .update({ hero_image_url: newHero, gallery_images: newGallery, updated_at: new Date().toISOString() })
    .eq('id', propertyId);
  if (updErr) throw new Error(`db update: ${updErr.message}`);

  console.log(`\nDB updated. Old URLs left in storage (orphaned) — purge manually after verifying.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
