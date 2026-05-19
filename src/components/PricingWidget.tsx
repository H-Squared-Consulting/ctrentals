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
/** A single agent's slot inside a proposal. `pct` is the effective
 *  commission used in this proposal (defaults to the agent's Settings
 *  default; overridable per-proposal without writing back to Settings). */
export interface SnapshotAgent {
  id: string;
  pct: number;
  /** Snapshot of the agent's display fields at the time of save — used by
   *  CreateProposalModal to pre-fill recipient info for the lead agent
   *  and by the proposal page to render names without an extra join. */
  name: string;
  email: string | null;
  company: string | null;
}

export interface PricingSnapshot {
  propertyId: string;
  scenarioType: ScenarioType;
  /** Legacy single-agent id. Mirrors agents[0]?.id when scenarioType ===
   *  'agent', else null. Kept so existing consumers that only read
   *  agent_id (CreateProposalModal pre-fill, etc.) still work. */
  agentId: string | null;
  /** Multi-agent split. Empty array for non-agent scenarios. */
  agents: SnapshotAgent[];
  /** Contact info of the *lead* agent (agents[0]), copied from Settings.
   *  Used by CreateProposalModal to pre-fill recipient name/email. */
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
  // Multi-agent split. Each entry is { id, pct } where pct is the effective
  // % to use *for this proposal*. In System mode the rows are read-only and
  // their pct mirrors the agent's Settings default; Override mode lets the
  // user adjust each pct without writing back to Settings.
  //
  // Edit-mode hydration: prefer `agents` (the new column); fall back to the
  // legacy `agent_id` for rows saved before multi-agent existed.
  const [selectedAgents, setSelectedAgents] = useState<Array<{ id: string; pct: number }>>(() => {
    if (initialSnapshot?.agents && initialSnapshot.agents.length > 0) {
      return initialSnapshot.agents.map(a => ({ id: a.id, pct: Number(a.pct) || 0 }));
    }
    if (initialSnapshot?.agent_id) {
      return [{ id: initialSnapshot.agent_id, pct: 0 }];
    }
    return [];
  });
  const [selectedChannelId, setSelectedChannelId] = useState(initialSnapshot?.channel_profile_id || '');
  const [selectedSeason, setSelectedSeason] = useState(initialSnapshot?.season_tag || 'Normal');

  // Override fields (string-typed so the input can be cleared without
  // coercing to NaN). Empty string = no override.
  const [overrideBase, setOverrideBase] = useState(
    initialSnapshot?.reduced_baseline != null ? String(initialSnapshot.reduced_baseline) : ''
  );
  const [overrideCtr, setOverrideCtr] = useState('');
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

        // Default season stays at 'Normal' until the user picks one. We
        // used to auto-detect from today's date, but that surprised users
        // who expected the calculator to open at the resting state.
      } catch (err) {
        console.error('PricingWidget load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [supabase, property?.id, currentYear]);

  // ── Derived ──
  // Once the Agents catalogue has loaded, seed any selected-agent rows
  // whose pct is still 0 with that agent's Settings default. Only runs
  // while in System mode — Override-mode pcts are explicit user input
  // and shouldn't be silently overwritten.
  useEffect(() => {
    if (!agents.length || selectedAgents.length === 0) return;
    setSelectedAgents(prev =>
      prev.map(sa => {
        if (sa.pct !== 0) return sa;
        const a = agents.find(x => x.id === sa.id);
        return a ? { ...sa, pct: Number(a.default_commission_pct) } : sa;
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  // Lead agent (first in the array) — used for the recipient pre-fill in
  // CreateProposalModal and the back-compat agent_id we still write.
  const leadAgent = useMemo(
    () => (selectedAgents[0] ? agents.find(a => a.id === selectedAgents[0].id) || null : null),
    [agents, selectedAgents]
  );

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) || null,
    [channels, selectedChannelId]
  );

  const seasonMultiplier = useMemo(() => {
    // "Normal" and the empty value are the calculator's 1.0× resting state.
    // Named seasons read their multiplier from the season_tags table.
    if (!selectedSeason || selectedSeason === 'Normal') return 1;
    const tag = seasonTags.find((s) => s.name === selectedSeason);
    return tag ? tag.multiplier : 1;
  }, [seasonTags, selectedSeason]);

  // CTR cut for the scenario (constant; overridable in Override mode).
  const systemCtrPct = CTR_DEFAULT[scenarioType];

  // Agent commission — sum across every selected agent.
  // System mode reads each agent's Settings default; Override mode uses the
  // per-row pct (which the user can edit). Falls back to 0 when no agents
  // are picked so the calc doesn't pretend.
  const systemAgentPct = useMemo(() => {
    if (scenarioType !== 'agent') return 0;
    return selectedAgents.reduce((sum, sa) => {
      // Skip rows where the user hasn't picked an agent yet — they
      // shouldn't contribute to the calc.
      if (!sa.id) return sum;
      const def = agents.find(a => a.id === sa.id);
      const pct = mode === 'override'
        ? sa.pct
        : (def ? Number(def.default_commission_pct) : sa.pct);
      return sum + (Number.isFinite(pct) ? pct : 0);
    }, 0);
  }, [scenarioType, selectedAgents, agents, mode]);

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
      // Per-agent override % is baked into systemAgentPct (see useMemo above);
      // no separate reducedAgentPct needed now that each row is independently
      // editable in Override mode.
      reducedAgentPct: null,
      solveFor: mode === 'override' ? solveFor : 'guest',
      targetGuestPrice: mode === 'override' && solveFor === 'base' && targetGuest !== '' ? Number(targetGuest) : null,
      vatEnabled: false,  // VAT is out of scope for the v1 widget; kept available in the engine for other consumers.
      vatRatePct: 0,
    });
  }, [
    baseline, scenarioType, systemCtrPct, systemAgentPct, seasonMultiplier,
    systemPlatformFeePct, systemPlatformFixedFee,
    mode, overrideBase, overrideCtr, solveFor, targetGuest,
  ]);

  // ── Snapshot builder for callbacks ──
  function buildSnapshot(): PricingSnapshot {
    // Resolve each selected agent against the loaded catalogue so we can
    // store name/email/company alongside the id — downstream consumers
    // (CreateProposalModal pre-fill, proposal page) read these without an
    // extra query.
    const resolvedAgents: SnapshotAgent[] = scenarioType === 'agent'
      ? selectedAgents
          .filter(sa => !!sa.id)  // drop any rows the user never picked
          .map(sa => {
            const a = agents.find(x => x.id === sa.id);
            const effPct = mode === 'override' ? sa.pct : (a ? Number(a.default_commission_pct) : sa.pct);
            return {
              id: sa.id,
              pct: effPct,
              name: a?.name || '',
              email: a?.email || null,
              company: a?.company || null,
            };
          })
      : [];

    return {
      propertyId: property.id,
      scenarioType,
      agentId: scenarioType === 'agent' ? (resolvedAgents[0]?.id || null) : null,
      agents: resolvedAgents,
      agentContact: resolvedAgents[0]
        ? { name: resolvedAgents[0].name, email: resolvedAgents[0].email, company: resolvedAgents[0].company }
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
      reducedAgentPct: null,
      totalMarginPct: breakdown.totalMarginPct,
      breakdown,
    };
  }

  function resetOverrides() {
    setOverrideBase('');
    setOverrideCtr('');
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
                <label className="form-label">
                  Agents
                  {selectedAgents.length > 0 && (
                    <span style={{ marginLeft: '6px', fontSize: '0.625rem', color: 'var(--text-light)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                      {selectedAgents.length} · total {systemAgentPct.toFixed(1)}%
                    </span>
                  )}
                </label>
                <div className="pricing-agents-list">
                  {selectedAgents.map((sa, idx) => {
                    const def = agents.find(a => a.id === sa.id);
                    // Show the current selection plus every agent not already
                    // picked by another row — keeps the dropdown short and
                    // prevents the same agent being selected twice.
                    const remaining = agents.filter(a =>
                      a.id === sa.id || !selectedAgents.some(s => s.id === a.id)
                    );
                    const displayPct = mode === 'override' ? sa.pct : (def ? Number(def.default_commission_pct) : sa.pct);
                    const unset = !sa.id;
                    return (
                      <div key={idx} className="pricing-agent-row">
                        <select
                          className="form-input"
                          value={sa.id}
                          onChange={(e) => {
                            const newId = e.target.value;
                            const newDef = agents.find(a => a.id === newId);
                            setSelectedAgents(prev => prev.map((row, i) =>
                              i === idx
                                ? { id: newId, pct: newDef ? Number(newDef.default_commission_pct) : 0 }
                                : row
                            ));
                          }}
                          style={{ flex: 1 }}
                        >
                          <option value="">-- Select agent --</option>
                          {remaining.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.name}{a.company ? ` — ${a.company}` : ''}
                            </option>
                          ))}
                        </select>
                        {mode === 'override' && !unset ? (
                          <input
                            type="number"
                            className="form-input pricing-field--overridden"
                            value={sa.pct}
                            onChange={(e) => {
                              const v = e.target.value === '' ? 0 : Number(e.target.value);
                              setSelectedAgents(prev => prev.map((row, i) =>
                                i === idx ? { ...row, pct: v } : row
                              ));
                            }}
                            min={0}
                            max={80}
                            step={0.5}
                            style={{ width: '70px' }}
                            title="Override commission % for this proposal only — does not change Settings"
                          />
                        ) : (
                          <span
                            className="pricing-agent-pct"
                            title={unset ? 'Pick an agent to see their commission' : 'Default commission from Settings → Agents'}
                          >
                            {unset ? '—' : `${displayPct.toFixed(1)}%`}
                          </span>
                        )}
                        <button
                          type="button"
                          className="pricing-agent-remove"
                          onClick={() => setSelectedAgents(prev => prev.filter((_, i) => i !== idx))}
                          title="Remove agent"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  {(() => {
                    // System mode is single-agent: button only shows when
                    // no agent is selected yet (lets the user pick the first
                    // one). To add more, the user has to flip to Override
                    // — the existing selection carries over.
                    // Override mode allows any number of agents up to the
                    // catalogue size.
                    const filledCount = selectedAgents.filter(sa => sa.id).length;
                    const canAdd = mode === 'override'
                      ? agents.length > filledCount
                      : selectedAgents.length === 0;
                    if (!canAdd) return null;
                    return (
                      <button
                        type="button"
                        className="btn btn-ghost pricing-agent-add"
                        onClick={() => {
                          setSelectedAgents(prev => [...prev, { id: '', pct: 0 }]);
                        }}
                      >
                        + Add agent
                      </button>
                    );
                  })()}
                  {mode !== 'override' && selectedAgents.filter(sa => sa.id).length >= 1 && agents.length > 1 && (
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)', padding: '2px 2px' }}>
                      Switch to Override to add more agents and adjust splits.
                    </div>
                  )}
                  {selectedAgents.length === 0 && agents.length === 0 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                      No agents in Settings yet. Add one via Settings → Agents.
                    </div>
                  )}
                </div>
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
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)', padding: '4px 2px' }}>
                  Edit each agent's commission % directly in the Agents row above.
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
            {scenarioType === 'agent' && (() => {
              const filled = selectedAgents.filter(sa => !!sa.id);
              return filled.length === 0 ? (
                <div className="pricing-breakdown-row">
                  <span className="pricing-breakdown-label">Agent earns</span>
                  <span className="pricing-breakdown-value">—</span>
                </div>
              ) : (
                filled.map((sa) => {
                  const def = agents.find(a => a.id === sa.id);
                  const effPct = mode === 'override' ? sa.pct : (def ? Number(def.default_commission_pct) : sa.pct);
                  // Each agent's share of the total agent take, proportional
                  // to their pct. Rounded to nearest rand for display.
                  const share = systemAgentPct > 0
                    ? Math.round((effPct / systemAgentPct) * agentTakeDisp)
                    : 0;
                  return (
                    <div key={sa.id} className="pricing-breakdown-row">
                      <span className="pricing-breakdown-label">
                        {def ? def.name : 'Agent'} earns ({effPct.toFixed(1)}%)
                      </span>
                      <span className="pricing-breakdown-value">
                        {share > 0 ? fmtRand(share) : '—'}
                      </span>
                    </div>
                  );
                })
              );
            })()}
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
                  disabled={saving || (scenarioType === 'agent' && selectedAgents.filter(sa => !!sa.id).length === 0)}
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
