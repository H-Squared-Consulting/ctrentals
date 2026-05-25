#!/usr/bin/env node
// Scrape an Airbnb listing's deferred-state JSON and ingest into
// `partner_properties`. Mirrors the field shape produced by the Apify pipeline
// used on Bergzicht Close, Boulderwood, etc., so a manually-scraped row is
// indistinguishable from a scraped one.
//
// Usage:
//   SUPABASE_SERVICE_KEY=... node scripts/scrape-airbnb.mjs <property_id> <airbnb_url>
//
// The property_id is the existing partner_properties row to update. We never
// create new rows here — the row is expected to already exist (from the
// original seed) so we keep its id, slug, partner_id stable.

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = 'https://mnvxitexcdgohzgtvwzg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_KEY) { console.error('set SUPABASE_SERVICE_KEY'); process.exit(1); }

const propertyId = process.argv[2];
const airbnbUrl  = process.argv[3];
if (!propertyId || !airbnbUrl) {
  console.error('usage: scrape-airbnb.mjs <property_id> <airbnb_url>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── 1. fetch HTML ───────────────────────────────────────────────────────────
const res = await fetch(airbnbUrl, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  },
});
if (!res.ok) { console.error(`fetch ${airbnbUrl} -> ${res.status}`); process.exit(1); }
const html = await res.text();

// ── 2. extract deferred-state JSON ──────────────────────────────────────────
const m = html.match(/<script[^>]+id="data-deferred-state[^"]*"[^>]*>([\s\S]*?)<\/script>/);
if (!m) { console.error('no deferred-state script — page shape changed or got blocked'); process.exit(1); }
const deferred = JSON.parse(m[1]);
const payload  = deferred.niobeClientData[0][1].data;
const sections = payload.presentation.stayProductDetailPage.sections.sections;
const node     = payload.node;

const sectionByType = (typename) => sections.find(s => s.section?.__typename === typename)?.section;
const sectionById   = (id)       => sections.find(s => s.sectionId === id)?.section;

// ── 3. pull each piece we care about ────────────────────────────────────────
const title = sectionByType('PdpTitleSection')?.title?.trim() || null;

const descSection = sectionByType('PdpDescriptionSection');
let description = null;
if (descSection?.htmlDescription?.htmlText) {
  description = descSection.htmlDescription.htmlText.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

// Sleeps — try the typed field first, fall back to parsing "8 guests" out of
// the sbuiData overview items, which Airbnb populates in every PDP variant.
function extractSleeps() {
  const direct = node?.pdpPresentation?.personCapacity;
  if (typeof direct === 'number' && direct > 0) return direct;
  const overviewItems = payload?.presentation?.stayProductDetailPage?.sections?.sbuiData
    ?.sectionConfiguration?.root?.sections?.[0]?.sectionData?.overviewItems ?? [];
  for (const it of overviewItems) {
    const m = (it?.title || '').match(/^(\d+)\s+guest/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}
const sleeps = extractSleeps();

// Bedrooms / bathrooms — same overview block; the existing row may already
// have these populated, so we only overwrite if we found a value.
function extractFromOverview(re) {
  const items = payload?.presentation?.stayProductDetailPage?.sections?.sbuiData
    ?.sectionConfiguration?.root?.sections?.[0]?.sectionData?.overviewItems ?? [];
  for (const it of items) {
    const m = (it?.title || '').match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}
const bedrooms  = extractFromOverview(/^(\d+)\s+bedroom/i);
const bathrooms = extractFromOverview(/^(\d+)\s+bath/i);

// Location — LocationSection.previewLocationDetails[0].title is "City, Region, Country".
let city = null, province = null;
const locSec = sectionByType('LocationSection');
const locStr = locSec?.previewLocationDetails?.[0]?.title || locSec?.subtitle || '';
if (locStr) {
  const parts = locStr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 1) city = parts[0];
  if (parts.length >= 2) province = parts[1];
}

// Amenities — Airbnb moved these out of AmenitiesSection (now empty
// post-revamp) into node.pdpPresentation.amenities.seeAllAmenitiesGroups.
// Flatten all "available" amenities across groups; dedupe to keep the
// tag list tidy when the same item is repeated across groups.
const amenityGroups = node?.pdpPresentation?.amenities?.seeAllAmenitiesGroups ?? [];
const amenitySet = new Set();
for (const grp of amenityGroups) {
  for (const a of grp.amenities ?? []) {
    if (a.available && a.title) amenitySet.add(a.title);
  }
}
const amenityNames = [...amenitySet];

// Hero + gallery — PhotoTourModal has full set; HERO_DEFAULT is fallback.
const photoModal = sectionByType('PhotoTourModalSection');
let images = [];
if (photoModal?.mediaItems) {
  images = photoModal.mediaItems.map(i => i.baseUrl || i.imageBaseUrl).filter(Boolean);
} else {
  const hero = sectionByType('PdpHeroSection');
  images = (hero?.previewImages || []).map(i => i.baseUrl || i.imageBaseUrl).filter(Boolean);
}
// Strip Airbnb's image-resize query params so we store the canonical URL — the
// Apify-scraped rows store muscache URLs without query strings.
images = images.map(u => u.split('?')[0]);
const heroImageUrl = images[0] || null;
const galleryImages = images.slice(1);

// Suburb — Airbnb's breadcrumb trail is the most reliable source. The deepest
// breadcrumb after [Airbnb, Country, Region, City] is the suburb/district.
let suburb = null;
const seoSec = sections.find(s => s.section?.__typename === 'SeoLinksSection')?.section;
const breadcrumbs = seoSec?.breadcrumbs ?? [];
if (breadcrumbs.length >= 5) suburb = breadcrumbs[breadcrumbs.length - 1].title?.trim() || null;

// Rating / review count
const overview = sectionById('OVERVIEW_DEFAULT_V2') || sections.find(s => s.section?.overviewItems);
const ratingItem = overview?.section?.overviewItems?.find(i =>
  typeof i.title === 'string' && /^[\d.]+$/.test(i.title)
);
const externalRating = ratingItem?.title ? parseFloat(ratingItem.title) : null;

// Listing id from the URL
const listingIdMatch = airbnbUrl.match(/\/rooms\/(\d+)/);
const listingId = listingIdMatch ? listingIdMatch[1] : null;
const cleanBookingUrl = listingId ? `https://www.airbnb.co.za/rooms/${listingId}` : airbnbUrl.split('?')[0];

// ── 4. show what we got, then write to DB ──────────────────────────────────
console.log('--- scraped ---');
console.log('title:        ', title);
console.log('sleeps:       ', sleeps);
console.log('amenities:    ', amenityNames.length);
console.log('hero:         ', heroImageUrl ? heroImageUrl.slice(0, 80) + '…' : null);
console.log('gallery count:', galleryImages.length);
console.log('city/prov:    ', city, '/', province);
console.log('suburb:       ', suburb);
console.log('rating:       ', externalRating);
console.log('booking_url:  ', cleanBookingUrl);
console.log('description:  ', description ? `${description.slice(0,140)}…` : null);

// gallery_sections is the structured source-of-truth the Gallery
// editor reads from. We seed a single Untitled section containing
// every scraped photo, hero flagged. The user can rename / split
// the section later. Without this, scraped properties show their
// old gallery_sections rows in the Gallery tab even though the
// flat gallery_images column is fresh.
const allPhotos = [
  ...(heroImageUrl ? [{ url: heroImageUrl, is_hero: true }] : []),
  ...galleryImages.map(u => ({ url: u, is_hero: false })),
];
const gallerySections = allPhotos.length > 0 ? [{
  id: randomUUID(),
  name: '',
  sort_order: 0,
  photos: allPhotos.map((p, i) => ({
    id: randomUUID(),
    url: p.url,
    caption: '',
    is_hero: p.is_hero,
    is_visible: true,
    sort_order: i,
  })),
}] : [];

const update = {
  tagline: title,
  description,
  sleeps,
  bedrooms: bedrooms || undefined,
  bathrooms: bathrooms || undefined,
  hero_image_url: heroImageUrl,
  gallery_images: galleryImages,
  gallery_sections: gallerySections,
  amenity_tags: amenityNames,
  booking_url: cleanBookingUrl,
  listing_links: [{ url: cleanBookingUrl, label: 'View on Airbnb', platform: 'Airbnb' }],
  city: city || undefined,
  province: province || undefined,
  suburb: suburb || undefined,
  external_rating: externalRating,
  external_rating_source: externalRating ? 'Airbnb' : undefined,
  availability_status: 'available',
  is_published: true,
  updated_at: new Date().toISOString(),
};
// Drop undefined keys so we don't clobber existing values with NULL.
for (const k of Object.keys(update)) if (update[k] === undefined) delete update[k];

const { error } = await supabase
  .from('partner_properties')
  .update(update)
  .eq('id', propertyId);
if (error) { console.error('update failed:', error.message); process.exit(1); }
console.log('\n✅ updated partner_properties row', propertyId);
