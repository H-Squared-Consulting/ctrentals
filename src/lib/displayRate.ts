/**
 * displayRate — the single shared helper for "what direct rate
 * do we show on a property card?"
 *
 * Mirrors what /price-list (the Price List page) shows in its
 * Direct column for the peak season, so the per-property pricing
 * displayed on the Properties grid, the search-results modal,
 * and any future card surface always reads as the same number
 * the team sees on the canonical Price List.
 *
 * Two modes:
 *   - system pricing → peak-season direct = directGuestRate(baseline)
 *   - fixed pricing  → peak-season direct = property_fixed_rates.guest_rate
 *
 * The caller pre-fetches the supporting rows (baseline + the peak
 * fixed-rate row, when applicable) and passes them in; this is a
 * pure function so the math is testable and never drifts from
 * Price List's logic.
 */
import { directGuestRate, agentGuestRate, platformListPrice } from './pricingEngine';
import type { SearchChannel } from '../components/GlobalSearchModal';

/** Representative platform fee used by the search result card
 *  when the user picked Platform channel. Same number the price-
 *  tier classifier uses, so the chip's R-range and the card's
 *  R-amount line up. */
const FILTER_PLATFORM_FEE_PCT = 15;

interface RateInputs {
  pricingMode?: string | null;
  /** Owner baseline daily rate (peak) — used in system mode. */
  baselineDailyRate?: number | null;
  /** property_fixed_rates.guest_rate for THIS property's peak
   *  season, current year — used in fixed mode. */
  fixedPeakGuestRate?: number | null;
}

/** Peak-season DIRECT guest rate. Returns the same number the
 *  Price List page shows in its Direct column for this property,
 *  or null when neither a baseline nor a fixed peak rate is on
 *  file. */
export function peakDirectGuestRate(inputs: RateInputs): number | null {
  if (inputs.pricingMode === 'fixed') {
    const r = inputs.fixedPeakGuestRate;
    return r != null && Number.isFinite(r) && r > 0 ? r : null;
  }
  const b = inputs.baselineDailyRate;
  if (b == null || !Number.isFinite(b) || b <= 0) return null;
  return directGuestRate(b);
}

/** Peak-season guest rate for a specific channel. Used by the
 *  search-result card so the displayed R-amount matches the tier
 *  the user filtered by. Fixed-mode properties: Direct uses the
 *  fixed guest rate; Agent / Platform fall back to that same
 *  number (Price List shows '—' for fixed-mode agent/platform —
 *  surfacing the direct figure is the least-bad alternative on a
 *  result card where every row needs a number to stay scannable). */
export function peakGuestRateForChannel(
  inputs: RateInputs,
  channel: SearchChannel,
): number | null {
  const direct = peakDirectGuestRate(inputs);
  if (direct == null) return null;
  if (inputs.pricingMode === 'fixed') return direct;
  // System mode: re-derive from baseline using the canonical
  // engine helpers so the channel-specific math is identical to
  // what PricingDashboard would produce for a per-deal quote.
  const baseline = inputs.baselineDailyRate as number;
  switch (channel) {
    case 'direct':   return direct;
    case 'agent':    return agentGuestRate(baseline);
    case 'platform': return platformListPrice(direct, FILTER_PLATFORM_FEE_PCT, 0);
  }
}
