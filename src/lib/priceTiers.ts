/**
 * priceTiers — source of truth for the 5-tier price-bucket filter
 * (Very low / Low / Medium / High / Very high).
 *
 * Tiers live per (partner_id, channel). Each (channel) row stores
 * four upper-bound thresholds:
 *
 *      Very low ≤ t1 < Low ≤ t2 < Medium ≤ t3 < High ≤ t4 < Very high
 *
 * The "guest pays" rate at peak season for the given channel is
 * what each threshold is measured against — we deliberately
 * compare to the always-most-expensive figure so the user's
 * "I can afford up to Medium" choice surfaces only houses they
 * can genuinely afford in any week of the year.
 *
 * Defaults are auto-computed as quintile boundaries of the current
 * inventory the first time the settings page renders them. The
 * admin can then nudge each value and save — once saved, the
 * stored numbers win until the admin recalculates again.
 */

import type { SearchChannel } from '../components/GlobalSearchModal';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import { directGuestRate, agentGuestRate, platformListPrice } from './pricingEngine';

export interface TierThresholds {
  /** Upper bound of the "Very low" tier (per-night ZAR, guest pays). */
  t1: number;
  /** Upper bound of "Low". */
  t2: number;
  /** Upper bound of "Medium". */
  t3: number;
  /** Upper bound of "High". Above t4 = "Very high" (no upper bound). */
  t4: number;
}

export type TierKey = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';

export const TIER_ORDER: TierKey[] = ['very_low', 'low', 'medium', 'high', 'very_high'];

export const TIER_LABELS: Record<TierKey, string> = {
  very_low:  'Very low',
  low:       'Low',
  medium:    'Medium',
  high:      'High',
  very_high: 'Very high',
};

/** Peak-season multiplier applied to the annual baseline.
 *  baseline.daily_rate IS the peak owner rate per the settings
 *  page ("Peak = Owner's Normal Base Rate"); kept as an explicit
 *  constant so the formula self-documents and survives a future
 *  change to the partner's peak multiplier. */
export const PEAK_MULTIPLIER = 1.0;

/** Representative platform fee used by the SEARCH filter (and the
 *  defaults derivation) when classifying properties for the
 *  Platform channel tier. Per-platform configuration lives in
 *  channel_defaults; the filter has to pick a single number to
 *  classify each property since "platform" isn't tied to a
 *  specific channel here. 15% is a reasonable mid-point between
 *  Airbnb's effective net (~14%) and Booking.com's (~15%); admin
 *  can shift tier boundaries in settings if needed. */
const FILTER_PLATFORM_FEE_PCT = 15;

/** Compute the "guest pays at peak" rate for a property under a
 *  given channel — uses the canonical pricingEngine helpers so
 *  the figure is identical to what PricingModal shows for a
 *  per-deal quote against the same baseline. Single source of
 *  truth shared by the filter math, the result-card display, and
 *  the default-tier derivation; never compute this in two places. */
export function guestPaysPeak(
  baselineDailyRate: number | null | undefined,
  channel: SearchChannel,
): number | null {
  if (baselineDailyRate == null || !Number.isFinite(baselineDailyRate) || baselineDailyRate <= 0) {
    return null;
  }
  const peakBase = baselineDailyRate * PEAK_MULTIPLIER;
  switch (channel) {
    case 'direct':   return directGuestRate(peakBase);
    case 'agent':    return agentGuestRate(peakBase);
    case 'platform': return platformListPrice(directGuestRate(peakBase), FILTER_PLATFORM_FEE_PCT, 0);
  }
}

export interface PriceTierRow {
  channel: SearchChannel;
  thresholds: TierThresholds;
}

/** Fetch saved tiers for a partner. Returns a Map keyed by channel.
 *  Channels with no row are absent — caller should fall back to
 *  computed defaults. */
// ─── Module-level cache ──────────────────────────────────────
// Tier thresholds rarely change — the admin tunes them on the
// settings page and otherwise they sit still for weeks. The
// global search, enquiry form, and deal modal ALL read these
// numbers when their price filter mounts, often several times
// per session. Cache the most recent fetch (+ derived defaults
// per channel) at the module level so re-opens are instant.
// `invalidatePriceTiersCache()` is called after a save so the
// next read picks up the fresh numbers.

let _cachedTiersPromise: Promise<Map<SearchChannel, TierThresholds>> | null = null;
const _defaultsCache: Map<SearchChannel, Promise<TierThresholds>> = new Map();

export function invalidatePriceTiersCache(): void {
  _cachedTiersPromise = null;
  _defaultsCache.clear();
}

export async function fetchPriceTiers(
  supabase: any,
  partnerId: string = CT_RENTALS_PARTNER_ID,
): Promise<Map<SearchChannel, TierThresholds>> {
  if (_cachedTiersPromise) return _cachedTiersPromise;
  _cachedTiersPromise = fetchPriceTiersUncached(supabase, partnerId).catch(err => {
    // Don't poison the cache on transient failures — next call
    // gets a fresh attempt.
    _cachedTiersPromise = null;
    throw err;
  });
  return _cachedTiersPromise;
}

async function fetchPriceTiersUncached(
  supabase: any,
  partnerId: string,
): Promise<Map<SearchChannel, TierThresholds>> {
  const { data, error } = await supabase
    .from('price_tiers')
    .select('channel, threshold_1, threshold_2, threshold_3, threshold_4')
    .eq('partner_id', partnerId);
  // Tolerate the table not existing yet — fresh checkouts won't
  // have the migration applied. Return an empty Map and let
  // callers fall back to computed defaults; the save path will
  // still surface a real error if the table is genuinely missing
  // when the admin tries to persist.
  if (error) {
    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes('schema cache') || msg.includes('does not exist')) {
      console.warn('price_tiers table not found yet — falling back to defaults. Apply the migration to enable persistence.');
      return new Map();
    }
    throw error;
  }
  const map = new Map<SearchChannel, TierThresholds>();
  for (const row of (data || [])) {
    map.set(row.channel as SearchChannel, {
      t1: Number(row.threshold_1),
      t2: Number(row.threshold_2),
      t3: Number(row.threshold_3),
      t4: Number(row.threshold_4),
    });
  }
  return map;
}

/** Upsert a single channel's tier thresholds. */
export async function savePriceTiers(
  supabase: any,
  channel: SearchChannel,
  thresholds: TierThresholds,
  partnerId: string = CT_RENTALS_PARTNER_ID,
): Promise<void> {
  // Round the persisted numbers — partial-rand thresholds add
  // noise without changing behaviour, and the DB check constraint
  // enforces strict ordering so we sanity-check here too.
  const t1 = Math.round(thresholds.t1);
  const t2 = Math.round(thresholds.t2);
  const t3 = Math.round(thresholds.t3);
  const t4 = Math.round(thresholds.t4);
  if (!(t1 < t2 && t2 < t3 && t3 < t4)) {
    throw new Error('Thresholds must be strictly ascending.');
  }
  const { error } = await supabase
    .from('price_tiers')
    .upsert({
      partner_id:  partnerId,
      channel,
      threshold_1: t1,
      threshold_2: t2,
      threshold_3: t3,
      threshold_4: t4,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'partner_id,channel' });
  if (error) throw error;
  // Drop the read-side cache so the next consumer (search modal,
  // enquiry form, deal modal) picks up the freshly-saved numbers
  // instead of the stale set.
  invalidatePriceTiersCache();
}

/** Compute default thresholds for one channel from the current
 *  inventory's peak-season guest-pays distribution. Returns the
 *  four quintile boundaries (20/40/60/80th percentiles), rounded
 *  to whole rands. Falls back to a fixed coarse ramp if the
 *  inventory has fewer than 5 priced properties. */
export async function computeDefaultTiers(
  supabase: any,
  channel: SearchChannel,
  partnerId: string = CT_RENTALS_PARTNER_ID,
): Promise<TierThresholds> {
  const cached = _defaultsCache.get(channel);
  if (cached) return cached;
  const p = computeDefaultTiersUncached(supabase, channel, partnerId).catch(err => {
    _defaultsCache.delete(channel);
    throw err;
  });
  _defaultsCache.set(channel, p);
  return p;
}

async function computeDefaultTiersUncached(
  supabase: any,
  channel: SearchChannel,
  partnerId: string = CT_RENTALS_PARTNER_ID,
): Promise<TierThresholds> {
  const year = new Date().getFullYear();
  const { data, error } = await supabase
    .from('baselines')
    .select('property_id, daily_rate')
    .eq('year', year);
  if (error) throw error;
  // Use the same guestPaysPeak() the filter and result card use,
  // so the tier boundaries the admin sees on the settings page
  // are computed off the same math the filter compares each
  // property against.
  const guestPaysRates = (data || [])
    .map((b: any) => Number(b.daily_rate))
    .map((n: number) => guestPaysPeak(n, channel))
    .filter((n: number | null): n is number => n != null)
    .sort((a: number, b: number) => a - b);

  if (guestPaysRates.length < 5) {
    // Fallback ramp — small inventories don't have a useful
    // distribution, so seed with order-of-magnitude defaults the
    // admin will overwrite. Numbers chosen as a rough fit for CT
    // Rentals' historical price points; admin gets to override
    // immediately so they don't have to live with these.
    return { t1: 5_000, t2: 12_000, t3: 25_000, t4: 50_000 };
  }
  const pick = (pct: number) => {
    const idx = Math.min(guestPaysRates.length - 1, Math.floor((guestPaysRates.length - 1) * pct));
    return Math.round(guestPaysRates[idx]);
  };
  let t1 = pick(0.20);
  let t2 = pick(0.40);
  let t3 = pick(0.60);
  let t4 = pick(0.80);
  // Nudge equal-neighbour cases so the strict-ordering constraint
  // can never bite when default-derived (small inventories often
  // produce ties at the same quantile).
  if (t2 <= t1) t2 = t1 + 1;
  if (t3 <= t2) t3 = t2 + 1;
  if (t4 <= t3) t4 = t3 + 1;
  return { t1, t2, t3, t4 };
}

/** Classify a guest-pays rate into one of the five tier keys.
 *  Used by the filter math to test whether a property fits a
 *  user's chosen ceiling. Edges follow the schema: tier upper-
 *  bounds are inclusive on the lower side and exclusive at the
 *  next-tier boundary. */
export function classifyTier(guestPaysRate: number, t: TierThresholds): TierKey {
  if (guestPaysRate <= t.t1) return 'very_low';
  if (guestPaysRate <= t.t2) return 'low';
  if (guestPaysRate <= t.t3) return 'medium';
  if (guestPaysRate <= t.t4) return 'high';
  return 'very_high';
}

/** The upper-bound ZAR amount for a tier, used by the filter
 *  ceiling logic. Returns null for 'very_high' (unbounded). */
export function tierCeiling(tier: TierKey, t: TierThresholds): number | null {
  switch (tier) {
    case 'very_low':  return t.t1;
    case 'low':       return t.t2;
    case 'medium':    return t.t3;
    case 'high':      return t.t4;
    case 'very_high': return null;
  }
}

/** Lower bound for a tier. The search filter treats this as
 *  INCLUSIVE (a rate exactly on the boundary matches both
 *  adjacent tiers, mirroring the budget-button labels). Returns
 *  null for 'very_low' (no floor below it). */
export function tierFloor(tier: TierKey, t: TierThresholds): number | null {
  switch (tier) {
    case 'very_low':  return null;
    case 'low':       return t.t1;
    case 'medium':    return t.t2;
    case 'high':      return t.t3;
    case 'very_high': return t.t4;
  }
}

/** Convert a multi-select of tiers into a single (floor, ceiling)
 *  filter range. Per the spec: "min of lowest selected → max of
 *  highest selected" — so picking Very low + High auto-includes
 *  everything between (Low + Medium too). Empty selection returns
 *  null (no range filter). */
export function selectedTierRange(
  selected: TierKey[],
  t: TierThresholds,
): { floor: number | null; ceiling: number | null } | null {
  if (!selected || selected.length === 0) return null;
  // Find the indices of the lowest + highest selected tiers in
  // TIER_ORDER so we know which floor/ceiling to use even when
  // the caller passes an unsorted array.
  let lo = TIER_ORDER.length;
  let hi = -1;
  for (const tier of selected) {
    const idx = TIER_ORDER.indexOf(tier);
    if (idx < 0) continue;
    if (idx < lo) lo = idx;
    if (idx > hi) hi = idx;
  }
  if (hi < 0) return null;
  return {
    floor:   tierFloor(TIER_ORDER[lo],   t),
    ceiling: tierCeiling(TIER_ORDER[hi], t),
  };
}
