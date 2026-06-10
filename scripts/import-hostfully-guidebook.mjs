#!/usr/bin/env node
// Import a Hostfully guidebook into our guidebook tables.
//
// Hostfully serves every public guidebook as JSON from a single endpoint:
//   https://v2api.hostfully.com/api/v1/guidebooks/key/<KEY>
// where <KEY> is the vanity slug in the public URL
// (v2.hostfully.com/<KEY> -> e.g. "MontroseTerrace").
//
// This script fetches that JSON and maps EVERY content surface into our
// schema (see supabase/migrations/20260526200000_guidebooks_schema.sql):
//   - guidebooks                 (1 row: host, address, wifi, check-in/out,
//                                 directions, parking, coords, hero,
//                                 welcome, emergency fields)
//   - guidebook_house_manuals    (1 row per Hostfully "information")
//   - guidebook_recommendations  (1 row per Hostfully "recommendation")
//   - *_assignments              (ordered links to the guidebook)
//
// Library rows are namespaced per property (`<key>-<slug>`) so re-running
// is idempotent and one property never clobbers another's content.
//
// Usage:
//   node scripts/import-hostfully-guidebook.mjs <hostfully-key> <our-slug> [--write]
//
//   default       writes an idempotent SQL seed to
//                 supabase/migrations/<ts>_guidebook_<slug>.sql
//   --write       upserts straight to Supabase (needs SUPABASE_SERVICE_KEY)
//
// Example:
//   node scripts/import-hostfully-guidebook.mjs MontroseTerrace montrose-terrace
//   SUPABASE_SERVICE_KEY=… node scripts/import-hostfully-guidebook.mjs MontroseTerrace montrose-terrace --write

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const API_BASE = 'https://v2api.hostfully.com/api/v1/guidebooks/key/';
const SUPABASE_URL = 'https://mnvxitexcdgohzgtvwzg.supabase.co';

const [key, slug, ...flags] = process.argv.slice(2);
if (!key || !slug) {
  console.error('usage: import-hostfully-guidebook.mjs <hostfully-key> <our-slug> [--write]');
  process.exit(1);
}
const doWrite = flags.includes('--write');

// ── Per-property overrides ───────────────────────────────────────────────────
// Hostfully stores hospital / armed-response as free-text manual cards, not
// structured fields. We best-effort extract them below, but where the prose
// is ambiguous an override here wins so the Emergency page is always clean.
const OVERRIDES = {
  MontroseTerrace: {
    armed_response_company: 'Prosec Security',
    armed_response_phone:   '021 712 4009',
    nearest_hospital_name:    'Mediclinic Constantiaberg',
    nearest_hospital_address: 'Mediclinic Constantiaberg, Burnham Rd, Plumstead, Cape Town',
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

// Make a slug unique within a batch by suffixing -2, -3, … on collision.
function uniqueSlug(base, seen) {
  let s = base, n = 2;
  while (seen.has(s)) s = `${base}-${n++}`;
  seen.add(s);
  return s;
}

// Map a Hostfully manual title to one of our 8 canonical categories. The DB
// renderer DROPS cards whose category isn't canonical, so this must always
// return one of the eight — unknowns fall through to 'Local Context'.
function canonicalCategory(title) {
  const t = String(title || '').toLowerCase();
  if (/emergenc|hospital|ambulance/.test(t)) return 'Emergencies';
  if (/alarm|key|entry|access|lock|gate|\bcode/.test(t)) return 'Access';
  if (/safety|fire|first aid|shut-?off|panic/.test(t)) return 'Safety';
  if (/wifi|wi-fi|internet|signal|connect/.test(t)) return 'Connectivity';
  if (/kitchen|appliance|laundry|washing|dryer|oven|dishwasher|microwave|\btv\b|television|media|aircon|heater|remote/.test(t)) return 'Appliances';
  if (/pool|garden|braai|bbq|outdoor|patio|jacuzzi|irrigation/.test(t)) return 'Outdoors';
  if (/house rule|rules|smoking|\bpet|quiet|occupancy|suntan|self.?tan|linen|towel/.test(t)) return 'House Rules';
  return 'Local Context'; // load-shedding, trash, grocery, transport, staff, etc.
}

// Map Hostfully's Material-Symbols icon names to our inline-SVG icon set
// (see src/lib/guidebookTaxonomy.ts ICON_OPTIONS).
const ICON_MAP = {
  VpnKey: 'key', Security: 'shield', FireExtinguisher: 'alert', Kitchen: 'home',
  ContentPaste: 'home', Courtyard: 'pool', Delete: 'home', LocalLaundryService: 'washing-machine',
  Power: 'bolt', ShoppingCart: 'shopping-cart', Tv: 'home', assignment: 'home',
  directions_car: 'car', health_and_safety: 'hospital', BeachAccess: 'sun',
};
const CATEGORY_ICON = {
  Safety: 'shield', Connectivity: 'wifi', Appliances: 'washing-machine', Access: 'key',
  'House Rules': 'home', Outdoors: 'pool', 'Local Context': 'sun', Emergencies: 'alert',
};
function iconFor(hfIcon, category) {
  return ICON_MAP[hfIcon] || CATEGORY_ICON[category] || 'home';
}

// Detect an in-home shut-off so the card surfaces in the Emergency page's
// shut-off section. One tag per card; first match wins.
function emergencyTagFor(title, bodyText) {
  const t = `${title} ${bodyText}`.toLowerCase();
  if (/gas[^.]{0,20}shut|shut[^.]{0,20}gas/.test(t)) return 'gas-shut-off';
  if (/water[^.]{0,20}shut|shut[^.]{0,20}water/.test(t)) return 'water-shut-off';
  if (/(electric|db board|mains|main board)[^.]{0,25}shut|shut[^.]{0,25}(electric|mains)/.test(t)) return 'electrical-shut-off';
  return null;
}

const firstPhone = (s) => (stripTags(s).match(/(\+?\d[\d ()-]{6,}\d)/) || [])[1] || null;

// ── 1. Fetch ─────────────────────────────────────────────────────────────────
const res = await fetch(API_BASE + encodeURIComponent(key), { headers: { Accept: 'application/json' } });
if (!res.ok) { console.error(`fetch ${key} -> ${res.status}`); process.exit(1); }
const json = await res.json();
const gb = json.data || json;
if (!gb || !gb.informations) { console.error('unexpected payload shape — no informations[]'); process.exit(1); }

// ── 2. Transform ─────────────────────────────────────────────────────────────
const ov = OVERRIDES[key] || {};
const addr = gb.address || {};
const host = gb.host_intro || {};
const wifi = gb.wifi || {};
const checkin = gb.checkin || {};
const checkout = gb.checkout || {};
const directions = gb.directions || {};
const parking = gb.parking || {};

const hostPhone = Array.isArray(host.host_phone) ? host.host_phone[0] : (host.host_phone || null);

// Combine the transport-mode direction blocks Hostfully exposes into one body.
const dirParts = [];
const dirModes = [
  ['airport_text', 'From the airport'],
  ['driving_text', 'Driving'],
  ['taxi_text', 'By taxi'],
  ['uber_text', 'Uber'],
  ['train_text', 'By train'],
  ['bus_text', 'By bus'],
  ['ferry_text', 'By ferry'],
  ['pickup_text', 'Pickup'],
  ['additional_directions', 'Additional directions'],
];
for (const [field, label] of dirModes) {
  const v = directions[field];
  if (v && stripTags(v)) dirParts.push(`<p><strong>${label}</strong></p><p>${stripTags(v)}</p>`);
}

// Best-effort emergency extraction from the relevant manual cards.
let armedCompany = ov.armed_response_company || null;
let armedPhone   = ov.armed_response_phone   || null;
let hospitalName = ov.nearest_hospital_name  || null;
const alarmCard = gb.informations.find(i => /alarm|security/i.test(i.title || i.name || ''));
if (alarmCard && !armedPhone) armedPhone = firstPhone(alarmCard.content);
const hospCard = gb.informations.find(i => /emergenc|hospital/i.test(i.title || i.name || ''));
if (hospCard && !hospitalName) {
  const m = stripTags(hospCard.content).match(/nearest hospital is\s+([^.]+)/i);
  if (m) hospitalName = m[1].trim();
}

const guidebook = {
  slug,
  property_name: gb.name || addr.formatted_address || slug,
  host_name: host.host_name || null,
  host_phone: hostPhone,
  host_photo_url: host.image || null,
  welcome_html: host.host_intro || null,
  street_name: addr.street || null,
  street_number: addr.street_number || null,
  city: addr.locality || null,
  country_code: addr.country_code || null,
  postal_code: addr.post_code || null,
  hero_image_url: gb.image || host.landing_background_image || null,
  checkin_text: [
    checkin.checkin_time ? `<p>Check-in from <strong>${checkin.checkin_time}</strong>.</p>` : '',
    checkin.checkin_text ? `<p>${stripTags(checkin.checkin_text)}</p>` : '',
  ].join('') || null,
  directions_text: dirParts.join('') || null,
  parking_text: parking.parking_text ? `<p>${stripTags(parking.parking_text)}</p>` : null,
  wifi_ssid: wifi.network_name || null,
  wifi_password: wifi.wifi_password || null,
  wifi_notes: stripTags(wifi.wifi_rules_text) || null,
  checkout_text: [
    checkout.checkout_time ? `<p>Check-out by <strong>${checkout.checkout_time}</strong>.</p>` : '',
    checkout.checkout_text ? `<p>${stripTags(checkout.checkout_text)}</p>` : '',
  ].join('') || null,
  lat: addr.lat ?? null,
  lng: addr.lng ?? null,
  armed_response_company: armedCompany,
  armed_response_phone: armedPhone,
  nearest_hospital_name: hospitalName,
  nearest_hospital_phone: ov.nearest_hospital_phone || null,
  nearest_hospital_address: ov.nearest_hospital_address || null,
  is_published: true,
};

// Hostfully often holds near-duplicate cards (e.g. two "Load-Shedding"
// entries). Collapse them by a normalised key — strip case, parentheticals
// and punctuation — and merge the bodies so no content is lost.
const dedupeKey = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '');

const manualSlugs = new Set();
const manualByKey = new Map();
const manuals = [];
for (const it of gb.informations) {
  const title = (it.title || it.name || 'Untitled').trim();
  const body = it.content || '';
  const dk = dedupeKey(title);
  const existing = manualByKey.get(dk);
  if (existing) {
    if (body) existing.body_html = (existing.body_html || '') + body;
    if (!existing.emergency_tag) existing.emergency_tag = emergencyTagFor(existing.title, stripTags(existing.body_html));
    console.log(`  (merged duplicate "${title}" into "${existing.title}")`);
    continue;
  }
  const category = canonicalCategory(title);
  const m = {
    slug: uniqueSlug(`${slugify(key)}-${slugify(title)}`, manualSlugs),
    title,
    category,
    body_html: body || null,
    icon: iconFor(it.icon, category),
    image_url: null, // skip Hostfully's generic category illustrations — they clash with the guidebook style
    emergency_tag: emergencyTagFor(title, stripTags(body)),
    position: manuals.length + 1,
  };
  manualByKey.set(dk, m);
  manuals.push(m);
}

const recSlugs = new Set();
const recs = gb.recommendations.map((r, i) => {
  const name = (r.name || 'Untitled').trim();
  // Hostfully nests category + address as objects, each with the real value.
  const category = (r.category && typeof r.category === 'object')
    ? (r.category.name || r.category.label || null)
    : (r.category || null);
  const addrObj = (r.address && typeof r.address === 'object') ? r.address : null;
  // Hours come as an array of day strings; fold into the description so the
  // opening times aren't lost (we have no dedicated hours column).
  const hours = Array.isArray(r.hours) && r.hours.length
    ? `<p><strong>Opening hours</strong><br>${r.hours.join('<br>')}</p>`
    : '';
  const baseDesc = r.content || (r.why_recommended ? `<p>${r.why_recommended}</p>` : '');
  return {
    slug: uniqueSlug(`${slugify(key)}-${slugify(name)}`, recSlugs),
    name,
    category: category ? String(category).trim() : null,
    description: (baseDesc + hours) || null,
    address: addrObj ? (addrObj.formatted_address || null) : (typeof r.address === 'string' ? r.address : null),
    phone: r.phone_number || null,
    website: r.website || null,
    image_url: r.image || null,
    lat: addrObj ? (addrObj.lat ?? null) : null,
    lng: addrObj ? (addrObj.lng ?? null) : null,
    position: i + 1,
  };
});

console.log(`Hostfully "${key}" → "${slug}"`);
console.log(`  guidebook: ${guidebook.property_name}`);
console.log(`  host: ${guidebook.host_name} ${guidebook.host_phone || ''}`);
console.log(`  wifi: ${guidebook.wifi_ssid} / ${guidebook.wifi_password}`);
console.log(`  coords: ${guidebook.lat}, ${guidebook.lng}`);
console.log(`  emergency: hospital=${guidebook.nearest_hospital_name} armed=${guidebook.armed_response_company} ${guidebook.armed_response_phone || ''}`);
console.log(`  manuals: ${manuals.length}  recommendations: ${recs.length}`);

// ── Image mirroring ──────────────────────────────────────────────────────────
// Hostfully serves guidebook images from its own storage
// (storage.googleapis.com/hostfully-dev-filestack, gb-cdn.hostfully.com).
// Those URLs die when the Hostfully account closes, so in --write mode we
// download every referenced image and re-host it in the public
// `guidebook-images` Supabase Storage bucket, rewriting all URLs (hero,
// host photo, card image_url, inline <img> in body_html) before insert.
// Failures keep the original URL — better a Hostfully link than a broken one.
const MIRROR_BUCKET = 'guidebook-images';
const URL_RE = /https?:\/\/[^"'\s)<>]+/g;
const isHostfullyHosted = (u) => /hostfully|filestack/i.test(u);

async function mirrorUrl(sb, folder, url, cache) {
  if (cache.has(url)) return cache.get(url);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!type.startsWith('image/')) throw new Error(`not an image (${type})`);
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' }[type] || 'jpg';
    const path = `${folder}/${createHash('sha1').update(url).digest('hex').slice(0, 12)}.${ext}`;
    const { error } = await sb.storage.from(MIRROR_BUCKET).upload(path, buf, { contentType: type, upsert: true });
    if (error) throw new Error(error.message);
    const { data } = sb.storage.from(MIRROR_BUCKET).getPublicUrl(path);
    cache.set(url, data.publicUrl);
    return data.publicUrl;
  } catch (err) {
    console.warn(`  ⚠ image mirror failed (${err.message}): ${url}`);
    cache.set(url, url);
    return url;
  }
}

/** Rewrite every Hostfully-hosted URL in every string field of the given
 *  objects (covers plain URL columns AND URLs embedded in body_html). */
async function mirrorAllImages(sb, folder, objects) {
  const cache = new Map();
  for (const obj of objects) {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v !== 'string' || !v) continue;
      const urls = [...new Set((v.match(URL_RE) || []).filter(isHostfullyHosted))];
      let next = v;
      for (const u of urls) next = next.split(u).join(await mirrorUrl(sb, folder, u, cache));
      obj[k] = next;
    }
  }
  return [...cache.entries()].filter(([from, to]) => from !== to).length;
}

// ── 3a. Direct write mode ────────────────────────────────────────────────────
if (doWrite) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) { console.error('\n--write needs SUPABASE_SERVICE_KEY in the environment'); process.exit(1); }
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(SUPABASE_URL, serviceKey);

  const mirrored = await mirrorAllImages(sb, slug, [guidebook, ...manuals, ...recs]);
  console.log(`  images mirrored to ${MIRROR_BUCKET}: ${mirrored}`);

  // Upsert the guidebook row, get its id.
  const { data: gbRow, error: gbErr } = await sb.from('guidebooks')
    .upsert(guidebook, { onConflict: 'slug' }).select('id').single();
  if (gbErr) { console.error('guidebook upsert failed:', gbErr.message); process.exit(1); }
  const gbId = gbRow.id;

  // Clear this guidebook's existing assignments + its namespaced library rows.
  await sb.from('guidebook_manual_assignments').delete().eq('guidebook_id', gbId);
  await sb.from('guidebook_recommendation_assignments').delete().eq('guidebook_id', gbId);
  await sb.from('guidebook_house_manuals').delete().like('slug', `${slugify(key)}-%`);
  await sb.from('guidebook_recommendations').delete().like('slug', `${slugify(key)}-%`);

  // Insert library rows.
  const { data: mRows, error: mErr } = await sb.from('guidebook_house_manuals')
    .insert(manuals.map(({ position, ...m }) => m)).select('id, slug');
  if (mErr) { console.error('manual insert failed:', mErr.message); process.exit(1); }
  const { data: rRows, error: rErr } = await sb.from('guidebook_recommendations')
    .insert(recs.map(({ position, ...r }) => r)).select('id, slug');
  if (rErr) { console.error('rec insert failed:', rErr.message); process.exit(1); }

  // Assignments (ordered).
  const mBySlug = Object.fromEntries(mRows.map(r => [r.slug, r.id]));
  const rBySlug = Object.fromEntries(rRows.map(r => [r.slug, r.id]));
  await sb.from('guidebook_manual_assignments').insert(
    manuals.map(m => ({ guidebook_id: gbId, manual_id: mBySlug[m.slug], position: m.position })));
  await sb.from('guidebook_recommendation_assignments').insert(
    recs.map(r => ({ guidebook_id: gbId, recommendation_id: rBySlug[r.slug], position: r.position })));

  console.log('\n✓ written to Supabase');
  process.exit(0);
}

// ── 3b. SQL seed mode (default) ──────────────────────────────────────────────
// Dollar-quote so HTML bodies need no escaping. HTML never contains $gb$.
function dq(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  const s = String(v);
  const tag = s.includes('$gb$') ? '$gbx$' : '$gb$';
  return `${tag}${s}${tag}`;
}

const gcols = Object.keys(guidebook);
const sql = [];
sql.push(`-- Guidebook import for "${slug}" from Hostfully key "${key}".`);
sql.push(`-- Generated by scripts/import-hostfully-guidebook.mjs. Idempotent: safe to re-run.`);
sql.push(`-- ${manuals.length} house-manual entries, ${recs.length} recommendations.`);
sql.push('');
sql.push('begin;');
sql.push('');
sql.push('-- 1. Guidebook row (upsert by slug).');
sql.push(`insert into guidebooks (${gcols.join(', ')}) values (`);
sql.push('  ' + gcols.map(c => dq(guidebook[c])).join(', '));
sql.push(')');
sql.push('on conflict (slug) do update set');
sql.push('  ' + gcols.filter(c => c !== 'slug').map(c => `${c} = excluded.${c}`).join(',\n  ') + ',');
sql.push('  updated_at = now();');
sql.push('');
sql.push('-- 2. Clear this guidebook\'s assignments + its namespaced library rows.');
sql.push(`with gb as (select id from guidebooks where slug = ${dq(slug)})`);
sql.push('delete from guidebook_manual_assignments where guidebook_id in (select id from gb);');
sql.push(`with gb as (select id from guidebooks where slug = ${dq(slug)})`);
sql.push('delete from guidebook_recommendation_assignments where guidebook_id in (select id from gb);');
sql.push(`delete from guidebook_house_manuals where slug like ${dq(slugify(key) + '-%')};`);
sql.push(`delete from guidebook_recommendations where slug like ${dq(slugify(key) + '-%')};`);
sql.push('');
sql.push('-- 3. House-manual library rows.');
sql.push('insert into guidebook_house_manuals (slug, title, category, body_html, icon, image_url, emergency_tag) values');
sql.push(manuals.map(m =>
  `  (${dq(m.slug)}, ${dq(m.title)}, ${dq(m.category)}, ${dq(m.body_html)}, ${dq(m.icon)}, ${dq(m.image_url)}, ${dq(m.emergency_tag)})`
).join(',\n') + ';');
sql.push('');
sql.push('-- 4. Recommendation library rows.');
sql.push('insert into guidebook_recommendations (slug, name, category, description, address, phone, website, image_url, lat, lng) values');
sql.push(recs.map(r =>
  `  (${dq(r.slug)}, ${dq(r.name)}, ${dq(r.category)}, ${dq(r.description)}, ${dq(r.address)}, ${dq(r.phone)}, ${dq(r.website)}, ${dq(r.image_url)}, ${dq(r.lat)}, ${dq(r.lng)})`
).join(',\n') + ';');
sql.push('');
sql.push('-- 5. Manual assignments (ordered).');
sql.push(`with gb as (select id from guidebooks where slug = ${dq(slug)})`);
sql.push('insert into guidebook_manual_assignments (guidebook_id, manual_id, position)');
sql.push('select gb.id, m.id, ord.pos from gb,');
sql.push('  (values');
sql.push(manuals.map(m => `    (${dq(m.slug)}, ${m.position})`).join(',\n'));
sql.push('  ) as ord(slug, pos)');
sql.push('  join guidebook_house_manuals m on m.slug = ord.slug;');
sql.push('');
sql.push('-- 6. Recommendation assignments (ordered).');
sql.push(`with gb as (select id from guidebooks where slug = ${dq(slug)})`);
sql.push('insert into guidebook_recommendation_assignments (guidebook_id, recommendation_id, position)');
sql.push('select gb.id, r.id, ord.pos from gb,');
sql.push('  (values');
sql.push(recs.map(r => `    (${dq(r.slug)}, ${r.position})`).join(',\n'));
sql.push('  ) as ord(slug, pos)');
sql.push('  join guidebook_recommendations r on r.slug = ord.slug;');
sql.push('');
sql.push('commit;');
sql.push('');

const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'supabase', 'migrations', `${ts}_guidebook_${slug.replace(/-/g, '_')}.sql`);
writeFileSync(outPath, sql.join('\n'));
console.log(`\n✓ SQL seed written to:\n  ${outPath}`);
console.log('\nApply it via the Supabase SQL editor (paste the file), or re-run this');
console.log('script with --write and SUPABASE_SERVICE_KEY set to upsert directly.');
