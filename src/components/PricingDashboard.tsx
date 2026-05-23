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

import { useEffect, useMemo, useState } from 'react';
import { calculatePricing, CTR_DEFAULT, fmtRand } from '../lib/pricingEngine';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import type { Baseline, SeasonTag, Agent, ChannelProfile, PricingBreakdown, PricingProposal } from '../types/pricing';

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
  company: string | null;
}

export interface PricingSnapshot {
  propertyId: string;
  scenarioType: ScenarioType;
  agentId: string | null;
  agents: SnapshotAgent[];
  agentContact: { name: string; email: string | null; company: string | null } | null;
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
  onCreateProposal?: (snapshot: PricingSnapshot) => void;
  actionLabel?: string;
  saving?: boolean;
}

/**
 * One breakdown line — three columns: label (with optional inline %),
 * currency value (right-aligned), and delta (right-aligned, in colour).
 * The delta column always reserves space so the currency column never
 * shifts when overrides are toggled on or off. Numbers use tabular-nums
 * so they align vertically.
 */
function BreakdownRow({
  label, pct, value, delta,
}: {
  label: string;
  pct?: number;
  value: number;
  delta?: number | null;
}) {
  const hasDelta = delta != null && Math.abs(delta) >= 1;
  const negative = (delta ?? 0) < 0;
  return (
    <>
      <span style={{ fontSize: '0.9375rem' }}>
        {label}
        {pct != null && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '8px' }}>{pct}%</span>
        )}
      </span>
      <strong style={{ fontSize: '0.9375rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {fmtRand(value)}
      </strong>
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
}: {
  scenario: ScenarioType;
  breakdown: PricingBreakdown;
  ctrPct: number;
  agentPct: number;
  agentLabel: string;
  compareTo?: PricingBreakdown | null;
}) {
  return (
    <div style={{
      display: 'grid',
      // Three columns: label flexes, currency right-aligned, delta right-aligned.
      // Delta column reserves at least 70px so toggling overrides on/off doesn't
      // shift the currency column.
      gridTemplateColumns: 'minmax(0, 1fr) auto minmax(70px, auto)',
      gap: '8px 16px',
      alignItems: 'baseline',
    }}>
      <BreakdownRow
        label="Guest pays"
        value={breakdown.clientPriceExclVat}
        delta={compareTo ? breakdown.clientPriceExclVat - compareTo.clientPriceExclVat : null}
      />
      <BreakdownRow
        label="Owner net"
        value={breakdown.ownerNet}
        delta={compareTo ? breakdown.ownerNet - compareTo.ownerNet : null}
      />
      <BreakdownRow
        label="CTR earns"
        pct={ctrPct}
        value={breakdown.ctrTake}
        delta={compareTo ? breakdown.ctrTake - compareTo.ctrTake : null}
      />
      {scenario === 'agent' && (
        <BreakdownRow
          label={agentLabel}
          pct={agentPct}
          value={breakdown.agentTake}
          delta={compareTo ? breakdown.agentTake - compareTo.agentTake : null}
        />
      )}
      {scenario === 'platform' && (
        <BreakdownRow
          label="Platform fee"
          value={breakdown.platformFees}
          delta={compareTo ? breakdown.platformFees - compareTo.platformFees : null}
        />
      )}
    </div>
  );
}

export default function PricingDashboard({
  property,
  supabase,
  initialScenario,
  nights: _nights, // reserved for total-stay display in a future iteration
  initialSnapshot,
  onCreateProposal,
  actionLabel = 'Create proposal from this',
  saving = false,
}: Props) {
  const currentYear = new Date().getFullYear();

  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [seasonTags, setSeasonTags] = useState<SeasonTag[]>([]);
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
  const [selectedSeason, setSelectedSeason] = useState(hydrate?.season_tag || 'Normal');
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    (hydrate?.agents && hydrate.agents.length > 0 && hydrate.agents[0]?.id)
      || hydrate?.agent_id
      || '',
  );
  const [selectedChannelId, setSelectedChannelId] = useState<string>(hydrate?.channel_profile_id || '');

  /** Primary negotiation lever — what the guest has said they'll pay.
   *  Pre-filled in edit-mode from the saved client_price_excl_vat so
   *  the user sees what was agreed and can adjust from there. */
  const [targetGuest, setTargetGuest] = useState(
    hydrate?.client_price_excl_vat != null ? String(Math.round(Number(hydrate.client_price_excl_vat))) : '',
  );
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
        const [baselineRes, seasonRes, agentRes, channelRes] = await Promise.all([
          supabase.from('baselines').select('*').eq('property_id', property.id).eq('year', currentYear).maybeSingle(),
          supabase.from('season_tags').select('*').or(`property_id.eq.${property.id},property_id.is.null`).order('start_date'),
          supabase.from('agents').select('*').order('name'),
          supabase.from('channel_defaults').select('*').eq('partner_id', CT_RENTALS_PARTNER_ID).eq('is_active', true).order('platform_name'),
        ]);
        if (cancelled) return;
        if (baselineRes.data) setBaseline(baselineRes.data);
        if (seasonRes.data) setSeasonTags(seasonRes.data);
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

  const baseRate = baseline?.daily_rate ?? 0;
  const seasonMultiplier = useMemo(() => {
    if (!selectedSeason || selectedSeason === 'Normal') return 1;
    const tag = seasonTags.find(s => s.name === selectedSeason);
    return tag ? tag.multiplier : 1;
  }, [seasonTags, selectedSeason]);
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
  const targetGuestNum = targetGuest !== '' ? Number(targetGuest) : null;

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

  const overridesActive = targetGuest !== '' || overrideCtr !== '' || overrideAgent !== '';

  const snapshot = useMemo<PricingSnapshot | null>(() => {
    if (!scenario || !negotiated) return null;
    const snapshotAgents: SnapshotAgent[] = scenario === 'agent' && selectedAgent
      ? [{
          id: selectedAgent.id,
          pct: effAgentPct,
          name: selectedAgent.name,
          email: selectedAgent.email ?? null,
          company: (selectedAgent as any).company ?? null,
        }]
      : [];
    return {
      propertyId: property.id,
      scenarioType: scenario,
      agentId: snapshotAgents[0]?.id ?? null,
      agents: snapshotAgents,
      agentContact: snapshotAgents[0]
        ? { name: snapshotAgents[0].name, email: snapshotAgents[0].email, company: snapshotAgents[0].company }
        : null,
      channelId: scenario === 'platform' ? selectedChannelId || null : null,
      baseline: baseRate,
      seasonTag: selectedSeason || null,
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
    setTargetGuest('');
    setOverrideCtr('');
    setOverrideAgent('');
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
    <>
      {/* Context bar — channel pill + season selector */}
      <div className="detail-modal-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: 0 }}>
        <button
          type="button"
          className="detail-modal-mode-badge detail-modal-mode-badge--view"
          style={{ cursor: 'pointer', border: 'none' }}
          onClick={() => setScenario(null)}
          title="Change channel"
        >
          {channelIcon} {channelLabel} · change
        </button>
        <div className="form-group" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label className="form-label" style={{ margin: 0 }}>Season</label>
          <select className="list-filter-select" value={selectedSeason} onChange={(e) => setSelectedSeason(e.target.value)}>
            <option value="Normal">Normal</option>
            {seasonTags.map(s => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Benchmark — read-only default for this channel + season */}
      <div className="detail-modal-section">
        <div className="detail-modal-section-heading">
          Default · {channelLabel} · {selectedSeason}
        </div>
        {benchmark && (
          <BreakdownRows
            scenario={scenario}
            breakdown={benchmark}
            ctrPct={defaultCtrPct}
            agentPct={defaultAgentPct}
            agentLabel={agentLabel}
          />
        )}
      </div>

      {/* Negotiate — editable inputs + live negotiated result with deltas */}
      <div className="detail-modal-section">
        <div className="detail-modal-section-heading">Negotiate</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Guest will pay</label>
            <input
              type="number"
              inputMode="numeric"
              className="form-input"
              value={targetGuest}
              onChange={(e) => setTargetGuest(e.target.value)}
              placeholder={benchmark ? `R ${Math.round(benchmark.clientPriceExclVat).toLocaleString()}` : ''}
              min={0}
              step="100"
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">CTR margin %</label>
            <input
              type="number"
              inputMode="numeric"
              className="form-input"
              value={overrideCtr}
              onChange={(e) => setOverrideCtr(e.target.value)}
              placeholder={String(defaultCtrPct)}
              min={0}
              max={100}
              step="1"
            />
          </div>
          {scenario === 'agent' && (
            <>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Agent commission %</label>
                <input
                  type="number"
                  inputMode="numeric"
                  className="form-input"
                  value={overrideAgent}
                  onChange={(e) => setOverrideAgent(e.target.value)}
                  placeholder={String(defaultAgentPct)}
                  min={0}
                  max={100}
                  step="1"
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Specific agent</label>
                <select className="form-input" value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}>
                  <option value="">Generic agent ({GENERIC_AGENT_PCT}%)</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.default_commission_pct}%)</option>
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

        {/* Negotiated result */}
        {negotiated && (
          <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
            <BreakdownRows
              scenario={scenario}
              breakdown={negotiated}
              ctrPct={effCtrPct}
              agentPct={effAgentPct}
              agentLabel={agentLabel}
              compareTo={overridesActive ? benchmark : null}
            />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={resetOverrides}
            disabled={!overridesActive}
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
    </>
  );
}
