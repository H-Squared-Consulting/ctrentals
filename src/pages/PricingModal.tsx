/* eslint-disable */
// @ts-nocheck
/**
 * PricingModal -- Two-panel pricing calculator + proposal manager
 */

import { useState, useEffect, useMemo } from 'react';
import { calculatePricing } from '../lib/pricingEngine';
import DataTable from '../components/DataTable';
import { StatusBadge } from '../components/DataTable';
import { PRICING_PROPOSAL_STATUS_CONFIG, SEASON_TAG_OPTIONS, CALC_METHOD_OPTIONS, SCENARIO_TYPE_OPTIONS, PLATFORM_NAME_OPTIONS } from './constants';
import type { Baseline, SeasonTag, Agent, ChannelProfile, PricingProposal, VatSettings, PricingBreakdown } from '../types/pricing';

const SEASON_COLORS: Record<string, { color: string; bg: string }> = {
  Peak: { color: '#991B1B', bg: '#FEE2E2' },
  High: { color: '#92400E', bg: '#FEF3C7' },
  Mid:  { color: '#065F46', bg: '#D1FAE5' },
  Low:  { color: '#1E40AF', bg: '#DBEAFE' },
};

export default function PricingModal({ property, onClose, supabase }) {
  const [activeTab, setActiveTab] = useState<'calculator' | 'proposals'>('calculator');

  // Data
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [seasonTags, setSeasonTags] = useState<SeasonTag[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<ChannelProfile[]>([]);
  const [proposals, setProposals] = useState<PricingProposal[]>([]);
  const [vatSettings, setVatSettings] = useState<VatSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Form inputs
  const [baselineMode, setBaselineMode] = useState<'daily' | 'monthly'>('daily');
  const [scenarioType, setScenarioType] = useState<'direct' | 'agent' | 'platform'>('direct');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [selectedSeason, setSelectedSeason] = useState('');
  const [calcMethod, setCalcMethod] = useState<'margin' | 'markup'>('margin');
  const [commissionPct, setCommissionPct] = useState(15);
  const [showOverrides, setShowOverrides] = useState(false);
  const [reducedBaseline, setReducedBaseline] = useState('');
  const [reducedCommission, setReducedCommission] = useState('');
  const [proposalNotes, setProposalNotes] = useState('');

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const currentYear = new Date().getFullYear();

  // ── Load all data ──
  useEffect(() => {
    if (!supabase || !property?.id) return;

    async function loadData() {
      setLoading(true);
      try {
        const [baselineRes, seasonRes, agentRes, channelRes, proposalRes, vatRes] = await Promise.all([
          supabase.from('baselines').select('*').eq('property_id', property.id).eq('year', currentYear).maybeSingle(),
          supabase.from('season_tags').select('*').or(`property_id.eq.${property.id},property_id.is.null`).order('start_date'),
          supabase.from('agents').select('*').order('name'),
          supabase.from('channel_profiles').select('*').eq('property_id', property.id).order('platform_name'),
          supabase.from('pricing_proposals').select('*').eq('property_id', property.id).order('created_at', { ascending: false }),
          supabase.from('vat_settings').select('*').limit(1).maybeSingle(),
        ]);

        if (baselineRes.data) setBaseline(baselineRes.data);
        if (seasonRes.data) setSeasonTags(seasonRes.data);
        if (agentRes.data) setAgents(agentRes.data);
        if (channelRes.data) setChannels(channelRes.data);
        if (proposalRes.data) setProposals(proposalRes.data);
        if (vatRes.data) setVatSettings(vatRes.data);

        // Auto-detect current season
        if (seasonRes.data?.length) {
          const today = new Date().toISOString().split('T')[0];
          const activeSeason = seasonRes.data.find(
            (s) => s.start_date <= today && s.end_date >= today
          );
          if (activeSeason) setSelectedSeason(activeSeason.name);
        }
      } catch (err) {
        console.error('Error loading pricing data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [supabase, property?.id]);

  // ── Derived values ──
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

  const currentBaseline = useMemo(() => {
    if (!baseline) return 0;
    return baselineMode === 'daily' ? baseline.daily_rate : baseline.monthly_rate;
  }, [baseline, baselineMode]);

  // Auto-fill commission when agent/channel changes
  useEffect(() => {
    if (scenarioType === 'agent' && activeAgent) {
      setCommissionPct(activeAgent.default_commission_pct);
    }
  }, [scenarioType, activeAgent]);

  // ── Calculate pricing in real-time ──
  const breakdown: PricingBreakdown = useMemo(() => {
    return calculatePricing({
      baseline: currentBaseline,
      baselineMode,
      scenarioType,
      calcMethod,
      commissionPct,
      seasonMultiplier,
      platformFeePct: scenarioType === 'platform' && activeChannel ? activeChannel.platform_fee_pct : 0,
      platformFixedFee: scenarioType === 'platform' && activeChannel ? activeChannel.platform_fixed_fee : 0,
      reducedBaseline: reducedBaseline !== '' ? Number(reducedBaseline) : null,
      reducedCommission: reducedCommission !== '' ? Number(reducedCommission) : null,
      vatEnabled: vatSettings?.vat_enabled || false,
      vatRatePct: vatSettings?.vat_rate_pct || 15,
    });
  }, [
    currentBaseline, baselineMode, scenarioType, calcMethod, commissionPct,
    seasonMultiplier, activeChannel, reducedBaseline, reducedCommission, vatSettings,
  ]);

  // ── Save proposal ──
  async function handleCreateProposal() {
    if (!baseline) { alert('No baseline set for this property. Add a baseline first.'); return; }
    setSaving(true);
    setSaveMessage('');
    try {
      const payload = {
        property_id: property.id,
        scenario_type: scenarioType,
        agent_id: scenarioType === 'agent' ? selectedAgentId || null : null,
        channel_profile_id: scenarioType === 'platform' ? selectedChannelId || null : null,
        baseline_used: currentBaseline,
        baseline_mode: baselineMode,
        season_tag: selectedSeason || null,
        season_multiplier: seasonMultiplier,
        calc_method: calcMethod,
        commission_pct: reducedCommission !== '' ? Number(reducedCommission) : commissionPct,
        owner_net: breakdown.ownerNet,
        company_take: breakdown.companyTake,
        client_price_excl_vat: breakdown.clientPriceExclVat,
        vat_enabled: vatSettings?.vat_enabled || false,
        vat_rate_pct: vatSettings?.vat_rate_pct || 15,
        vat_amount: breakdown.vatAmount,
        client_price_incl_vat: breakdown.clientPriceInclVat,
        status: 'draft',
        notes: proposalNotes.trim() || null,
      };

      const { data, error } = await supabase.from('pricing_proposals').insert(payload).select();
      if (error) throw error;

      setProposals((prev) => [data[0], ...prev]);
      setSaveMessage('Proposal created');
      setProposalNotes('');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      console.error('Error creating proposal:', err);
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Update proposal status ──
  async function handleStatusChange(proposalId: string, newStatus: string) {
    try {
      const { error } = await supabase
        .from('pricing_proposals')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', proposalId);
      if (error) throw error;
      setProposals((prev) =>
        prev.map((p) => (p.id === proposalId ? { ...p, status: newStatus, updated_at: new Date().toISOString() } : p))
      );
    } catch (err) {
      console.error('Error updating proposal:', err);
      alert('Failed to update: ' + err.message);
    }
  }

  const fmt = (n: number) => `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── Proposal table columns ──
  const proposalColumns = [
    {
      key: 'created_at', label: 'Date', sortable: true,
      render: (row) => new Date(row.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }),
    },
    {
      key: 'scenario_type', label: 'Scenario',
      render: (row) => {
        const opt = SCENARIO_TYPE_OPTIONS.find((o) => o.value === row.scenario_type);
        return opt ? opt.label : row.scenario_type;
      },
    },
    {
      key: 'client_price_incl_vat', label: 'Client Price', align: 'right',
      render: (row) => fmt(row.client_price_incl_vat),
    },
    {
      key: 'status', label: 'Status', align: 'center',
      render: (row) => <StatusBadge status={row.status} config={PRICING_PROPOSAL_STATUS_CONFIG} />,
    },
    {
      key: 'expiry_date', label: 'Expiry', hideOnMobile: true,
      render: (row) => row.expiry_date || '-',
    },
  ];

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal pricing-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="modal-title">Pricing — {property.property_name}</h2>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
          <div className="modal-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
            <div className="spinner" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pricing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Pricing — {property.property_name}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="pricing-tabs">
              <button
                className={`pricing-tab ${activeTab === 'calculator' ? 'active' : ''}`}
                onClick={() => setActiveTab('calculator')}
              >
                Calculator
              </button>
              <button
                className={`pricing-tab ${activeTab === 'proposals' ? 'active' : ''}`}
                onClick={() => setActiveTab('proposals')}
              >
                Proposals ({proposals.length})
              </button>
            </div>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
        </div>

        <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
          {activeTab === 'calculator' && (
            <div className="pricing-layout">
              {/* ── LEFT PANEL: Inputs ── */}
              <div className="pricing-inputs">
                {/* Baseline */}
                <div className="pricing-section">
                  <h3 className="pricing-section-title">Baseline</h3>
                  {baseline ? (
                    <>
                      <div className="pricing-baseline-toggle">
                        <button
                          className={`pricing-toggle-btn ${baselineMode === 'daily' ? 'active' : ''}`}
                          onClick={() => setBaselineMode('daily')}
                        >
                          Daily
                        </button>
                        <button
                          className={`pricing-toggle-btn ${baselineMode === 'monthly' ? 'active' : ''}`}
                          onClick={() => setBaselineMode('monthly')}
                        >
                          Monthly
                        </button>
                      </div>
                      <div className="pricing-baseline-value">
                        {fmt(currentBaseline)}
                        <span className="pricing-baseline-year">{baseline.year}</span>
                        {baseline.locked && <span className="pricing-baseline-lock">Locked</span>}
                      </div>
                    </>
                  ) : (
                    <div className="pricing-no-baseline">
                      No baseline for {currentYear}. Add one in the property editor.
                    </div>
                  )}
                </div>

                {/* Season */}
                <div className="pricing-section">
                  <h3 className="pricing-section-title">Season</h3>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      className="form-input"
                      value={selectedSeason}
                      onChange={(e) => setSelectedSeason(e.target.value)}
                      style={{ flex: 1 }}
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
                        {seasonMultiplier}x
                      </span>
                    )}
                  </div>
                </div>

                {/* Scenario */}
                <div className="pricing-section">
                  <h3 className="pricing-section-title">Scenario</h3>
                  <div className="pricing-scenario-btns">
                    {SCENARIO_TYPE_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        className={`pricing-toggle-btn ${scenarioType === o.value ? 'active' : ''}`}
                        onClick={() => setScenarioType(o.value)}
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
                          <option key={a.id} value={a.id}>{a.name} ({a.default_commission_pct}%)</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {scenarioType === 'platform' && (
                    <div className="form-group" style={{ marginTop: '8px' }}>
                      <label className="form-label">Channel</label>
                      <select
                        className="form-input"
                        value={selectedChannelId}
                        onChange={(e) => setSelectedChannelId(e.target.value)}
                      >
                        <option value="">-- Select channel --</option>
                        {channels.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.platform_name} ({c.platform_fee_pct}% + R{c.platform_fixed_fee})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Commission & Method */}
                <div className="pricing-section">
                  <h3 className="pricing-section-title">Commission</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div className="form-group">
                      <label className="form-label">Commission %</label>
                      <input
                        type="number"
                        className="form-input"
                        value={commissionPct}
                        onChange={(e) => setCommissionPct(Number(e.target.value))}
                        min={0}
                        max={100}
                        step="0.5"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Calc Method</label>
                      <div className="pricing-baseline-toggle">
                        {CALC_METHOD_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            className={`pricing-toggle-btn ${calcMethod === o.value ? 'active' : ''}`}
                            onClick={() => setCalcMethod(o.value)}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Overrides */}
                <div className="pricing-section">
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '4px 0' }}
                    onClick={() => setShowOverrides(!showOverrides)}
                  >
                    {showOverrides ? '▾' : '▸'} Overrides (concessions)
                  </button>
                  {showOverrides && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '6px' }}>
                      <div className="form-group">
                        <label className="form-label">Reduced Baseline</label>
                        <input
                          type="number"
                          className="form-input"
                          value={reducedBaseline}
                          onChange={(e) => setReducedBaseline(e.target.value)}
                          placeholder={currentBaseline.toString()}
                          min={0}
                          step="0.01"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Reduced Commission %</label>
                        <input
                          type="number"
                          className="form-input"
                          value={reducedCommission}
                          onChange={(e) => setReducedCommission(e.target.value)}
                          placeholder={commissionPct.toString()}
                          min={0}
                          max={100}
                          step="0.5"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="pricing-section">
                  <div className="form-group">
                    <label className="form-label">Proposal Notes</label>
                    <textarea
                      className="form-input"
                      rows={2}
                      value={proposalNotes}
                      onChange={(e) => setProposalNotes(e.target.value)}
                      placeholder="Optional notes..."
                    />
                  </div>
                </div>
              </div>

              {/* ── RIGHT PANEL: Output ── */}
              <div className="pricing-output">
                <div className="pricing-price-block">
                  <div className="pricing-price-label">Client Pays</div>
                  <div className="pricing-price-value">{fmt(breakdown.clientPriceInclVat)}</div>
                  <div className="pricing-price-sublabel">
                    per {baselineMode === 'daily' ? 'night' : 'month'}
                    {selectedSeason && (
                      <span
                        className="status-badge"
                        style={{
                          marginLeft: '8px',
                          background: SEASON_COLORS[selectedSeason]?.bg || '#F3F4F6',
                          color: SEASON_COLORS[selectedSeason]?.color || '#6B7280',
                        }}
                      >
                        {selectedSeason}
                      </span>
                    )}
                  </div>
                </div>

                <div className="pricing-breakdown">
                  <div className="pricing-breakdown-row">
                    <span className="pricing-breakdown-label">Owner nets</span>
                    <span className="pricing-breakdown-value">{fmt(breakdown.ownerNet)}</span>
                  </div>
                  <div className="pricing-breakdown-row">
                    <span className="pricing-breakdown-label">Company earns</span>
                    <span className="pricing-breakdown-value pricing-breakdown-value--accent">{fmt(breakdown.companyTake)}</span>
                  </div>
                  <div className="pricing-breakdown-row pricing-breakdown-row--total">
                    <span className="pricing-breakdown-label">Client pays (excl VAT)</span>
                    <span className="pricing-breakdown-value">{fmt(breakdown.clientPriceExclVat)}</span>
                  </div>
                  {vatSettings?.vat_enabled && (
                    <>
                      <div className="pricing-breakdown-row">
                        <span className="pricing-breakdown-label">VAT ({vatSettings.vat_rate_pct}%)</span>
                        <span className="pricing-breakdown-value">{fmt(breakdown.vatAmount)}</span>
                      </div>
                      <div className="pricing-breakdown-row pricing-breakdown-row--total">
                        <span className="pricing-breakdown-label">Client pays (incl VAT)</span>
                        <span className="pricing-breakdown-value" style={{ fontWeight: 700 }}>{fmt(breakdown.clientPriceInclVat)}</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="pricing-meta">
                  <div className="pricing-meta-row">
                    <span>Scenario</span>
                    <span>{SCENARIO_TYPE_OPTIONS.find((o) => o.value === scenarioType)?.label}</span>
                  </div>
                  <div className="pricing-meta-row">
                    <span>Method</span>
                    <span>{calcMethod === 'margin' ? 'Margin' : 'Markup'} @ {reducedCommission !== '' ? reducedCommission : commissionPct}%</span>
                  </div>
                  {scenarioType === 'platform' && activeChannel && (
                    <div className="pricing-meta-row">
                      <span>Platform fees</span>
                      <span>{activeChannel.platform_fee_pct}% + R{activeChannel.platform_fixed_fee}</span>
                    </div>
                  )}
                  {reducedBaseline !== '' && (
                    <div className="pricing-meta-row">
                      <span>Owner concession</span>
                      <span>{fmt(currentBaseline)} → {fmt(Number(reducedBaseline))}</span>
                    </div>
                  )}
                </div>

                {saveMessage && (
                  <div style={{ padding: '8px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 'var(--radius-sm)', fontSize: '0.8125rem', textAlign: 'center', marginTop: '8px' }}>
                    {saveMessage}
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '12px' }}
                  onClick={handleCreateProposal}
                  disabled={saving || !baseline}
                >
                  {saving ? 'Saving...' : 'Create Proposal'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'proposals' && (
            <div>
              {proposals.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-state-message">No pricing proposals yet. Use the calculator to create one.</p>
                </div>
              ) : (
                <DataTable
                  columns={proposalColumns}
                  data={proposals}
                  loading={false}
                  searchable={false}
                  defaultSort={{ key: 'created_at', direction: 'desc' }}
                  pageSize={10}
                  emptyMessage="No proposals."
                  actions={(row) => (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {row.status === 'draft' && (
                        <button className="btn btn-ghost" style={{ fontSize: '0.6875rem', padding: '2px 6px' }} onClick={() => handleStatusChange(row.id, 'live')}>
                          Go Live
                        </button>
                      )}
                      {row.status === 'live' && (
                        <button className="btn btn-ghost" style={{ fontSize: '0.6875rem', padding: '2px 6px' }} onClick={() => handleStatusChange(row.id, 'accepted')}>
                          Accept
                        </button>
                      )}
                      {(row.status === 'draft' || row.status === 'live') && (
                        <button className="btn btn-ghost" style={{ fontSize: '0.6875rem', padding: '2px 6px', color: 'var(--text-light)' }} onClick={() => handleStatusChange(row.id, 'archived')}>
                          Archive
                        </button>
                      )}
                    </div>
                  )}
                  renderSubRow={(row) => (
                    <div className="pricing-proposal-detail">
                      <div className="pricing-proposal-detail-grid">
                        <div><span className="form-label">Baseline</span><br />{fmt(row.baseline_used)} ({row.baseline_mode})</div>
                        <div><span className="form-label">Season</span><br />{row.season_tag || 'None'} ({row.season_multiplier}x)</div>
                        <div><span className="form-label">Method</span><br />{row.calc_method} @ {row.commission_pct}%</div>
                        <div><span className="form-label">Owner Net</span><br />{fmt(row.owner_net)}</div>
                        <div><span className="form-label">Company Take</span><br />{fmt(row.company_take)}</div>
                        <div><span className="form-label">Client (excl)</span><br />{fmt(row.client_price_excl_vat)}</div>
                        {row.vat_enabled && <div><span className="form-label">VAT</span><br />{fmt(row.vat_amount)}</div>}
                        <div><span className="form-label">Client (incl)</span><br /><strong>{fmt(row.client_price_incl_vat)}</strong></div>
                      </div>
                      {row.notes && <div style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.notes}</div>}
                    </div>
                  )}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
