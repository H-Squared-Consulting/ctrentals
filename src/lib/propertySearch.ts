/**
 * propertySearch -- shared property search query for the global
 * search modal + the dedicated results page.
 *
 * Mirrors the fetch shape used by EnquiryPropertyMatchModal so a
 * filter result from the global search matches what the team
 * would see in the enquiry match flow — same source of truth,
 * same overlap predicate, same baseline lookup, no surprises.
 *
 * Filters are all optional and independent; an empty filter set
 * returns every published, non-archived property on the partner.
 */
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import type { SearchChannel } from '../components/GlobalSearchModal';
import {
  fetchPriceTiers,
  computeDefaultTiers,
  selectedTierRange,
  guestPaysPeak,
  type TierKey,
} from './priceTiers';

export interface PropertySearchFilters {
  /** Free-text query — OR-matches against property_name, suburb, city. */
  query?: string;
  /** Exact-match bedroom counts. Empty = no bedroom filter. */
  bedrooms?: number[];
  /** Exact-match sleeps counts. Same shape + semantics as
   *  `bedrooms` — multi-select with `.in()`. Empty = no sleeps filter. */
  sleeps?: number[];
  /** Amenities the property must have. Substring-matched against
   *  the amenity_tags text column case-insensitively, AND'd
   *  across the list ("pool AND jacuzzi"). */
  amenities?: string[];
  /** Inclusive date range. When both are set, drops any property
   *  with an overlapping non-cancelled booking. */
  checkIn?: string;
  checkOut?: string;
  /** Which side of the deal is the team searching for? Picks
   *  whose pricing maths to apply when converting each property's
   *  baseline into a "guest pays at peak" figure for the tier
   *  comparison below. Required when `priceTier` is set. */
  channel?: SearchChannel;
  /** Selected price tier band(s). Multi-select — the filter
   *  surfaces every property whose peak-season guest-pays rate
   *  (for the chosen channel) falls between the floor of the
   *  lowest selected tier and the ceiling of the highest
   *  selected tier (so non-contiguous picks silently expand to
   *  the contiguous span). Omitted/empty = no price filter. */
  priceTiers?: TierKey[];
  /** Hard-restrict the result to this exact set of property IDs.
   *  Used by the agent-portal flow where the agent has already
   *  named the houses they want quoted — the search returns ONLY
   *  those rows (still subject to availability) and skips
   *  bedrooms entirely so a 5-bed pick isn't excluded by a 4-bed
   *  filter the team didn't set on the agent's behalf. */
  restrictToIds?: string[] | null;
}

export interface PropertyResult {
  id: string;
  name: string;
  suburb: string | null;
  city: string | null;
  bedrooms: number | null;
  sleeps: number | null;
  bathrooms: number | null;
  heroImageUrl: string | null;
  slug: string | null;
  tagline: string | null;
  /** Comma-separated tags string as stored on the DB. Surfaces
   *  for downstream display; the search itself substring-matches
   *  internally. */
  amenityTags: string;
  /** Per-night baseline rate for the current year, in ZAR. Null
   *  when no baseline is on file. System-mode properties only —
   *  fixed-mode properties carry no baseline. */
  dailyRate: number | null;
  /** Pricing mode — 'system' (baseline-driven) or 'fixed'
   *  (property_fixed_rates carries the rate directly). Drives
   *  which source a card displays as "guest pays". */
  pricingMode: 'system' | 'fixed' | null;
  /** Peak-season property_fixed_rates.guest_rate for the current
   *  year — only populated for fixed-mode properties. */
  fixedPeakGuestRate: number | null;
  /** External Airbnb listing URL extracted from listing_urls.airbnb.
   *  Surfaced so the global search "Copy Airbnb links" action can
   *  hand the team a paste-ready block when replying to an Airbnb
   *  enquiry. Null when the property isn't listed on Airbnb. */
  airbnbUrl: string | null;
  /** Cached Airbnb listing headline ("Spacious 4 Bed Retreat with
   *  Stunning Views") populated by the fetch-airbnb-title edge
   *  function on property save. Used in front of each URL in the
   *  Copy Airbnb links preview so the guest sees the listing's own
   *  title instead of our internal property name. Falls back to
   *  property_name when the fetch hasn't completed yet. */
  airbnbTitle: string | null;
}

export async function searchProperties(
  supabase: any,
  filters: PropertySearchFilters,
): Promise<PropertyResult[]> {
  const f = filters || {};
  const datesValid = !!(f.checkIn && f.checkOut && f.checkIn < f.checkOut);
  const year = new Date().getFullYear();

  const restrictMode = !!(f.restrictToIds && f.restrictToIds.length > 0);
  let propsQuery = supabase
    .from('partner_properties')
    .select('id, slug, property_name, tagline, suburb, city, bedrooms, bathrooms, sleeps, hero_image_url, amenity_tags, is_published, is_archived, pricing_mode, listing_urls, airbnb_title')
    .eq('partner_id', CT_RENTALS_PARTNER_ID)
    .eq('is_published', true)
    .order('property_name');
  if (restrictMode) {
    // Restrict path overrides every other property-shape filter.
    // The caller has named the exact houses; bedroom / text /
    // amenity narrowing on top would just confuse the result.
    propsQuery = propsQuery.in('id', f.restrictToIds as string[]);
  } else {
    if (f.bedrooms && f.bedrooms.length > 0) {
      propsQuery = propsQuery.in('bedrooms', f.bedrooms);
    }
    if (f.sleeps && f.sleeps.length > 0) {
      propsQuery = propsQuery.in('sleeps', f.sleeps);
    }
  }
  if (!restrictMode && f.query && f.query.trim()) {
    // Strip characters that break PostgREST's .or() syntax
    // (parens / commas) before substitution. Wildcard both sides
    // so a mid-word match still hits ("swyk" → "Zwaanswyk").
    const safe = f.query.trim().replace(/[,()]/g, ' ');
    propsQuery = propsQuery.or(
      `property_name.ilike.%${safe}%,suburb.ilike.%${safe}%,city.ilike.%${safe}%`,
    );
  }

  const bookingsQuery = datesValid
    ? supabase
        .from('bookings')
        .select('property_id, status')
        .lt('check_in', f.checkOut)
        .gt('check_out', f.checkIn)
    : Promise.resolve({ data: [] as Array<{ property_id: string; status: string }> });

  const baselinesQuery = supabase
    .from('baselines')
    .select('property_id, year, daily_rate')
    .eq('year', year);

  // Fixed-mode properties carry their peak guest rate in
  // property_fixed_rates, not the baseline table. We resolve the
  // Peak season id first, then fetch every property's fixed peak
  // guest_rate so the result cards can show the same Direct
  // number /price-list shows. Both queries fire in parallel with
  // everything else; no extra round trips for the common case.
  const seasonsQuery = supabase
    .from('seasons')
    .select('id, key')
    .eq('partner_id', CT_RENTALS_PARTNER_ID);

  const [propRes, bookingsRes, baselinesRes, seasonsRes] = await Promise.all([
    propsQuery,
    bookingsQuery,
    baselinesQuery,
    seasonsQuery,
  ]);

  const peakSeasonId = ((seasonsRes as any).data || []).find((s: any) => s.key === 'peak')?.id ?? null;
  const fixedRes = peakSeasonId
    ? await supabase
        .from('property_fixed_rates')
        .select('property_id, guest_rate')
        .eq('year', year)
        .eq('season_id', peakSeasonId)
    : { data: [] as Array<{ property_id: string; guest_rate: number }> };

  if (propRes.error) throw propRes.error;
  const props = (propRes.data || []).filter((p: any) => !p.is_archived);

  const busyIds = new Set(
    ((bookingsRes as any).data || [])
      .filter((b: any) => b.status !== 'cancelled')
      .map((b: any) => b.property_id),
  );
  const dateFiltered = datesValid
    ? props.filter((p: any) => !busyIds.has(p.id))
    : props;

  const amenityFiltered = (!f.amenities || f.amenities.length === 0)
    ? dateFiltered
    : dateFiltered.filter((p: any) => {
        const raw = (p.amenity_tags || '');
        const haystack = (Array.isArray(raw) ? raw.join(',') : String(raw)).toLowerCase();
        return f.amenities!.every(a => haystack.includes(a.toLowerCase()));
      });

  const baselineByProperty = new Map<string, number>();
  for (const b of ((baselinesRes as any).data || []) as Array<{ property_id: string; daily_rate: number | string }>) {
    const rate = Number(b.daily_rate);
    if (Number.isFinite(rate) && rate > 0) baselineByProperty.set(b.property_id, rate);
  }
  const fixedPeakByProperty = new Map<string, number>();
  for (const f of ((fixedRes as any).data || []) as Array<{ property_id: string; guest_rate: number | string }>) {
    const rate = Number(f.guest_rate);
    if (Number.isFinite(rate) && rate > 0) fixedPeakByProperty.set(f.property_id, rate);
  }

  // Tier-based price filter — single source of truth for "what
  // budget did the guest ask for". Multi-select: the floor of the
  // lowest selected tier becomes the lower bound, the ceiling of
  // the highest becomes the upper bound. Gaps in the selection
  // are auto-filled (Very low + High silently means "Very low
  // through High"). Properties without a baseline are excluded —
  // we can't say which band they're in, and the user asked for
  // unpriced stock to be dropped rather than leaked into every
  // tier's result set. Missing channel = no-op (UI gates this).
  let priceFiltered = amenityFiltered;
  if (f.priceTiers && f.priceTiers.length > 0 && f.channel) {
    const saved = await fetchPriceTiers(supabase);
    const tiers = saved.get(f.channel) ?? await computeDefaultTiers(supabase, f.channel);
    const range = selectedTierRange(f.priceTiers, tiers);
    if (range) {
      const channel = f.channel;
      priceFiltered = priceFiltered.filter((p: any) => {
        // Fixed-mode properties carry their guest rate directly
        // on property_fixed_rates; system-mode go through the
        // canonical channel uplift. Either source feeds into the
        // tier range check.
        const isFixed = p.pricing_mode === 'fixed';
        let guestPays: number | null = null;
        if (isFixed) {
          guestPays = fixedPeakByProperty.get(p.id) ?? null;
        } else {
          const baseline = baselineByProperty.get(p.id);
          if (baseline != null) guestPays = guestPaysPeak(baseline, channel);
        }
        if (guestPays == null) return false;
        if (range.floor   != null && guestPays <= range.floor)   return false;
        if (range.ceiling != null && guestPays >  range.ceiling) return false;
        return true;
      });
    }
  }

  return priceFiltered.map((p: any) => ({
    id: p.id,
    name: p.property_name || '',
    suburb: p.suburb || null,
    city: p.city || null,
    bedrooms: p.bedrooms ?? null,
    sleeps: p.sleeps ?? null,
    bathrooms: p.bathrooms ?? null,
    heroImageUrl: p.hero_image_url || null,
    slug: p.slug || null,
    tagline: p.tagline || null,
    amenityTags: typeof p.amenity_tags === 'string'
      ? p.amenity_tags
      : Array.isArray(p.amenity_tags)
        ? p.amenity_tags.join(', ')
        : '',
    dailyRate: baselineByProperty.get(p.id) ?? null,
    pricingMode: (p.pricing_mode === 'fixed' || p.pricing_mode === 'system') ? p.pricing_mode : null,
    fixedPeakGuestRate: fixedPeakByProperty.get(p.id) ?? null,
    airbnbUrl: (p.listing_urls && typeof p.listing_urls === 'object' && typeof p.listing_urls.airbnb === 'string')
      ? (p.listing_urls.airbnb.trim() || null)
      : null,
    airbnbTitle: (typeof p.airbnb_title === 'string' && p.airbnb_title.trim())
      ? p.airbnb_title.trim()
      : null,
  }));
}
