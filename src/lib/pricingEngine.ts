import type { PricingInputs, PricingBreakdown } from '../types/pricing';

/**
 * Pure pricing calculation — no side effects, no Supabase calls.
 * Takes inputs and returns a full breakdown.
 */
export function calculatePricing(inputs: PricingInputs): PricingBreakdown {
  const {
    baseline,
    scenarioType,
    calcMethod,
    commissionPct,
    seasonMultiplier,
    platformFeePct,
    platformFixedFee,
    reducedBaseline,
    reducedCommission,
    vatEnabled,
    vatRatePct,
  } = inputs;

  // 1. Use reduced baseline if provided, otherwise use the standard baseline
  const effectiveBaseline = reducedBaseline !== null && reducedBaseline >= 0
    ? reducedBaseline
    : baseline;

  // 2. Apply season multiplier
  const adjustedBaseline = round2(effectiveBaseline * seasonMultiplier);

  // 3. Determine effective commission
  const effectiveCommission = reducedCommission !== null && reducedCommission >= 0
    ? reducedCommission
    : commissionPct;

  // 4. Calculate client price excl VAT based on calc method
  let clientPriceExclVat: number;

  if (effectiveCommission <= 0) {
    clientPriceExclVat = adjustedBaseline;
  } else if (calcMethod === 'margin') {
    // Margin: commission is a percentage of the final price
    // clientPrice = baseline / (1 - commission/100)
    const divisor = 1 - effectiveCommission / 100;
    clientPriceExclVat = divisor > 0 ? round2(adjustedBaseline / divisor) : adjustedBaseline;
  } else {
    // Markup: commission is added on top of baseline
    // clientPrice = baseline * (1 + commission/100)
    clientPriceExclVat = round2(adjustedBaseline * (1 + effectiveCommission / 100));
  }

  // 5. Platform fees (only for platform scenario)
  let platformFees = 0;
  if (scenarioType === 'platform') {
    platformFees = round2(clientPriceExclVat * (platformFeePct / 100) + platformFixedFee);
    clientPriceExclVat = round2(clientPriceExclVat + platformFees);
  }

  // 6. Owner net is the adjusted baseline (what the owner receives)
  const ownerNet = adjustedBaseline;

  // 7. Company take = what's left after owner and platform
  const companyTake = round2(clientPriceExclVat - ownerNet - platformFees);

  // 8. VAT calculation
  const vatAmount = vatEnabled ? round2(clientPriceExclVat * (vatRatePct / 100)) : 0;

  // 9. Final client price
  const clientPriceInclVat = round2(clientPriceExclVat + vatAmount);

  return {
    ownerNet,
    companyTake,
    clientPriceExclVat,
    vatAmount,
    clientPriceInclVat,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
