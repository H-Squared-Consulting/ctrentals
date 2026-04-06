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

export interface SeasonTag {
  id: string;
  property_id: string | null;
  name: string;
  start_date: string;
  end_date: string;
  multiplier: number;
  created_at: string;
}

export interface Agent {
  id: string;
  name: string;
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

export interface PricingProposal {
  id: string;
  property_id: string;
  scenario_type: 'direct' | 'agent' | 'platform';
  agent_id: string | null;
  channel_profile_id: string | null;
  baseline_used: number;
  baseline_mode: 'daily' | 'monthly';
  season_tag: string | null;
  season_multiplier: number;
  calc_method: 'margin' | 'markup';
  commission_pct: number;
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
}

export interface VatSettings {
  id: string;
  vat_enabled: boolean;
  vat_rate_pct: number;
  updated_at: string;
}

// ---- Pricing Engine Calculation ----

export interface PricingInputs {
  baseline: number;
  baselineMode: 'daily' | 'monthly';
  scenarioType: 'direct' | 'agent' | 'platform';
  calcMethod: 'margin' | 'markup';
  commissionPct: number;
  seasonMultiplier: number;
  platformFeePct: number;
  platformFixedFee: number;
  reducedBaseline: number | null;
  reducedCommission: number | null;
  vatEnabled: boolean;
  vatRatePct: number;
}

export interface PricingBreakdown {
  ownerNet: number;
  companyTake: number;
  clientPriceExclVat: number;
  vatAmount: number;
  clientPriceInclVat: number;
}
