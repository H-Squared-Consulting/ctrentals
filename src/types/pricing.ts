// ---- Pricing Engine Types ----

export interface Baseline {
  id: string;
  property_id: string;
  year: number;
  daily_rate: number;
  monthly_rate: number;
  locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  default_commission_pct: number;
  created_at: string;
}

export interface ChannelProfile {
  id: string;
  property_id: string;
  platform_name: string;
  platform_fee_pct: number;
  platform_fixed_fee: number;
  notes: string | null;
  created_at: string;
}

export type PricingProposalStatus = 'draft' | 'live' | 'accepted' | 'expired' | 'archived';

/**
 * Stored proposal snapshot. The DB columns are kept stable for back-compat:
 *
 *   - `commission_pct` is the TOTAL margin % used in the calc (CTR % + agent %
 *     for agent scenarios, CTR % alone otherwise).
 *   - `reduced_commission_pct` is the total-margin override.
 *   - `calc_method` and `baseline_mode` are legacy columns kept on existing
 *     rows; new rows always write `'margin'` / `'daily'` so the view doesn't
 *     break.
 */
/** Multi-agent split row stored on pricing_proposals.agents JSONB. */
export interface ProposalAgent {
  id: string;
  pct: number;
}

export interface PricingProposal {
  id: string;
  property_id: string;
  scenario_type: 'direct' | 'agent' | 'platform';
  /** Legacy single-agent reference. Kept for back-compat on rows written
   *  before multi-agent was added. New writes leave this NULL and use the
   *  `agents` array as the source of truth. */
  agent_id: string | null;
  /** Per-proposal agent split: each entry's pct is the effective commission
   *  for this proposal (defaults from Settings, optionally overridden). */
  agents: ProposalAgent[];
  channel_profile_id: string | null;
  baseline_used: number;
  baseline_mode: 'daily' | 'monthly';
  season_tag: string | null;
  season_multiplier: number;
  calc_method: 'margin' | 'markup';
  commission_pct: number;
  reduced_baseline: number | null;
  reduced_commission_pct: number | null;
  owner_net: number;
  company_take: number;
  client_price_excl_vat: number;
  vat_enabled: boolean;
  vat_rate_pct: number;
  vat_amount: number;
  client_price_incl_vat: number;
  status: PricingProposalStatus;
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  computed_status?: PricingProposalStatus;
  /** Number of sendable `proposals` rows that reference this snapshot. Populated
   *  when the snapshot list is loaded with the LEFT JOIN count. */
  sent_count?: number;
}

/** Sendable guest-facing proposal (the `proposals` table). */
export interface SendableProposal {
  id: string;
  ref_code: string;
  partner_id: string;
  enquiry_id: string | null;
  property_id: string;
  pricing_proposal_id: string | null;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  guest_nationality: string | null;
  guests_total: number;
  guests_adults: number | null;
  guests_children: number | null;
  check_in: string;
  check_out: string;
  budget_tiers: string[] | null;
  status: 'draft' | 'sent' | 'viewed' | 'interested' | 'expired';
  is_agent: boolean;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface VatSettings {
  id: string;
  vat_enabled: boolean;
  vat_rate_pct: number;
  updated_at: string;
}

// ---- Pricing Engine Calculation ----

/**
 * Inputs for the pricing engine.
 *
 *   - `ctrPct` is CTR's cut for the chosen scenario (e.g. 20% direct, 15% agent).
 *   - `agentPct` is the linked agent's commission, read live from Settings →
 *     Agents. Only used when `scenarioType === 'agent'`.
 *   - `solveFor`: 'guest' computes the guest rate from the base; 'base'
 *     computes the required base from a target guest rate.
 *   - Overrides (`reducedBaseline`, `reducedCtrPct`, `reducedAgentPct`) are
 *     concessions used for negotiation; null = no override.
 */
export interface PricingInputs {
  baseline: number;
  scenarioType: 'direct' | 'agent' | 'platform';
  ctrPct: number;
  agentPct: number;
  seasonMultiplier: number;
  platformFeePct: number;
  platformFixedFee: number;
  reducedBaseline: number | null;
  reducedCtrPct: number | null;
  reducedAgentPct: number | null;
  solveFor?: 'guest' | 'base';
  targetGuestPrice?: number | null;
  vatEnabled: boolean;
  vatRatePct: number;
}

export interface PricingBreakdown {
  ownerNet: number;
  /** Back-compat alias for ctrTake (used by the proposals table). */
  companyTake: number;
  ctrTake: number;
  agentTake: number;
  platformFees: number;
  clientPriceExclVat: number;
  vatAmount: number;
  clientPriceInclVat: number;
  adjustedBaseline: number;
  totalMarginPct: number;
  effectiveCtrMarginPct: number;
  effectiveTotalMarkupPct: number;
}
