import type { PricingInputs, PricingBreakdown } from '../types/pricing';

// CTR's default cut per scenario. Stored as constants — the ladies can edit
// agent commissions via Settings → Agents, but CTR's own cut is structural
// and changes only via code.
export const CTR_DEFAULT = {
  direct: 20,
  platform: 20,
  agent: 15,
} as const;

/**
 * Pure pricing calculation — no side effects, no Supabase calls.
 *
 * Margin model: all margins are shares of the final guest rate. CTR + agent
 * commissions get summed into total margin and applied once to the base.
 *
 *   Guest = Base ÷ (1 - totalMargin%)
 *
 * Platform fees sit ON TOP of the guest rate, not inside the margin.
 *
 * Two solve modes:
 *   - 'guest' (default): user sets base + margins, engine computes guest rate.
 *   - 'base': user sets target guest rate + margins, engine computes required base.
 */
export function calculatePricing(inputs: PricingInputs): PricingBreakdown {
  const {
    baseline,
    scenarioType,
    ctrPct,
    agentPct,
    seasonMultiplier,
    platformFeePct,
    platformFixedFee,
    reducedBaseline,
    reducedCtrPct,
    reducedAgentPct,
    solveFor = 'guest',
    targetGuestPrice,
    vatEnabled,
    vatRatePct,
  } = inputs;

  // 1. Effective margins (overrides take precedence)
  const effCtrPct = reducedCtrPct !== null && reducedCtrPct >= 0 ? reducedCtrPct : ctrPct;
  const effAgentPct = scenarioType === 'agent'
    ? (reducedAgentPct !== null && reducedAgentPct >= 0 ? reducedAgentPct : agentPct)
    : 0;
  const totalMarginPct = effCtrPct + effAgentPct;
  const marginDivisor = 1 - totalMarginPct / 100;

  // 2. Decide flow
  let adjustedBaseline: number;
  let clientPriceExclVat: number;
  let platformFees = 0;

  if (solveFor === 'base' && targetGuestPrice != null && targetGuestPrice > 0) {
    // Reverse: given target guest rate, work out the base.
    let prePlatform = targetGuestPrice;
    if (scenarioType === 'platform') {
      // platform fee % + fixed fee sit on top of pre-platform price:
      //   guest = pre × (1 + feePct/100) + fixedFee
      //   → pre = (guest - fixedFee) / (1 + feePct/100)
      const feeMul = 1 + (platformFeePct / 100);
      prePlatform = feeMul > 0 ? (targetGuestPrice - platformFixedFee) / feeMul : targetGuestPrice;
      platformFees = targetGuestPrice - prePlatform;
    }
    adjustedBaseline = prePlatform * marginDivisor;
    clientPriceExclVat = targetGuestPrice;
  } else {
    // Forward: given base, compute guest rate.
    const effectiveBase = reducedBaseline !== null && reducedBaseline >= 0 ? reducedBaseline : baseline;
    adjustedBaseline = effectiveBase * seasonMultiplier;

    if (totalMarginPct <= 0) {
      clientPriceExclVat = adjustedBaseline;
    } else {
      clientPriceExclVat = marginDivisor > 0 ? adjustedBaseline / marginDivisor : adjustedBaseline;
    }

    if (scenarioType === 'platform') {
      platformFees = clientPriceExclVat * (platformFeePct / 100) + platformFixedFee;
      clientPriceExclVat = clientPriceExclVat + platformFees;
    }
  }

  // 3. Splits
  const ownerNet = adjustedBaseline;
  // Pre-platform guest portion (everything except the platform fee). Used to
  // split CTR vs. agent because their % is of the *pre-platform* guest rate.
  const prePlatformGuest = clientPriceExclVat - platformFees;
  const ctrTake = totalMarginPct > 0
    ? prePlatformGuest * (effCtrPct / 100)
    : 0;
  const agentTake = totalMarginPct > 0 && scenarioType === 'agent'
    ? prePlatformGuest * (effAgentPct / 100)
    : 0;
  // companyTake = CTR's earnings (kept for back-compat with existing schema).
  const companyTake = ctrTake;

  // 4. VAT
  const vatAmount = vatEnabled ? clientPriceExclVat * (vatRatePct / 100) : 0;
  const clientPriceInclVat = clientPriceExclVat + vatAmount;

  // 5. Effective margin/markup (display-only — what % CTR + agents actually
  // are of the guest rate, given any overrides). Markup is relative to base.
  const effectiveCtrMarginPct = clientPriceExclVat > 0
    ? (ctrTake / clientPriceExclVat) * 100
    : 0;
  const effectiveTotalMarkupPct = adjustedBaseline > 0
    ? ((clientPriceExclVat - adjustedBaseline) / adjustedBaseline) * 100
    : 0;

  return {
    ownerNet,
    companyTake,
    ctrTake,
    agentTake,
    platformFees,
    clientPriceExclVat,
    vatAmount,
    clientPriceInclVat,
    adjustedBaseline,
    totalMarginPct,
    effectiveCtrMarginPct,
    effectiveTotalMarkupPct,
  };
}

/** Display helper — round a number to the nearest rand. */
export function roundRand(n: number): number {
  return Math.round(n);
}

/** Format a rand value for display. Whole-rand precision, no cents. */
export function fmtRand(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`;
}
