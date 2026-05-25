/**
 * buildAgentSnapshot — programmatic pricing snapshot for an agent
 * enquiry's auto-created proposals.
 *
 * The New Enquiry form (agent mode) lets Hayley pick one or more
 * specific properties the agent is enquiring about. On save, the form
 * calls this helper once per property to compute the same snapshot a
 * user would land on if they ran the manual flow (NewProposalLauncher
 * → PricingDashboard for the same property) with no overrides.
 *
 * Defaults mirror the PricingDashboard's initial state:
 *   - scenario = 'agent'
 *   - baseline = baselines table for property + current year
 *   - season   = inferred from check_in's MM-DD against partner seasons
 *                (or 'peak' fallback when there's no match / no date)
 *   - CTR pct  = CTR_DEFAULT.agent
 *   - agent pct= agents.default_commission_pct (or GENERIC_AGENT_PCT)
 *   - no overrides, no negotiation, no platform fees
 *
 * Returns the snapshot in the same shape the CreateProposalModal /
 * PricingModal `handleSavePricing` paths use, so downstream insert code
 * can be reused without divergence.
 */

import { calculatePricing, CTR_DEFAULT } from './pricingEngine';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';

const GENERIC_AGENT_PCT = 15;

interface SeasonRow {
  id: string;
  key: string;
  name: string;
  multiplier: number | string;
  date_ranges: Array<{ start: string; end: string }>;
  sort_order: number;
}

interface BaselineRow {
  property_id: string;
  year: number;
  daily_rate: number | string;
}

interface AgentRow {
  id: string;
  default_commission_pct?: number | string | null;
}

export interface AutoSnapshot {
  propertyId: string;
  scenarioType: 'agent';
  agentId: string;
  agents: Array<{ id: string; pct: number }>;
  channelId: null;
  baseline: number;
  totalMarginPct: number;
  ctrPct: number;
  agentPct: number;
  reducedBaseline: null;
  reducedCtrPct: null;
  reducedAgentPct: null;
  seasonTag: string;
  seasonMultiplier: number;
  breakdown: {
    ownerNet: number;
    ctrTake: number;
    clientPriceExclVat: number;
  };
}

/** Match check_in (YYYY-MM-DD) against the season whose date_ranges
 *  (MM-DD) include it. Handles year-wrapping ranges like winter
 *  (12-01 → 02-28). Returns the season row or null. */
function seasonForDate(seasons: SeasonRow[], checkIn: string | null | undefined): SeasonRow | null {
  if (!checkIn) return null;
  const mmdd = checkIn.slice(5); // YYYY-MM-DD → MM-DD
  for (const s of seasons) {
    for (const r of s.date_ranges || []) {
      if (!r.start || !r.end) continue;
      if (r.start <= r.end) {
        if (mmdd >= r.start && mmdd <= r.end) return s;
      } else {
        // Wrap-around range (e.g. 12-01 → 02-28).
        if (mmdd >= r.start || mmdd <= r.end) return s;
      }
    }
  }
  return null;
}

export async function buildAgentSnapshot(
  supabase: any,
  args: { propertyId: string; agentId: string; checkIn: string | null },
): Promise<AutoSnapshot | null> {
  const { propertyId, agentId, checkIn } = args;
  const year = new Date().getFullYear();

  const [baselineRes, seasonRes, agentRes] = await Promise.all([
    supabase.from('baselines').select('*').eq('property_id', propertyId).eq('year', year).maybeSingle(),
    supabase.from('seasons').select('id, key, name, multiplier, date_ranges, sort_order').eq('partner_id', CT_RENTALS_PARTNER_ID).order('sort_order'),
    supabase.from('agents').select('id, default_commission_pct').eq('id', agentId).maybeSingle(),
  ]);

  const baselineRow = baselineRes.data as BaselineRow | null;
  if (!baselineRow) return null; // no baseline → can't price

  const baseline = Number(baselineRow.daily_rate) || 0;
  if (baseline <= 0) return null;

  const seasons = (seasonRes.data as SeasonRow[] | null) || [];
  const seasonRow = seasonForDate(seasons, checkIn) || seasons.find(s => s.key === 'peak') || seasons[0] || null;
  const seasonMultiplier = seasonRow ? Number(seasonRow.multiplier) : 1;
  const seasonTag = seasonRow?.name || 'peak';

  const agentRow = agentRes.data as AgentRow | null;
  const agentPct = agentRow?.default_commission_pct != null
    ? Number(agentRow.default_commission_pct)
    : GENERIC_AGENT_PCT;
  const ctrPct = CTR_DEFAULT.agent;

  const breakdown = calculatePricing({
    baseline,
    scenarioType: 'agent',
    ctrPct,
    agentPct,
    seasonMultiplier,
    platformFeePct: 0,
    platformFixedFee: 0,
    reducedBaseline: null,
    reducedCtrPct: null,
    reducedAgentPct: null,
    solveFor: 'guest',
    targetGuestPrice: null,
    vatEnabled: false,
    vatRatePct: 0,
  } as any);

  return {
    propertyId,
    scenarioType: 'agent',
    agentId,
    agents: [{ id: agentId, pct: agentPct }],
    channelId: null,
    baseline,
    totalMarginPct: ctrPct + agentPct,
    ctrPct,
    agentPct,
    reducedBaseline: null,
    reducedCtrPct: null,
    reducedAgentPct: null,
    seasonTag,
    seasonMultiplier,
    breakdown: {
      ownerNet: breakdown.ownerNet,
      ctrTake: breakdown.ctrTake,
      clientPriceExclVat: breakdown.clientPriceExclVat,
    },
  };
}
