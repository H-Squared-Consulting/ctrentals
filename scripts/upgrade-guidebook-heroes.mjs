import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(1+l.indexOf('=')).trim()];}));
const SB_URL = env.VITE_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const q = async p => (await fetch(`${SB_URL}/rest/v1/${p}`, { headers: H })).json();
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const SPECIAL = { 'Montrose Terrace': 'montrose-terrace', 'Fulham': 'fulham' };

const props = await q('partner_properties?select=id,property_name,hero_image_url,listing_urls&order=property_name');
const gbs = await q('guidebooks?select=id,slug,property_id,hero_image_url');
const gbBySlug = new Map(gbs.map(g => [g.slug, g]));

let heroSwapped = 0, linked = 0;
for (const p of props.filter(p => p.listing_urls?.guidebook?.trim())) {
  const gb = gbBySlug.get(SPECIAL[p.property_name] || slugify(p.property_name));
  if (!gb) { console.log(`no guidebook: ${p.property_name}`); continue; }
  const patch = {};
  if (!gb.property_id) { patch.property_id = p.id; }
  // Property heroes come from the 1920px property-images pipeline —
  // strictly better than Hostfully's ~832px guidebook covers.
  if (p.hero_image_url && p.hero_image_url !== gb.hero_image_url) { patch.hero_image_url = p.hero_image_url; }
  if (!Object.keys(patch).length) continue;
  const r = await fetch(`${SB_URL}/rest/v1/guidebooks?id=eq.${gb.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(patch) });
  if (!r.ok) { console.log(`FAIL ${p.property_name}: ${(await r.text()).slice(0,120)}`); continue; }
  if (patch.hero_image_url) heroSwapped++;
  if (patch.property_id) linked++;
  console.log(`✓ ${p.property_name}${patch.hero_image_url ? ' hero→property' : ''}${patch.property_id ? ' linked' : ''}`);
}
console.log(`\nheroes upgraded: ${heroSwapped}, property links set: ${linked}`);
