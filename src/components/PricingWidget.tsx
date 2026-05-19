/**
 * PricingWidget
 *
 * Single, embeddable per-night pricing calculator. Two modes:
 *
 *   - System Pricing (default): read-only defaults, scenario toggle. The
 *     ladies pick Direct / Platform / Agent and see the numbers instantly.
 *
 *   - Override: editable fields + solve-for-X for negotiation. Switch via
 *     the "Override" button. "Reset to System" returns to defaults.
 *
 * The widget loads its own data (baseline, seasons, agents, channels) so
 * any host page just needs to pass `property` + `supabase`. Actions
 * (Create Proposal, Share Calc) are emitted as callbacks — the host
 * decides what to persist.
 */

import { useState, useEffect, useMemo } from 'react';
import { calculatePricing, CTR_DEFAULT, fmtRand } from '../lib/pricingEngine';
import { SCENARIO_TYPE_OPTIONS, SEASON_TAG_OPTIONS, CT_RENTALS_PARTNER_ID } from '../pages/constants';
import type { Baseline, SeasonTag, Agent, ChannelProfile, PricingBreakdown, PricingProposal } from '../types/pricing';

const SEASON_COLORS: Record<string, { color: string; bg: string }> = {
  Peak: { color: '#991B1B', bg: '#FEE2E2' },
  High: { color: '#92400E', bg: '#FEF3C7' },
  Mid:  { color: '#065F46', bg: '#D1FAE5' },
  Low:  { color: '#1E40AF', bg: '#DBEAFE' },
};

export type ScenarioType = 'direct' | 'agent' | 'platform';
export type SolveMode = 'guest' | 'base';

/** Full immutable snapshot of the widget's current state. Emitted to host
 * callbacks (Create Proposal / Share Calc) so the host can persist. */
export interface PricingSnapshot {
  propertyId: string;
  scenarioType: ScenarioType;
  agentId: string | null;
  /** Contact info of the selected agent, copied from Settings → Agents.
   *  Lets the CreateProposal modal pre-fill name/email instead of asking
   *  the ladies to retype data we already have on file. Only set when
   *  scenarioType === 'agent' and an agent is selected. */
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

export interface PricingWidgetProps {
  property: { id: string; property_name: string };
  supabase: any;
  /** When provided, renders a "Create Proposal" button. */
  onCreateProposal?: (snapshot: PricingSnapshot) => void;
  /** When provided, renders a "Share Calc" button. */
  onShareCalc?: (snapshot: PricingSnapshot) => void;
  /** Compact mode shrinks vertical padding for use inside drawers. */
  compact?: boolean;
  /** Initial mode. Defaults to 'system'. */
  initialMode?: 'system' | 'override';
  /** Disables Create Proposal while the host is saving (prevents double-submit). */
  saving?: boolean;
  /** Pre-fill the widget with a saved pricing snapshot (edit-mode). */
  initialSnapshot?: PricingProposal | null;
  /** Override the primary button label (e.g. "Save Pricing" in edit mode). */
  actionLabel?: string;
}

export default function PricingWidget({
  property,
  supabase,
  onCreateProposal,
  onShareCalc,
  compact = false,
  initialMode = 'system',
  saving = false,
  initialSnapshot = null,
  actionLabel,
}: PricingWidgetProps) {
  const currentYear = new Date().getFullYear();

  // ── Data ──
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [seasonTags, setSeasonTags] = useState<SeasonTag[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<ChannelProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // ── State (hydrate from initialSnapshot if in edit mode) ──
  // Edit-mode pre-fill: scenario/agent/channel/season come straight from the
  // saved row. The CTR/agent split can't be reconstructed from the stored
  // total margin %, so we put the combined override on `overrideBase` only —
  // the user can switch to Override mode if they want to fiddle further.
  const hasInitial = Boolean(initialSnapshot);
  const [mode, setMode] = useState<'system' | 'override'>(
    hasInitial && (initialSnapshot!.reduced_baseline != null || initialSnapshot!.reduced_commission_pct != null)
      ? 'override'
      : initialMode
  );
  const [scenarioType, setScenarioType] = useState<ScenarioType>(
    (initialSnapshot?.scenario_type as ScenarioType) || 'direct'
  );
  const [selectedAgentId, setSelectedAgentId] = useState(initialSnapshot?.agent_id || '');
  const [selectedChannelId, setSelectedChannelId] = useState(initialSnapshot?.channel_profile_id || '');
  const [selectedSeason, setSelectedSeason] = useState(initialSnapshot?.season_tag || '');

  // Override fields (string-typed so the input can be cleared without
  // coercing to NaN). Empty string = no override.
  const [overrideBase, setOverrideBase] = useState(
    initialSnapshot?.reduced_baseline != null ? String(initialSnapshot.reduced_baseline) : ''
  );
  const [overrideCtr, setOverrideCtr] = useState('');
  const [overrideAgent, setOverrideAgent] = useState('');
  const [overridePlatformFee, setOverridePlatformFee] = useState('');
  const [solveFor, setSolveFor] = useState<SolveMode>('guest');
  const [targetGuest, setTargetGuest] = useState('');

  // ── Load ──
  useEffect(() => {
    if (!supabase || !property?.id) return;

    async function load() {
      setLoading(true);
      try {
        const [baselineRes, seasonRes, agentRes, channelRes] = await Promise.all([
          supabase.from('baselines').select('*').eq('property_id', property.id).eq('year', currentYear).maybeSingle(),
          supabase.from('season_tags').select('*').or(`property_id.eq.${property.id},property_id.is.null`).order('start_date'),
          supabase.from('agents').select('*').order('name'),
          supabase.from('channel_defaults').select('*').eq('partner_id', CT_RENTALS_PARTNER_ID).eq('is_active', true).order('platform_name'),
        ]);

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
        }

        // Auto-detect current season — but only if we don't already have one
        // from initialSnapshot (edit mode), so we don't clobber the user's choice.
        if (!initialSnapshot?.season_tag && seasonRes.data?.length) {
          const today = new Date().toISOString().split('T')[0];
          const active = seasonRes.data.find(
            (s: SeasonTag) => s.start_date <= today && s.end_date >= today
          );
          if (active) setSelectedSeason(active.name);
        }
      } catch (err) {
        console.error('PricingWidget load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [supabase, property?.id, currentYear]);

  // ── Derived ──
  const activeAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) || null,
    [agents, selectedAgentId]
  );

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) || null,
    [channels, selectedChannelId]
  );

  const seasonMultiplier = useMemo(() => {
    if (!selectedSeason) return 1;
    const tag = seasonTags.find((s) => s.name === selectedSeason);
    return tag ? tag.multiplier : 1;
  }, [seasonTags, selectedSeason]);

  // CTR cut for the scenario (constant; overridable in Override mode).
  const systemCtrPct = CTR_DEFAULT[scenarioType];

  // Agent commission — read LIVE from Settings → Agents (no hardcoding).
  // Falls back to 0 if no agent selected so the calc doesn't pretend.
  const systemAgentPct = scenarioType === 'agent' && activeAgent
    ? Number(activeAgent.default_commission_pct)
    : 0;

  const systemPlatformFeePct = scenarioType === 'platform' && activeChannel
    ? activeChannel.platform_fee_pct
    : 0;

  const systemPlatformFixedFee = scenarioType === 'platform' && activeChannel
    ? activeChannel.platform_fixed_fee
    : 0;

  // ── Calc ──
  const breakdown: PricingBreakdown = useMemo(() => {
    const baseValue = baseline?.daily_rate ?? 0;
    return calculatePricing({
      baseline: baseValue,
      scenarioType,
      ctrPct: systemCtrPct,
      agentPct: systemAgentPct,
      seasonMultiplier,
      platformFeePct: systemPlatformFeePct,
      platformFixedFee: systemPlatformFixedFee,
      reducedBaseline: mode === 'override' && overrideBase !== '' ? Number(overrideBase) / seasonMultiplier : null,
      reducedCtrPct: mode === 'override' && overrideCtr !== '' ? Number(overrideCtr) : null,
      reducedAgentPct: mode === 'override' && overrideAgent !== '' ? Number(overrideAgent) : null,
      solveFor: mode === 'override' ? solveFor : 'guest',
      targetGuestPrice: mode === 'override' && solveFor === 'base' && targetGuest !== '' ? Number(targetGuest) : null,
      vatEnabled: false,  // VAT is out of scope for the v1 widget; kept available in the engine for other consumers.
      vatRatePct: 0,
    });
  }, [
    baseline, scenarioType, systemCtrPct, systemAgentPct, seasonMultiplier,
    systemPlatformFeePct, systemPlatformFixedFee,
    mode, overrideBase, overrideCtr, overrideAgent, solveFor, targetGuest,
  ]);

  // ── Snapshot builder for callbacks ──
  function buildSnapshot(): PricingSnapshot {
    return {
      propertyId: property.id,
      scenarioType,
      agentId: scenarioType === 'agent' ? selectedAgentId || null : null,
      agentContact: scenarioType === 'agent' && activeAgent
        ? { name: activeAgent.name, email: activeAgent.email, company: activeAgent.company }
        : null,
      channelId: scenarioType === 'platform' ? selectedChannelId || null : null,
      baseline: baseline?.daily_rate ?? 0,
      seasonTag: selectedSeason || null,
      seasonMultiplier,
      ctrPct: systemCtrPct,
      agentPct: systemAgentPct,
      platformFeePct: systemPlatformFeePct,
      platformFixedFee: systemPlatformFixedFee,
      reducedBaseline: mode === 'override' && overrideBase !== '' ? Number(overrideBase) : null,
      reducedCtrPct: mode === 'override' && overrideCtr !== '' ? Number(overrideCtr) : null,
      reducedAgentPct: mode === 'override' && overrideAgent !== '' ? Number(overrideAgent) : null,
      totalMarginPct: breakdown.totalMarginPct,
      breakdown,
    };
  }

  function resetOverrides() {
    setOverrideBase('');
    setOverrideCtr('');
    setOverrideAgent('');
    setOverridePlatformFee('');
    setTargetGuest('');
    setSolveFor('guest');
    setMode('system');
  }

  // ── Display ──
  // Round each visible line to nearest rand. Guest price is the rounded
  // headline; CTR absorbs the ≤R1 rounding remainder so the breakdown
  // reconciles with what the user sees.
  const ownerNetDisp = Math.round(breakdown.ownerNet);
  const guestPaysDisp = Math.round(breakdown.clientPriceExclVat);
  const platformFeesDisp = Math.round(breakdown.platformFees);
  const agentTakeDisp = Math.round(breakdown.agentTake);
  const ctrTakeDisp = guestPaysDisp - ownerNetDisp - agentTakeDisp - platformFeesDisp;

  // Margin / markup display strings (always both, per spec).
  const ctrMarginStr = breakdown.effectiveCtrMarginPct.toFixed(1);

  // Guardrails — warnings only, never block the calc.
  const guardrails: string[] = [];
  if (mode === 'override') {
    if (breakdown.totalMarginPct > 80) {
      guardrails.push('Total margin over 80% — sanity check the inputs.');
    }
    if (breakdown.ownerNet < 0) {
      guardrails.push('Guest rate too low to cover costs at these margins.');
    }
    if (baseline && breakdown.adjustedBaseline > 0 && breakdown.adjustedBaseline < baseline.daily_rate * seasonMultiplier && overrideBase !== '') {
      guardrails.push(`Below the owner's agreed baseline of ${fmtRand(baseline.daily_rate * seasonMultiplier)}.`);
    }
  }

  // ── Render ──
  if (loading) {
    return (
      <div className="pricing-widget pricing-widget--loading">
        <div className="spinner" />
      </div>
    );
  }

  if (!baseline) {
    return (
      <div className="pricing-widget">
        <div className="pricing-no-baseline">
          No baseline for {currentYear}. Add one in the property editor.
        </div>
      </div>
    );
  }

  const isOverride = mode === 'override';

  return (
    <div className={`pricing-widget ${compact ? 'pricing-widget--compact' : ''}`}>
      {/* Top toolbar: season + mode toggle */}
      <div className="pricing-widget-toolbar">
        <div className="pricing-widget-toolbar-left">
          <label className="form-label" style={{ marginBottom: 0 }}>Season</label>
          <select
            className="form-input"
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">No season (1.0x)</option>
            {SEASON_TAG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {selectedSeason && (
            <span
              className="status-badge"
              style={{
                background: SEASON_COLORS[selectedSeason]?.bg || '#F3F4F6',
                color: SEASON_COLORS[selectedSeason]?.color || '#6B7280',
              }}
            >
              {selectedSeason} ×{seasonMultiplier}
            </span>
          )}
        </div>
        <div className="pricing-widget-toolbar-right">
          <button
            className={`pricing-toggle-btn ${!isOverride ? 'active' : ''}`}
            onClick={() => setMode('system')}
          >
            System
          </button>
          <button
            className={`pricing-toggle-btn ${isOverride ? 'active' : ''}`}
            onClick={() => setMode('override')}
          >
            Override
          </button>
        </div>
      </div>

      <div className="pricing-layout">
        {/* ── LEFT: Inputs ── */}
        <div className="pricing-inputs">
          {/* Scenario */}
          <div className="pricing-section">
            <h3 className="pricing-section-title">Scenario</h3>
            <div className="pricing-scenario-btns">
              {SCENARIO_TYPE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`pricing-toggle-btn ${scenarioType === o.value ? 'active' : ''}`}
                  onClick={() => setScenarioType(o.value as ScenarioType)}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {scenarioType === 'agent' && (
              <div className="form-group" style={{ marginTop: '8px' }}>
                <label className="form-label">Agent</label>
                <select
                  className="form-input"
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                >
                  <option value="">-- Select agent --</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}{a.company ? ` — ${a.company}` : ''} ({a.default_commission_pct}%)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {scenarioType === 'platform' && (
              <div className="form-group" style={{ marginTop: '8px' }}>
                <label className="form-label">Platform</label>
                <select
                  className="form-input"
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                >
                  <option value="">-- Select platform --</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.platform_name} ({c.platform_fee_pct}%{c.platform_fixed_fee > 0 ? ` + ${fmtRand(c.platform_fixed_fee)}` : ''})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Override fields */}
          {isOverride && (
            <div className="pricing-section">
              <h3 className="pricing-section-title">Override</h3>

              <div className="form-group" style={{ marginBottom: '8px' }}>
                <label className="form-label">Solve for</label>
                <div className="pricing-baseline-toggle">
                  <button
                    className={`pricing-toggle-btn ${solveFor === 'guest' ? 'active' : ''}`}
                    onClick={() => setSolveFor('guest')}
                  >
                    Guest Rate
                  </button>
                  <button
                    className={`pricing-toggle-btn ${solveFor === 'base' ? 'active' : ''}`}
                    onClick={() => setSolveFor('base')}
                  >
                    Base Rate
                  </button>
                </div>
              </div>

              {solveFor === 'base' && (
                <div className="form-group">
                  <label className="form-label">Target Guest Rate</label>
                  <input
                    type="number"
                    className={`form-input ${targetGuest !== '' ? 'pricing-field--overridden' : ''}`}
                    value={targetGuest}
                    onChange={(e) => setTargetGuest(e.target.value)}
                    placeholder={String(Math.round(breakdown.clientPriceExclVat))}
                    min={0}
                    step={1}
                  />
                </div>
              )}

              {solveFor === 'guest' && (
                <div className="form-group">
                  <label className="form-label">Owner receives (per night)</label>
                  <input
                    type="number"
                    className={`form-input ${overrideBase !== '' ? 'pricing-field--overridden' : ''}`}
                    value={overrideBase}
                    onChange={(e) => setOverrideBase(e.target.value)}
                    placeholder={String(Math.round((baseline.daily_rate ?? 0) * seasonMultiplier))}
                    min={0}
                    step={1}
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">CTR Margin %</label>
                <input
                  type="number"
                  className={`form-input ${overrideCtr !== '' ? 'pricing-field--overridden' : ''}`}
                  value={overrideCtr}
                  onChange={(e) => setOverrideCtr(e.target.value)}
                  placeholder={String(systemCtrPct)}
                  min={0}
                  max={80}
                  step={0.5}
                />
              </div>

              {scenarioType === 'agent' && (
                <div className="form-group">
                  <label className="form-label">Agent %</label>
                  <input
                    type="number"
                    className={`form-input ${overrideAgent !== '' ? 'pricing-field--overridden' : ''}`}
                    value={overrideAgent}
                    onChange={(e) => setOverrideAgent(e.target.value)}
                    placeholder={String(systemAgentPct)}
                    min={0}
                    max={80}
                    step={0.5}
                  />
                </div>
              )}

              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', marginTop: '4px' }} onClick={resetOverrides}>
                ↺ Reset to System
              </button>
            </div>
          )}
        </div>

        {/* ── RIGHT: Output ── */}
        <div className="pricing-output">
          {/* Price block — headline + light context line below */}
          <div className="pricing-price-block">
            <div className="pricing-price-label">Guest pays</div>
            <div className="pricing-price-value">{fmtRand(guestPaysDisp)}</div>
            <div className="pricing-price-sublabel">
              per night{selectedSeason ? ` · ${selectedSeason} season (×${seasonMultiplier})` : ''}
            </div>
          </div>

          {/* Breakdown — where the money goes */}
          <div className="pricing-breakdown">
            <div className="pricing-breakdown-row">
              <span className="pricing-breakdown-label">Owner receives</span>
              <span className="pricing-breakdown-value">{fmtRand(ownerNetDisp)}</span>
            </div>
            <div className="pricing-breakdown-row">
              <span className="pricing-breakdown-label">CTR earns ({ctrMarginStr}%)</span>
              <span className="pricing-breakdown-value pricing-breakdown-value--accent">
                {fmtRand(ctrTakeDisp)}
              </span>
            </div>
            {scenarioType === 'agent' && (
              <div className="pricing-breakdown-row">
                <span className="pricing-breakdown-label">
                  Agent earns{activeAgent ? ` (${activeAgent.name})` : ''} ({overrideAgent !== '' ? overrideAgent : systemAgentPct}%)
                </span>
                <span className="pricing-breakdown-value">
                  {agentTakeDisp > 0 ? fmtRand(agentTakeDisp) : '—'}
                </span>
              </div>
            )}
            {scenarioType === 'platform' && (
              <div className="pricing-breakdown-row pricing-breakdown-row--platform">
                <span className="pricing-breakdown-label">
                  Platform fee{systemPlatformFeePct > 0 ? ` (${systemPlatformFeePct}%)` : ''}
                </span>
                <span className="pricing-breakdown-value">
                  {platformFeesDisp > 0 ? fmtRand(platformFeesDisp) : '—'}
                </span>
              </div>
            )}
          </div>


          {/* Guardrails */}
          {guardrails.length > 0 && (
            <div className="pricing-warning">
              {guardrails.map((g, i) => <div key={i}>⚠ {g}</div>)}
            </div>
          )}

          {/* Action bar */}
          {(onCreateProposal || onShareCalc) && (
            <div className="pricing-actions">
              {onCreateProposal && (
                <button
                  className="btn btn-primary"
                  onClick={() => onCreateProposal(buildSnapshot())}
                  disabled={saving || (scenarioType === 'agent' && !selectedAgentId)}
                >
                  {saving ? 'Saving…' : (actionLabel || 'Create Proposal')}
                </button>
              )}
              {onShareCalc && (
                <button
                  className="btn btn-outline"
                  onClick={() => onShareCalc(buildSnapshot())}
                >
                  Share Calc
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Build a plain-text breakdown suitable for Share Calc (WhatsApp / email).
 *  Exposed so any host that handles `onShareCalc` can produce the same text. */
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
