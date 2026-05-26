/**
 * PricingDashboard — single-scenario pricing surface for a property.
 *
 * Built on the design system's existing classes. Two stacked panels:
 *
 *   1. BENCHMARK (top, read-only) — default pricing for the chosen
 *      channel + season. The anchor Mom negotiates against.
 *   2. NEGOTIATE (bottom, editable) — Guest target is the primary
 *      lever. Margin overrides shave CTR / agent share to absorb
 *      the gap. The result with deltas from benchmark renders inline
 *      so Mom sees exactly what she's giving up.
 *
 * Two visual states:
 *   State A — channel not chosen. Three big tap targets.
 *   State B — channel chosen. Benchmark + Negotiate panels.
 *
 * Handles both create-mode (no initialSnapshot) and edit-mode (snapshot
 * passed via initialSnapshot prop, hydrated into state). Replaces the
 * older PricingWidget for every pricing entry point in the app.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { calculatePricing, CTR_DEFAULT, fmtRand } from '../lib/pricingEngine';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import type { Baseline, Agent, ChannelProfile, PricingBreakdown, PricingProposal } from '../types/pricing';

// ─── New 4-tier seasons model (DB-backed, lives in `seasons` table) ─────
// Replaces the legacy free-form `season_tags`. Keys are fixed; dates +
// multiplier are editable on /settings/seasons. PricingDashboard reads
// the season for the picked tab, applies the per-property override if
// set, otherwise falls back to baseline × multiplier.
const SEASON_ORDER = ['peak', 'high', 'shoulder', 'winter'] as const;
type SeasonKey = typeof SEASON_ORDER[number];
interface SeasonRow {
  id: string;
  key: SeasonKey;
  name: string;
  multiplier: number;
  date_ranges: Array<{ start: string; end: string }>;
  sort_order: number;
}
interface OverrideRow {
  property_id: string;
  year: number;
  season_id: string;
  override_rate: number;
}
interface FixedRateRow {
  property_id: string;
  year: number;
  season_id: string;
  guest_rate: number | null;
  owner_rate: number | null;
}

/** Generic-agent commission default when no specific agent is picked. */
const GENERIC_AGENT_PCT = 15;

// ─── Pricing types ──────────────────────────────────────────────────────
// Live here (was in PricingWidget before its retirement) because this
// component is now the canonical pricing surface. CreateProposalModal,
// PricingModal etc. all import these from here.

export type ScenarioType = 'direct' | 'agent' | 'platform';
export type SolveMode = 'guest' | 'base';

export interface SnapshotAgent {
  id: string;
  pct: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
}

export interface PricingSnapshot {
  propertyId: string;
  scenarioType: ScenarioType;
  agentId: string | null;
  agents: SnapshotAgent[];
  agentContact: { name: string; email: string | null; phone: string | null; company: string | null } | null;
  channelId: string | null;
  baseline: number;
  seasonTag: string | null;
  seasonMultiplier: number;
  ctrPct: number;
  agentPct: number;
  platformFeePct: number;
  platformFixedFee: number;
  reducedBaseline: number | null;
  reducedCtrPct: number | null;
  reducedAgentPct: number | null;
  totalMarginPct: number;
  breakdown: PricingBreakdown;
}

/** Plain-text breakdown for Share Calc (WhatsApp / email). Exposed so
 *  hosts that handle a "share calc" action produce the same text shape. */
export function snapshotToText(snap: PricingSnapshot, propertyName: string): string {
  const b = snap.breakdown;
  const lines = [
    `${propertyName} — Pricing`,
    `Scenario: ${snap.scenarioType}`,
    snap.seasonTag ? `Season: ${snap.seasonTag} (×${snap.seasonMultiplier})` : null,
    `Base: ${fmtRand(snap.baseline * snap.seasonMultiplier)} / night`,
    `Owner nets: ${fmtRand(b.ownerNet)}`,
    `CTR earns: ${fmtRand(b.ctrTake)} (${b.effectiveCtrMarginPct.toFixed(1)}%)`,
    snap.scenarioType === 'agent' && b.agentTake > 0 ? `Agent earns: ${fmtRand(b.agentTake)} (${snap.agentPct}%)` : null,
    snap.scenarioType === 'platform' && b.platformFees > 0 ? `Platform fee: ${fmtRand(b.platformFees)} (${snap.platformFeePct}%)` : null,
    `Guest pays: ${fmtRand(b.clientPriceExclVat)} / night`,
  ];
  return lines.filter(Boolean).join('\n');
}

interface Props {
  property: { id: string; property_name: string };
  supabase: any;
  initialScenario?: ScenarioType;
  nights?: number;
  /** Edit-mode: existing pricing_proposal whose state hydrates the form. */
  initialSnapshot?: PricingProposal | null;
  /** Pre-select this agent in the agent dropdown when the user picks the
   *  agent scenario. Used when raising a proposal from an agent enquiry —
   *  the agent's already known, no need for the user to re-pick. */
  initialAgentId?: string | null;
  onCreateProposal?: (snapshot: PricingSnapshot) => void;
  actionLabel?: string;
  saving?: boolean;
  /** Lock the channel/scenario to whatever it was opened with. Hides
   *  the "· change" affordance on the channel pill so the user can
   *  edit pricing without accidentally switching a direct enquiry's
   *  quote into an agent / platform quote (which would also rewire
   *  the breakdown maths). Set by callers that already know the
   *  host context locks the scenario — e.g. editing pricing on a
   *  direct enquiry's existing proposal. */
  lockScenario?: boolean;
}

/**
 * One breakdown line — three columns: label (with optional inline %),
 * currency value (right-aligned), and delta (right-aligned, in colour).
 * The delta column always reserves space so the currency column never
 * shifts when overrides are toggled on or off. Numbers use tabular-nums
 * so they align vertically.
 */
function BreakdownRow({
  label, pct, value, delta, nights,
}: {
  label: string;
  pct?: number;
  value: number;
  delta?: number | null;
  /** When set, render a secondary "× N nights = R total" line beneath
   *  the per-night currency so the user can size against a stay
   *  budget without doing the arithmetic in their head. */
  nights?: number;
}) {
  const hasDelta = delta != null && Math.abs(delta) >= 1;
  const negative = (delta ?? 0) < 0;
  return (
    <>
      <span style={{ fontSize: '0.9375rem' }}>
        {label}
        {pct != null && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '8px' }}>{pct.toFixed(1)}%</span>
        )}
      </span>
      <div style={{
        textAlign: 'right',
        // Keep the per-night R-amount AND the per-stay total on the
        // SAME row so the breakdown collapses from N×2 lines down to
        // N×1. Big win for the agent modal (4 breakdown rows) which
        // used to need a scroll. flex-wrap means narrow widths can
        // still drop the sub-line to a second row gracefully.
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'flex-end',
        gap: 8,
        flexWrap: 'wrap',
      }}>
        <strong style={{ fontSize: '0.9375rem', fontVariantNumeric: 'tabular-nums' }}>
          {fmtRand(value)}
        </strong>
        {nights && nights > 0 && (
          <span style={{
            fontSize: '0.75rem',
            color: 'var(--text-light)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            · {fmtRand(value * nights)} ({nights}n)
          </span>
        )}
      </div>
      <span style={{
        fontSize: '0.8125rem',
        color: hasDelta ? (negative ? 'var(--error)' : 'var(--success)') : 'transparent',
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 500,
      }}>
        {hasDelta ? `${negative ? '−' : '+'}${fmtRand(Math.abs(delta!))}` : ' '}
      </span>
    </>
  );
}

function BreakdownRows({
  scenario,
  breakdown,
  ctrPct,
  agentPct,
  agentLabel,
  compareTo,
  nights,
}: {
  scenario: ScenarioType;
  breakdown: PricingBreakdown;
  ctrPct: number;
  agentPct: number;
  agentLabel: string;
  compareTo?: PricingBreakdown | null;
  /** Stay length in nights — when set, every R-amount row shows a
   *  "total for the stay" sub-line so the user can sanity-check
   *  against a budget like "R100k–R120k for our week" without
   *  reaching the final confirmation step. */
  nights?: number;
}) {
  return (
    <div style={{
      display: 'grid',
      // Three columns: label flexes, currency right-aligned, delta right-aligned.
      // Delta column reserves at least 70px so toggling overrides on/off doesn't
      // shift the currency column.
      gridTemplateColumns: 'minmax(0, 1fr) auto minmax(70px, auto)',
      // Tightened row gap (was 8px) — combined with the inline
      // per-stay total per row, this lets the 4-row agent breakdown
      // fit alongside the negotiate inputs without scrolling.
      gap: '4px 16px',
      alignItems: 'baseline',
    }}>
      <BreakdownRow
        label="Guest pays"
        value={breakdown.clientPriceExclVat}
        delta={compareTo ? breakdown.clientPriceExclVat - compareTo.clientPriceExclVat : null}
        nights={nights}
      />
      <BreakdownRow
        label="Owner net"
        value={breakdown.ownerNet}
        delta={compareTo ? breakdown.ownerNet - compareTo.ownerNet : null}
        nights={nights}
      />
      <BreakdownRow
        label="CTR earns"
        pct={ctrPct}
        value={breakdown.ctrTake}
        delta={compareTo ? breakdown.ctrTake - compareTo.ctrTake : null}
        nights={nights}
      />
      {scenario === 'agent' && (
        <BreakdownRow
          label={agentLabel}
          /* Derive from the breakdown so the displayed % always matches the
           * displayed R-amount, even when no specific agent is selected. */
          pct={breakdown.clientPriceExclVat > 0
            ? (breakdown.agentTake / breakdown.clientPriceExclVat) * 100
            : agentPct}
          value={breakdown.agentTake}
          delta={compareTo ? breakdown.agentTake - compareTo.agentTake : null}
          nights={nights}
        />
      )}
      {scenario === 'platform' && (
        <BreakdownRow
          label="Platform fee"
          pct={breakdown.clientPriceExclVat > 0
            ? (breakdown.platformFees / breakdown.clientPriceExclVat) * 100
            : undefined}
          value={breakdown.platformFees}
          delta={compareTo ? breakdown.platformFees - compareTo.platformFees : null}
          nights={nights}
        />
      )}
    </div>
  );
}

/** One Negotiate figure. The driver renders as an accented, formatted input;
 *  the rest render as plain tappable results. */
function MoneyCell({
  isDriver, hasDriver, text, derived, disabled, onActivate, onText,
}: {
  isDriver: boolean;
  hasDriver: boolean;
  text: string;
  derived: number;
  disabled?: boolean;
  onActivate: () => void;
  onText: (digits: string) => void;
}) {
  if (disabled) return <span className="pricing-deal-cell pricing-deal-cell--off">—</span>;
  if (isDriver) {
    // The figure you've set: greyed/quiet — it's done. Still editable.
    const shown = text === '' ? '' : Number(text).toLocaleString('en-ZA');
    return (
      <span className="pricing-deal-cell pricing-deal-cell--set" title="This is the figure you set. The other three are calculated from it.">
        <span className="pricing-deal-cell-r">R</span>
        <input
          autoFocus
          inputMode="numeric"
          className="pricing-deal-cell-input"
          value={shown}
          onChange={(e) => onText(e.target.value.replace(/\D/g, ''))}
        />
      </span>
    );
  }
  // A calculated result. Red accent once something's been set, so the live
  // answers draw the eye; plain + tappable before anything's set.
  return (
    <button
      type="button"
      className={`pricing-deal-cell pricing-deal-cell--calc${hasDriver ? ' pricing-deal-cell--result' : ''}`}
      onClick={onActivate}
      title="Tap to set this figure instead"
    >
      {fmtRand(derived)}
    </button>
  );
}

export default function PricingDashboard({
  property,
  supabase,
  initialScenario,
  nights, // stay length, forwarded to BreakdownRows for total-stay sub-lines
  initialSnapshot,
  initialAgentId,
  onCreateProposal,
  actionLabel = 'Create proposal from this',
  saving = false,
  lockScenario = false,
}: Props) {
  const currentYear = new Date().getFullYear();

  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [fixedRates, setFixedRates] = useState<FixedRateRow[]>([]);
  const [pricingMode, setPricingMode] = useState<'system' | 'fixed'>('system');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<ChannelProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit-mode hydration: when initialSnapshot is provided we seed the
  // state machine from it so the user lands directly in State B with
  // the saved channel / season / agent / margins reflected. State A
  // (the channel picker) is skipped because the snapshot already
  // tells us which channel was used.
  const hydrate = initialSnapshot ?? null;
  const [scenario, setScenario] = useState<ScenarioType | null>(
    (hydrate?.scenario_type as ScenarioType) ?? initialScenario ?? null,
  );
  /** Season selection is a SeasonKey ('peak' / 'high' / 'shoulder' /
   *  'winter') for the new 4-tier model. Default to 'peak' (the anchor).
   *  Snapshots store the human-readable season name; edit-mode hydration
   *  below maps that name back to a key once seasons have loaded. */
  const [selectedSeason, setSelectedSeason] = useState<SeasonKey>('peak');
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    // Priority: edit-mode hydration > enquiry-prefill > blank. The
    // initialAgentId comes from the parent enquiry on create-mode and
    // is null otherwise, so it never overrides a saved snapshot.
    (hydrate?.agents && hydrate.agents.length > 0 && hydrate.agents[0]?.id)
      || hydrate?.agent_id
      || initialAgentId
      || '',
  );
  const [selectedChannelId, setSelectedChannelId] = useState<string>(hydrate?.channel_profile_id || '');

  /** Primary negotiation lever — what the guest has said they'll pay.
   *  Only pre-filled when the saved snapshot was actually negotiated
   *  (reduced_baseline / reduced_commission_pct set). For default-
   *  priced proposals the field stays blank so the benchmark price
   *  shows as a placeholder — looks like a hint to fill in, not a
   *  duplicate of the default that the user must clear before typing.
   *  Avoids the "why is the negotiate field pre-filled with the same
   *  number as the default?" confusion. */
  const wasNegotiated = hydrate?.reduced_baseline != null || hydrate?.reduced_commission_pct != null;
  // Negotiation driver: which of the four figures the user is setting
  // (guest/owner × daily/stay) and its raw digits. null = nothing pinned, so
  // the Negotiate rows sit on the baseline until a cell is tapped.
  const [negField, setNegField] = useState<'gn' | 'gt' | 'on' | 'ot' | null>(
    wasNegotiated && hydrate?.client_price_excl_vat != null ? 'gn' : null,
  );
  const [negText, setNegText] = useState(
    wasNegotiated && hydrate?.client_price_excl_vat != null
      ? String(Math.round(Number(hydrate.client_price_excl_vat)))
      : '',
  );
  const [baseDetail, setBaseDetail] = useState(false);
  const [negDetail, setNegDetail] = useState(false);
  // Season selector shows only the current season until tapped to switch.
  const [seasonOpen, setSeasonOpen] = useState(false);
  /** Secondary levers — shave margins to protect owner net at the target.
   *  In edit-mode, pre-fill from the reduced fields if they were used. */
  const [overrideCtr, setOverrideCtr] = useState(
    hydrate?.reduced_commission_pct != null && hydrate?.agents
      ? String(Math.max(0, Number(hydrate.reduced_commission_pct) - hydrate.agents.reduce((s: number, a: { pct: number }) => s + Number(a.pct || 0), 0)))
      : '',
  );
  const [overrideAgent, setOverrideAgent] = useState(
    hydrate?.agents && hydrate.agents.length === 1 && hydrate.agents[0]?.pct != null
      ? String(hydrate.agents[0].pct)
      : '',
  );

  useEffect(() => {
    if (!supabase || !property?.id) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [baselineRes, seasonRes, ovRes, fxRes, modeRes, agentRes, channelRes] = await Promise.all([
          supabase.from('baselines').select('*').eq('property_id', property.id).eq('year', currentYear).maybeSingle(),
          supabase.from('seasons').select('id, key, name, multiplier, date_ranges, sort_order').eq('partner_id', CT_RENTALS_PARTNER_ID).order('sort_order'),
          supabase.from('property_season_overrides').select('property_id, year, season_id, override_rate').eq('property_id', property.id).eq('year', currentYear),
          supabase.from('property_fixed_rates').select('property_id, year, season_id, guest_rate, owner_rate').eq('property_id', property.id).eq('year', currentYear),
          supabase.from('partner_properties').select('pricing_mode').eq('id', property.id).maybeSingle(),
          supabase.from('agents').select('*').order('name'),
          supabase.from('channel_defaults').select('*').eq('partner_id', CT_RENTALS_PARTNER_ID).eq('is_active', true).order('platform_name'),
        ]);
        if (cancelled) return;
        if (baselineRes.data) setBaseline(baselineRes.data);
        if (seasonRes.data) setSeasons(seasonRes.data as SeasonRow[]);
        if (ovRes.data) setOverrides(ovRes.data as OverrideRow[]);
        if (fxRes.data) setFixedRates(fxRes.data as FixedRateRow[]);
        if (modeRes.data?.pricing_mode) setPricingMode(modeRes.data.pricing_mode as 'system' | 'fixed');
        if (agentRes.data) setAgents(agentRes.data);
        if (channelRes.data) {
          setChannels(channelRes.data.map((d: any) => ({
            id: d.id,
            property_id: '',
            platform_name: d.platform_name,
            platform_fee_pct: Number(d.fee_pct),
            platform_fixed_fee: Number(d.fixed_fee),
            notes: d.notes,
            created_at: d.created_at,
          })));
          if (channelRes.data.length > 0 && !selectedChannelId) {
            setSelectedChannelId(channelRes.data[0].id);
          }
        }
      } catch (err) {
        console.error('PricingDashboard load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, property?.id, currentYear]);

  // Resolve the selected season's row (multiplier, name, dates, id).
  const selectedSeasonRow = useMemo(
    () => seasons.find(s => s.key === selectedSeason) || null,
    [seasons, selectedSeason],
  );
  const seasonMultiplier = useMemo(
    () => (selectedSeasonRow ? Number(selectedSeasonRow.multiplier) : 1),
    [selectedSeasonRow],
  );
  // Per-property per-season override (System mode). When set, replaces
  // the auto-suggested rate of baseline × multiplier for this season.
  const seasonOverride = useMemo(() => {
    if (!selectedSeasonRow) return null;
    const row = overrides.find(o => o.season_id === selectedSeasonRow.id);
    return row ? Number(row.override_rate) : null;
  }, [overrides, selectedSeasonRow]);
  // baseRate is the per-night OWNER-side rate before any margin maths.
  // Note: PricingDashboard's engine still expects `baseline` × `seasonMultiplier`
  // → owner net. When an override is set we pre-divide so the engine math holds.
  //   override_rate = effective owner rate for this season
  //   adjusted_baseline = override / multiplier (so baseline × mult = override)
  const baseRate = useMemo(() => {
    if (seasonOverride != null && seasonMultiplier > 0) {
      return seasonOverride / seasonMultiplier;
    }
    return baseline?.daily_rate ?? 0;
  }, [seasonOverride, seasonMultiplier, baseline]);
  // Fixed-mode helpers (used only when pricingMode === 'fixed').
  const fixedSlot = useMemo(() => {
    if (pricingMode !== 'fixed' || !selectedSeasonRow) return null;
    return fixedRates.find(r => r.season_id === selectedSeasonRow.id) || null;
  }, [pricingMode, fixedRates, selectedSeasonRow]);
  // Per-quote overrides for Fixed mode. Default empty (= use DB rate);
  // typing a number overrides just this proposal without touching the
  // canonical /settings/pricing values. Agent split % defaults to 50.
  const [fixedGuestOverride, setFixedGuestOverride] = useState('');
  const [fixedOwnerOverride, setFixedOwnerOverride] = useState('');
  const [agentSplitPct, setAgentSplitPct] = useState('50');

  // Season hydration intentionally NOT applied: Peak is the universal
  // default everywhere (match modal, new proposals, edit pricing) so
  // the team always starts from the negotiating anchor and steps down
  // via the dropdown if they want a different tier. Previously this
  // mapped the saved snapshot's season_tag back into the dropdown,
  // which meant a proposal saved at Winter re-opened at Winter and
  // hid the "Peak everywhere by default" intent.

  const activeChannel = useMemo(
    () => channels.find(c => c.id === selectedChannelId) || null,
    [channels, selectedChannelId],
  );
  const selectedAgent = useMemo(
    () => agents.find(a => a.id === selectedAgentId) || null,
    [agents, selectedAgentId],
  );
  const defaultCtrPct = scenario ? CTR_DEFAULT[scenario] : 0;
  const defaultAgentPct = scenario === 'agent'
    ? (selectedAgent ? Number(selectedAgent.default_commission_pct) : GENERIC_AGENT_PCT)
    : 0;
  const defaultPlatformFeePct = scenario === 'platform' && activeChannel ? activeChannel.platform_fee_pct : 0;
  const defaultPlatformFixedFee = scenario === 'platform' && activeChannel ? activeChannel.platform_fixed_fee : 0;

  const effCtrPct = overrideCtr !== '' ? Number(overrideCtr) : defaultCtrPct;
  const effAgentPct = overrideAgent !== '' ? Number(overrideAgent) : defaultAgentPct;
  // Guest↔owner conversion (exact for direct + agent; platform fees sit on
  // top, so owner-side pinning there is approximate).
  const negMarginDivisor = 1 - (effCtrPct + effAgentPct) / 100;
  const negNights = nights && nights > 0 ? nights : 0;

  // Canonical guest per-night, derived from whichever figure is pinned. This
  // is the single value the engine reverse-solves from, so all four cells and
  // both sections stay perfectly in step.
  const targetGuestNum: number | null = (() => {
    if (negField === null || negText === '') return null;
    const n = Number(negText);
    if (!Number.isFinite(n) || n <= 0) return null;
    const nn = negNights || 1;
    if (negField === 'gn') return n;
    if (negField === 'gt') return n / nn;
    if (negField === 'on') return negMarginDivisor > 0 ? n / negMarginDivisor : n;
    return negMarginDivisor > 0 ? (n / nn) / negMarginDivisor : n / nn; // 'ot'
  })();

  /** Benchmark: default pricing for the chosen channel + season. No
   *  overrides applied. This is the anchor Mom negotiates against. */
  const benchmark = useMemo(() => {
    if (!scenario) return null;
    return calculatePricing({
      baseline: baseRate,
      scenarioType: scenario,
      ctrPct: defaultCtrPct,
      agentPct: defaultAgentPct,
      seasonMultiplier,
      platformFeePct: defaultPlatformFeePct,
      platformFixedFee: defaultPlatformFixedFee,
      reducedBaseline: null,
      reducedCtrPct: null,
      reducedAgentPct: null,
      vatEnabled: false,
      vatRatePct: 0,
    });
  }, [scenario, baseRate, defaultCtrPct, defaultAgentPct, seasonMultiplier, defaultPlatformFeePct, defaultPlatformFixedFee]);

  /** Negotiated: with current overrides applied. When the guest target
   *  is set the engine flips to reverse-solve (solve for owner base from
   *  the target guest price). */
  const negotiated = useMemo(() => {
    if (!scenario) return null;
    return calculatePricing({
      baseline: baseRate,
      scenarioType: scenario,
      ctrPct: effCtrPct,
      agentPct: effAgentPct,
      seasonMultiplier,
      platformFeePct: defaultPlatformFeePct,
      platformFixedFee: defaultPlatformFixedFee,
      reducedBaseline: null,
      reducedCtrPct: null,
      reducedAgentPct: null,
      solveFor: targetGuestNum != null && targetGuestNum > 0 ? 'base' : 'guest',
      targetGuestPrice: targetGuestNum ?? undefined,
      vatEnabled: false,
      vatRatePct: 0,
    });
  }, [scenario, baseRate, effCtrPct, effAgentPct, seasonMultiplier, defaultPlatformFeePct, defaultPlatformFixedFee, targetGuestNum]);

  const overridesActive = (negField !== null && negText !== '') || overrideCtr !== '' || overrideAgent !== '';

  // The live value for any cell, read off the negotiated breakdown so the
  // three cells you're not editing always reflect the current result.
  function negDerived(field: 'gn' | 'gt' | 'on' | 'ot'): number {
    if (!negotiated) return 0;
    const cp = negotiated.clientPriceExclVat;
    const on = negotiated.ownerNet;
    // Totals round the product (same as the Baseline card) so the two cards
    // never differ by a rand.
    if (field === 'gn') return Math.round(cp);
    if (field === 'gt') return Math.round(cp * negNights);
    if (field === 'on') return Math.round(on);
    return Math.round(on * negNights); // 'ot' — owner total
  }
  // Tap a figure to start driving it, seeded with its current value.
  function activateNeg(field: 'gn' | 'gt' | 'on' | 'ot') {
    setNegField(field);
    setNegText(String(negDerived(field)));
  }

  /** Fixed-mode breakdown. Built directly from the property's stored Guest
   *  + Owner rates (with per-quote overrides), not from the standard
   *  baseline × multiplier × margin engine. Per-scenario splits:
   *    Direct   — CTR takes the full margin, no agent, no channel.
   *    Agent    — Split margin per agentSplitPct (default 50/50).
   *    Platform — Channel takes its fee off the guest rate first;
   *               CTR takes whatever's left after channel + owner.
   *  Returns the same PricingBreakdown shape so the snapshot and downstream
   *  consumers stay compatible. */
  const fixedBreakdown = useMemo<PricingBreakdown | null>(() => {
    if (pricingMode !== 'fixed') return null;
    const dbGuest = fixedSlot?.guest_rate != null ? Number(fixedSlot.guest_rate) : null;
    const dbOwner = fixedSlot?.owner_rate != null ? Number(fixedSlot.owner_rate) : null;
    const guest = fixedGuestOverride !== '' ? Number(fixedGuestOverride) : dbGuest;
    const owner = fixedOwnerOverride !== '' ? Number(fixedOwnerOverride) : dbOwner;
    if (guest == null || owner == null || guest <= 0) return null;
    const grossMargin = Math.max(0, guest - owner);

    let ctrTake = 0;
    let agentTake = 0;
    let platformFees = 0;

    if (scenario === 'agent') {
      const splitPct = Math.max(0, Math.min(100, Number(agentSplitPct) || 0));
      agentTake = Math.round(grossMargin * (splitPct / 100));
      ctrTake = grossMargin - agentTake;
    } else if (scenario === 'platform' && activeChannel) {
      // Markup model — matches the System engine's interpretation of
      // `channel_defaults.fee_pct`. The pinned guest rate already includes
      // the channel's mark-up; we back into what the channel takes by
      // dividing by (1 + fee%). Fixed fee comes off the top first, then
      // the percentage. Same 4% means the same R-amount across modes.
      const pctFactor = 1 + (Number(activeChannel.platform_fee_pct) / 100);
      const fixedFee = Number(activeChannel.platform_fixed_fee || 0);
      const hostNet = pctFactor > 0 ? (guest - fixedFee) / pctFactor : guest - fixedFee;
      platformFees = Math.round(guest - hostNet);
      ctrTake = Math.max(0, guest - platformFees - owner);
    } else {
      // Direct (or platform with no channel selected) — CTR takes all.
      ctrTake = grossMargin;
    }

    return {
      ownerNet: owner,
      companyTake: ctrTake,
      ctrTake,
      agentTake,
      platformFees,
      clientPriceExclVat: guest,
      vatAmount: 0,
      clientPriceInclVat: guest,
      adjustedBaseline: owner,
      totalMarginPct: guest > 0 ? (grossMargin / guest) * 100 : 0,
      effectiveCtrMarginPct: guest > 0 ? (ctrTake / guest) * 100 : 0,
      effectiveTotalMarkupPct: owner > 0 ? (grossMargin / owner) * 100 : 0,
    };
  }, [pricingMode, fixedSlot, fixedGuestOverride, fixedOwnerOverride, agentSplitPct, scenario, activeChannel]);

  const snapshot = useMemo<PricingSnapshot | null>(() => {
    if (!scenario) return null;
    // Fixed mode: build the snapshot from the Fixed breakdown so the
    // saved proposal reflects Guest/Owner rates instead of margin maths.
    if (pricingMode === 'fixed') {
      if (!fixedBreakdown) return null;
      const snapshotAgents: SnapshotAgent[] = scenario === 'agent' && selectedAgent
        ? [{
            id: selectedAgent.id,
            pct: fixedBreakdown.clientPriceExclVat > 0
              ? (fixedBreakdown.agentTake / fixedBreakdown.clientPriceExclVat) * 100
              : 0,
            name: selectedAgent.name,
            email: selectedAgent.email ?? null,
            phone: (selectedAgent as any).phone ?? null,
            company: (selectedAgent as any).company ?? null,
          }]
        : [];
      const ctrPct = fixedBreakdown.clientPriceExclVat > 0
        ? (fixedBreakdown.ctrTake / fixedBreakdown.clientPriceExclVat) * 100
        : 0;
      const agentPct = snapshotAgents[0]?.pct ?? 0;
      return {
        propertyId: property.id,
        scenarioType: scenario,
        agentId: snapshotAgents[0]?.id ?? null,
        agents: snapshotAgents,
        agentContact: snapshotAgents[0]
          ? { name: snapshotAgents[0].name, email: snapshotAgents[0].email, phone: snapshotAgents[0].phone, company: snapshotAgents[0].company }
          : null,
        channelId: null,
        baseline: fixedBreakdown.ownerNet,
        seasonTag: selectedSeasonRow?.name ?? null,
        seasonMultiplier: 1,
        ctrPct,
        agentPct,
        platformFeePct: 0,
        platformFixedFee: 0,
        reducedBaseline: null,
        reducedCtrPct: null,
        reducedAgentPct: null,
        totalMarginPct: fixedBreakdown.totalMarginPct,
        breakdown: fixedBreakdown,
      };
    }
    // System mode (unchanged from before).
    if (!negotiated) return null;
    const snapshotAgents: SnapshotAgent[] = scenario === 'agent' && selectedAgent
      ? [{
          id: selectedAgent.id,
          pct: effAgentPct,
          name: selectedAgent.name,
          email: selectedAgent.email ?? null,
          phone: (selectedAgent as any).phone ?? null,
          company: (selectedAgent as any).company ?? null,
        }]
      : [];
    return {
      propertyId: property.id,
      scenarioType: scenario,
      agentId: snapshotAgents[0]?.id ?? null,
      agents: snapshotAgents,
      agentContact: snapshotAgents[0]
        ? { name: snapshotAgents[0].name, email: snapshotAgents[0].email, phone: snapshotAgents[0].phone, company: snapshotAgents[0].company }
        : null,
      channelId: scenario === 'platform' ? selectedChannelId || null : null,
      baseline: baseRate,
      // Snapshot carries the human-readable name (not the row ID) so the
      // saved proposal stays meaningful even if the seasons row is later
      // edited or deleted.
      seasonTag: selectedSeasonRow?.name ?? null,
      seasonMultiplier,
      ctrPct: defaultCtrPct,
      agentPct: defaultAgentPct,
      platformFeePct: defaultPlatformFeePct,
      platformFixedFee: defaultPlatformFixedFee,
      reducedBaseline: targetGuestNum != null ? negotiated.adjustedBaseline / seasonMultiplier : null,
      reducedCtrPct: overrideCtr !== '' ? Number(overrideCtr) : null,
      reducedAgentPct: overrideAgent !== '' ? Number(overrideAgent) : null,
      totalMarginPct: effCtrPct + effAgentPct,
      breakdown: negotiated,
    };
  }, [scenario, negotiated, selectedAgent, effAgentPct, effCtrPct, selectedSeason, seasonMultiplier, defaultCtrPct, defaultAgentPct, defaultPlatformFeePct, defaultPlatformFixedFee, overrideCtr, overrideAgent, targetGuestNum, baseRate, selectedChannelId, property.id]);

  function resetOverrides() {
    setNegField(null);
    setNegText('');
    setBaseDetail(false);
    setNegDetail(false);
    setOverrideCtr('');
    setOverrideAgent('');
    setFixedGuestOverride('');
    setFixedOwnerOverride('');
    setAgentSplitPct('50');
  }

  if (loading) {
    return <p style={{ margin: 0, padding: '20px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading pricing…</p>;
  }

  if (!baseline) {
    return (
      <div className="detail-modal-section">
        <p style={{ margin: 0 }}>
          <strong>No baseline set for this property.</strong>
          <br />
          Set a {currentYear}/{currentYear + 1} baseline in Settings → Pricing before working an enquiry.
        </p>
      </div>
    );
  }

  // ── State A — channel not chosen ──
  if (!scenario) {
    return (
      <div className="detail-modal-section">
        <div className="detail-modal-section-heading">How is this enquiry coming in?</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: '20px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
            onClick={() => setScenario('direct')}
          >
            <span style={{ fontSize: '1.75rem', lineHeight: 1 }} aria-hidden>📞</span>
            <span>Direct</span>
          </button>
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: '20px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
            onClick={() => setScenario('agent')}
          >
            <span style={{ fontSize: '1.75rem', lineHeight: 1 }} aria-hidden>🤝</span>
            <span>Agent</span>
          </button>
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: '20px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
            onClick={() => setScenario('platform')}
          >
            <span style={{ fontSize: '1.75rem', lineHeight: 1 }} aria-hidden>🌐</span>
            <span>Platform</span>
          </button>
        </div>
      </div>
    );
  }

  // ── State B — channel chosen ──
  const channelLabel = scenario === 'direct' ? 'Direct' : scenario === 'agent' ? 'Agent' : 'Platform';
  const channelIcon = scenario === 'direct' ? '📞' : scenario === 'agent' ? '🤝' : '🌐';
  const agentLabel = selectedAgent ? selectedAgent.name : 'Generic agent';

  return (
    <div className="pricing-dash">
      {pricingMode === 'fixed' && (
        <div className="pricing-banner pricing-banner--high" style={{ marginBottom: 12 }}>
          <strong>Fixed pricing.</strong> Guest rate is set by a 3rd party and the owner rate is pre-agreed. The calculator uses the values from Settings → Pricing; override below for this proposal only.
        </div>
      )}
      {/* Context bar — channel pill + season selector */}
      <div className="detail-modal-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: 16 }}>
        {/* Channel pill. Click to return to State A (channel picker)
            UNLESS the host has locked the scenario — in that case it
            renders as a static badge so the user can't accidentally
            convert (say) a direct quote into an agent quote and
            rewire the breakdown maths. */}
        {lockScenario ? (
          <span
            className="detail-modal-mode-badge detail-modal-mode-badge--view"
            style={{ border: 'none' }}
            title="Channel is locked to the host enquiry's type"
          >
            {channelIcon} {channelLabel}
          </span>
        ) : (
          <button
            type="button"
            className="detail-modal-mode-badge detail-modal-mode-badge--view"
            style={{ cursor: 'pointer', border: 'none' }}
            onClick={() => setScenario(null)}
            title="Change channel"
          >
            {channelIcon} {channelLabel} · change
          </button>
        )}
        <div className="pricing-season-chips">
          {(seasonOpen ? SEASON_ORDER : [selectedSeason]).map(k => {
            const row = seasons.find(s => s.key === k);
            if (!row) return null;
            const isSel = selectedSeason === k;
            return (
              <button
                key={k}
                type="button"
                className={`ops-status-pill ops-status-pill--${k} pricing-season-chip${isSel ? ' is-selected' : ''}`}
                onClick={() => {
                  if (!seasonOpen) { setSeasonOpen(true); return; }
                  setSelectedSeason(k);
                  setSeasonOpen(false);
                }}
                title={seasonOpen ? `${row.name} season (×${row.multiplier})` : 'Tap to change season'}
              >
                {row.name} ×{row.multiplier}{!seasonOpen ? ' ▾' : ''}
              </button>
            );
          })}
          {!seasonOpen && seasonOverride != null && (
            <span className="ops-status-pill ops-status-pill--ready" title={`Per-property override applied for ${selectedSeasonRow?.name}: R${seasonOverride.toLocaleString('en-US')}/night`}>
              <span className="ops-status-pill-dot" />
              Override
            </span>
          )}
        </div>
      </div>

      {pricingMode === 'fixed' ? (
        /* Fixed-mode panel — Guest + Owner read from property_fixed_rates
           for the selected season, with per-quote overrides. Agent scenario
           splits the margin (default 50/50) — direct + platform scenarios
           give the full margin to the platform. */
        <div className="detail-modal-section">
          <div className="detail-modal-section-heading">
            Fixed pricing · {channelLabel} · {selectedSeasonRow?.name ?? 'Peak'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Guest pays (set by 3rd party)</label>
              <input
                type="number"
                inputMode="numeric"
                className="form-input"
                value={fixedGuestOverride}
                onChange={(e) => setFixedGuestOverride(e.target.value)}
                placeholder={fixedSlot?.guest_rate != null ? `R ${Math.round(Number(fixedSlot.guest_rate)).toLocaleString()}` : 'Not set'}
                min={0}
                step="100"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Owner gets (pre-agreed)</label>
              <input
                type="number"
                inputMode="numeric"
                className="form-input"
                value={fixedOwnerOverride}
                onChange={(e) => setFixedOwnerOverride(e.target.value)}
                placeholder={fixedSlot?.owner_rate != null ? `R ${Math.round(Number(fixedSlot.owner_rate)).toLocaleString()}` : 'Not set'}
                min={0}
                step="100"
              />
            </div>
            {scenario === 'agent' && (
              <>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Agent share of margin %</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    className="form-input"
                    value={agentSplitPct}
                    onChange={(e) => setAgentSplitPct(e.target.value)}
                    placeholder="50"
                    min={0}
                    max={100}
                    step="1"
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Specific agent</label>
                  <select className="form-input" value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}>
                    <option value="">Generic agent</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {scenario === 'platform' && channels.length > 0 && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Platform</label>
                <select className="form-input" value={selectedChannelId} onChange={(e) => setSelectedChannelId(e.target.value)}>
                  {channels.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.platform_name} ({c.platform_fee_pct}%{c.platform_fixed_fee > 0 ? ` + ${fmtRand(c.platform_fixed_fee)}` : ''})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {fixedBreakdown ? (
            <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
              <BreakdownRows
                scenario={scenario}
                breakdown={fixedBreakdown}
                ctrPct={snapshot?.ctrPct ?? 0}
                agentPct={snapshot?.agentPct ?? 0}
                agentLabel={agentLabel}
                nights={nights}
              />
            </div>
          ) : (
            <div style={{ marginTop: '14px', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              No Fixed rates set for {selectedSeasonRow?.name ?? 'this season'}. Set them on Settings → Pricing first.
            </div>
          )}
        </div>
      ) : (
      /* System-mode panels (Benchmark + Negotiate) unchanged. */
      <>
      {/* Baseline — standard price for this channel + season, read-only */}
      <div className="detail-modal-section pricing-deal-card pricing-deal-card--baseline">
        <div className="pricing-deal-head">
          <span className="pricing-deal-title">Baseline</span>
          <span className="badge-soft">Standard</span>
        </div>
        {benchmark && (
          <>
            <div className="pricing-deal-grid">
              <span />
              <span className="pricing-deal-col">Daily Rate</span>
              <span className="pricing-deal-col">Total Stay</span>
              <span className="pricing-deal-rowlabel">Guest pays</span>
              <span className="pricing-deal-val">{fmtRand(benchmark.clientPriceExclVat)}</span>
              <span className="pricing-deal-val">{negNights ? fmtRand(benchmark.clientPriceExclVat * negNights) : '—'}</span>
              <span className="pricing-deal-rowlabel">Owner gets</span>
              <span className="pricing-deal-val">{fmtRand(benchmark.ownerNet)}</span>
              <span className="pricing-deal-val">{negNights ? fmtRand(benchmark.ownerNet * negNights) : '—'}</span>
            </div>
            <button type="button" className="pricing-deal-more" onClick={() => setBaseDetail(v => !v)}>
              {baseDetail ? '▾' : '▸'} Margins &amp; splits
            </button>
            {baseDetail && (
              <div className="pricing-deal-grid pricing-deal-grid--split">
                <span className="pricing-deal-col">Split</span>
                <span className="pricing-deal-col">%</span>
                <span className="pricing-deal-col">Daily</span>
                <span className="pricing-deal-col">Total</span>
                <span className="pricing-deal-rowlabel"><span className="pricing-deal-dot pricing-deal-dot--ctr" />CTR keeps</span>
                <span className="pricing-deal-pctcell pricing-deal-pctcell--ro">{defaultCtrPct}%</span>
                <span className="pricing-deal-val pricing-deal-val--mini">{fmtRand(benchmark.ctrTake)}</span>
                <span className="pricing-deal-val pricing-deal-val--mini">{negNights ? fmtRand(benchmark.ctrTake * negNights) : '—'}</span>
                {scenario === 'agent' && (
                  <>
                    <span className="pricing-deal-rowlabel"><span className="pricing-deal-dot pricing-deal-dot--agent" />{agentLabel}</span>
                    <span className="pricing-deal-pctcell pricing-deal-pctcell--ro">{defaultAgentPct}%</span>
                    <span className="pricing-deal-val pricing-deal-val--mini">{fmtRand(benchmark.agentTake)}</span>
                    <span className="pricing-deal-val pricing-deal-val--mini">{negNights ? fmtRand(benchmark.agentTake * negNights) : '—'}</span>
                  </>
                )}
                {scenario === 'platform' && benchmark.platformFees > 0 && (
                  <>
                    <span className="pricing-deal-rowlabel"><span className="pricing-deal-dot pricing-deal-dot--platform" />Platform fee</span>
                    <span className="pricing-deal-pctcell pricing-deal-pctcell--ro">{activeChannel ? activeChannel.platform_fee_pct : 0}%</span>
                    <span className="pricing-deal-val pricing-deal-val--mini">{fmtRand(benchmark.platformFees)}</span>
                    <span className="pricing-deal-val pricing-deal-val--mini">{negNights ? fmtRand(benchmark.platformFees * negNights) : '—'}</span>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Negotiate — tap any figure to drive it; the rest follow. Applies on Save. */}
      <div className="detail-modal-section pricing-deal-card pricing-deal-card--active">
        <div className="pricing-deal-head">
          <span className="pricing-deal-title">Negotiate</span>
          <span className="badge-soft">Applies on save</span>
        </div>
        <div className="pricing-deal-instruction">Set any one figure, the other three are worked out for you.</div>
        {negotiated && (
          <>
            <div className="pricing-deal-grid">
              <span className={`pricing-deal-hint${negField ? ' pricing-deal-hint--active' : ''}`}>
                {negField
                  ? `Setting ${negField === 'gn' || negField === 'gt' ? 'guest' : 'owner'} ${negField === 'gn' || negField === 'on' ? 'daily' : 'stay'}`
                  : ''}
              </span>
              <span className="pricing-deal-col">Daily Rate</span>
              <span className="pricing-deal-col">Total Stay</span>

              <span className="pricing-deal-rowlabel">Guest pays</span>
              <MoneyCell isDriver={negField === 'gn'} hasDriver={negField !== null} text={negText} derived={negDerived('gn')}
                onActivate={() => activateNeg('gn')} onText={setNegText} />
              <MoneyCell isDriver={negField === 'gt'} hasDriver={negField !== null} text={negText} derived={negDerived('gt')} disabled={!negNights}
                onActivate={() => activateNeg('gt')} onText={setNegText} />

              <span className="pricing-deal-rowlabel">Owner gets</span>
              <MoneyCell isDriver={negField === 'on'} hasDriver={negField !== null} text={negText} derived={negDerived('on')}
                onActivate={() => activateNeg('on')} onText={setNegText} />
              <MoneyCell isDriver={negField === 'ot'} hasDriver={negField !== null} text={negText} derived={negDerived('ot')} disabled={!negNights}
                onActivate={() => activateNeg('ot')} onText={setNegText} />
            </div>
            {negNights > 0 && (
              <div className="pricing-deal-summary">
                Guest pays <strong>{fmtRand(negDerived('gt'))}</strong> for {negNights} night{negNights === 1 ? '' : 's'}
                {' · '}Owner gets <strong>{fmtRand(negDerived('ot'))}</strong>
                {' · '}You keep <strong>{fmtRand(Math.round(negotiated.ctrTake * negNights))}</strong>
              </div>
            )}
            <button type="button" className="pricing-deal-more" onClick={() => setNegDetail(v => !v)}>
              {negDetail ? '▾' : '▸'} Margins &amp; splits
            </button>
            {negDetail && (
              <div className="pricing-deal-detail-pane">
                <div className="pricing-deal-grid pricing-deal-grid--split">
                  <span className="pricing-deal-col">Split</span>
                  <span className="pricing-deal-col">%</span>
                  <span className="pricing-deal-col">Daily</span>
                  <span className="pricing-deal-col">Total</span>

                  <span className="pricing-deal-rowlabel"><span className="pricing-deal-dot pricing-deal-dot--ctr" />CTR keeps</span>
                  <span className="pricing-deal-stepper">
                    <button type="button" className="pricing-deal-stepbtn" onClick={() => setOverrideCtr(String(Math.max(0, effCtrPct - 1)))} aria-label="Lower CTR margin">−</button>
                    <span className="pricing-deal-stepval">{effCtrPct}%</span>
                    <button type="button" className="pricing-deal-stepbtn" onClick={() => setOverrideCtr(String(Math.min(100, effCtrPct + 1)))} aria-label="Raise CTR margin">+</button>
                  </span>
                  <span className="pricing-deal-val pricing-deal-val--mini">{fmtRand(negotiated.ctrTake)}</span>
                  <span className="pricing-deal-val pricing-deal-val--mini">{negNights ? fmtRand(negotiated.ctrTake * negNights) : '—'}</span>

                  {scenario === 'agent' && (
                    <>
                      <span className="pricing-deal-rowlabel"><span className="pricing-deal-dot pricing-deal-dot--agent" />{agentLabel}</span>
                      <span className="pricing-deal-stepper">
                        <button type="button" className="pricing-deal-stepbtn" onClick={() => setOverrideAgent(String(Math.max(0, effAgentPct - 1)))} aria-label="Lower agent commission">−</button>
                        <span className="pricing-deal-stepval">{effAgentPct}%</span>
                        <button type="button" className="pricing-deal-stepbtn" onClick={() => setOverrideAgent(String(Math.min(100, effAgentPct + 1)))} aria-label="Raise agent commission">+</button>
                      </span>
                      <span className="pricing-deal-val pricing-deal-val--mini">{fmtRand(negotiated.agentTake)}</span>
                      <span className="pricing-deal-val pricing-deal-val--mini">{negNights ? fmtRand(negotiated.agentTake * negNights) : '—'}</span>
                    </>
                  )}
                  {scenario === 'platform' && negotiated.platformFees > 0 && (
                    <>
                      <span className="pricing-deal-rowlabel"><span className="pricing-deal-dot pricing-deal-dot--platform" />Platform fee</span>
                      <span className="pricing-deal-pctcell pricing-deal-pctcell--ro">{activeChannel ? activeChannel.platform_fee_pct : 0}%</span>
                      <span className="pricing-deal-val pricing-deal-val--mini">{fmtRand(negotiated.platformFees)}</span>
                      <span className="pricing-deal-val pricing-deal-val--mini">{negNights ? fmtRand(negotiated.platformFees * negNights) : '—'}</span>
                    </>
                  )}
                </div>
                {(scenario === 'agent' || (scenario === 'platform' && channels.length > 0)) && (
                  <div className="pricing-deal-levers">
                    {scenario === 'agent' && (
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Specific agent</label>
                        <select className="form-input" value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}>
                          <option value="">Generic agent ({GENERIC_AGENT_PCT}%)</option>
                          {agents.map(a => (
                            <option key={a.id} value={a.id}>{a.name} ({a.default_commission_pct}%)</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {scenario === 'platform' && channels.length > 0 && (
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Platform</label>
                        <select className="form-input" value={selectedChannelId} onChange={(e) => setSelectedChannelId(e.target.value)}>
                          {channels.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.platform_name} ({c.platform_fee_pct}%{c.platform_fixed_fee > 0 ? ` + ${fmtRand(c.platform_fixed_fee)}` : ''})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      </>
      )}

      {/* Action row — shared across both Fixed and System modes. */}
      <div className="detail-modal-section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={resetOverrides}
          disabled={pricingMode === 'fixed'
            ? (fixedGuestOverride === '' && fixedOwnerOverride === '' && agentSplitPct === '50')
            : !overridesActive}
        >
          ↺ Reset to defaults
        </button>
        {onCreateProposal && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => snapshot && onCreateProposal(snapshot)}
            disabled={saving || !snapshot}
          >
            {saving ? 'Saving…' : actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
