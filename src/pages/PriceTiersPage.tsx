/**
 * PriceTiersPage — /settings/price-tiers
 *
 * Source of truth for the 5-tier price-bucket filter used by the
 * global search, the deal modal, and the enquiry form. Per channel
 * (Direct / Agent / Platform), the admin sets the four upper-bound
 * thresholds that separate Very low / Low / Medium / High / Very high.
 *
 * First-load defaults are computed as quintile boundaries of the
 * current inventory's peak-season guest-pays distribution per
 * channel — they show up pre-filled but aren't persisted until the
 * admin saves. After that, the saved numbers win until the admin
 * recalculates or edits.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ToastProvider';
import { fmtRand } from '../lib/pricingEngine';
import {
  fetchPriceTiers,
  savePriceTiers,
  computeDefaultTiers,
  invalidatePriceTiersCache,
  TIER_LABELS,
  type TierThresholds,
} from '../lib/priceTiers';

type Channel = 'direct' | 'agent' | 'platform';

interface ChannelMeta {
  key: Channel;
  label: string;
  icon: string;
  description: string;
}

const CHANNEL_META: ChannelMeta[] = [
  { key: 'direct',   label: 'Direct',   icon: '👤', description: 'Guest enquiries — what the guest pays direct, including the CTR margin at peak season.' },
  { key: 'agent',    label: 'Agent',    icon: '🤝', description: 'Agent enquiries — what the guest pays through a partner agent, including CTR + agent split at peak.' },
  { key: 'platform', label: 'Platform', icon: '🌐', description: 'Platform bookings (Airbnb, Booking.com, etc.) — what the guest pays after platform fees + CTR at peak season.' },
];

interface RowState {
  /** Currently-displayed values in the inputs. */
  draft: TierThresholds;
  /** Last-saved values (or computed defaults when nothing's been
   *  saved). Used to detect "dirty" state. */
  pristine: TierThresholds;
  /** True when no row exists in the database yet — Save will
   *  INSERT rather than UPDATE. UI gets a subtle "(defaults)" hint. */
  isDefaults: boolean;
  /** Mid-save flag so the button can disable + spinner. */
  saving: boolean;
}

export default function PriceTiersPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { supabase } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Record<Channel, RowState | null>>({
    direct: null, agent: null, platform: null,
  });
  // Editing is locked by default — same pattern as the main
  // Pricing page. Reduces the risk of an accidental edit when the
  // admin opens the page to look something up.
  const [unlocked, setUnlocked] = useState(false);

  // Load saved tiers + default-fill any channel that doesn't have
  // a row yet so the user sees concrete numbers on first render.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      try {
        const saved = await fetchPriceTiers(supabase);
        const next: Record<Channel, RowState | null> = { direct: null, agent: null, platform: null };
        for (const c of ['direct', 'agent', 'platform'] as Channel[]) {
          const stored = saved.get(c);
          if (stored) {
            next[c] = { draft: { ...stored }, pristine: { ...stored }, isDefaults: false, saving: false };
          } else {
            const def = await computeDefaultTiers(supabase, c);
            next[c] = { draft: { ...def }, pristine: { ...def }, isDefaults: true, saving: false };
          }
        }
        if (!cancelled) setRows(next);
      } catch (err: any) {
        console.error('Load price tiers failed:', err);
        toast.error('Couldn\'t load price tiers: ' + (err?.message || String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  function updateThreshold(channel: Channel, key: keyof TierThresholds, value: number) {
    setRows(prev => {
      const cur = prev[channel];
      if (!cur) return prev;
      return {
        ...prev,
        [channel]: { ...cur, draft: { ...cur.draft, [key]: value } },
      };
    });
  }

  function isDirty(channel: Channel): boolean {
    const r = rows[channel];
    if (!r) return false;
    return r.isDefaults
      || r.draft.t1 !== r.pristine.t1
      || r.draft.t2 !== r.pristine.t2
      || r.draft.t3 !== r.pristine.t3
      || r.draft.t4 !== r.pristine.t4;
  }

  function anyDirty(): boolean {
    return (['direct', 'agent', 'platform'] as Channel[]).some(c => isDirty(c));
  }

  function toggleLock() {
    if (unlocked && anyDirty()) {
      if (!confirm('You have unsaved changes. Discard them and lock the page?')) return;
      // Reset each row's draft back to its pristine value. The
      // "isDefaults" flag on never-saved rows stays true so the
      // page still presents the computed numbers correctly; only
      // the in-progress edits are thrown away.
      setRows(prev => {
        const next = { ...prev };
        for (const c of ['direct', 'agent', 'platform'] as Channel[]) {
          const cur = next[c];
          if (cur) next[c] = { ...cur, draft: { ...cur.pristine } };
        }
        return next;
      });
    }
    setUnlocked(v => !v);
  }

  function hasOrderError(channel: Channel): boolean {
    const d = rows[channel]?.draft;
    if (!d) return false;
    return !(d.t1 < d.t2 && d.t2 < d.t3 && d.t3 < d.t4);
  }

  async function saveChannel(channel: Channel) {
    const r = rows[channel];
    if (!r) return;
    if (hasOrderError(channel)) {
      toast.warning('Thresholds must read low → high (Very low ceiling under Low under Medium…).');
      return;
    }
    setRows(prev => ({ ...prev, [channel]: prev[channel] ? { ...prev[channel]!, saving: true } : null }));
    try {
      await savePriceTiers(supabase, channel, r.draft);
      setRows(prev => ({
        ...prev,
        [channel]: {
          draft:    { ...r.draft },
          pristine: { ...r.draft },
          isDefaults: false,
          saving: false,
        },
      }));
      toast.success(`${CHANNEL_META.find(m => m.key === channel)!.label} tiers saved.`);
    } catch (err: any) {
      console.error('Save price tiers failed:', err);
      toast.error('Save failed: ' + (err?.message || String(err)));
      setRows(prev => ({ ...prev, [channel]: prev[channel] ? { ...prev[channel]!, saving: false } : null }));
    }
  }

  async function recalcChannel(channel: Channel) {
    if (!supabase) return;
    try {
      // "Recalculate" is an explicit user action — bypass the
      // cached defaults so we actually re-read the live inventory.
      invalidatePriceTiersCache();
      const def = await computeDefaultTiers(supabase, channel);
      setRows(prev => ({
        ...prev,
        [channel]: prev[channel]
          ? { ...prev[channel]!, draft: { ...def } }
          : null,
      }));
      toast.info('Defaults recomputed from current inventory. Review and save.');
    } catch (err: any) {
      console.error('Recompute defaults failed:', err);
      toast.error('Couldn\'t recompute: ' + (err?.message || String(err)));
    }
  }

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Price tiers</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {unlocked && anyDirty() && (
              <span className="ops-status-pill ops-status-pill--ready">
                <span className="ops-status-pill-dot" />
                unsaved
              </span>
            )}
            <button
              type="button"
              className={`btn ${unlocked ? 'btn-outline-success' : 'btn-ghost'}`}
              onClick={toggleLock}
              title={unlocked ? 'Lock the page (view-only)' : 'Unlock to edit tier thresholds'}
            >
              {unlocked ? '🔓 Unlocked' : '🔒 Locked'}
            </button>
          </div>
        </div>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5 }}>
          Five buckets — Very low, Low, Medium, High, Very high — drive the price
          filter in the global search, deal modal, and enquiry form. Picking a
          tier means "guests can afford up to here" against the most expensive
          (peak-season) guest-pays rate for the chosen channel. Set the four
          threshold boundaries below per channel. Recalculate from inventory
          quintiles any time the property mix changes.
        </p>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading tiers…</div>
      ) : CHANNEL_META.map(meta => {
        const r = rows[meta.key];
        if (!r) return null;
        const dirty = isDirty(meta.key);
        const orderErr = hasOrderError(meta.key);
        return (
          <div key={meta.key} className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4, gap: 12 }}>
              <h3 style={{ margin: 0 }}>{meta.icon} {meta.label}</h3>
              {r.isDefaults && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontStyle: 'italic' }}>
                  defaults from inventory — not saved yet
                </span>
              )}
            </div>
            <p style={{ marginTop: 0, marginBottom: 16, color: 'var(--text-secondary)', fontSize: '0.8125rem', lineHeight: 1.45 }}>
              {meta.description}
            </p>

            <fieldset disabled={!unlocked} style={{ border: 0, padding: 0, margin: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <ThresholdInput
                  label={`${TIER_LABELS.very_low} →`}
                  value={r.draft.t1}
                  onChange={v => updateThreshold(meta.key, 't1', v)}
                />
                <ThresholdInput
                  label={`${TIER_LABELS.low} →`}
                  value={r.draft.t2}
                  onChange={v => updateThreshold(meta.key, 't2', v)}
                />
                <ThresholdInput
                  label={`${TIER_LABELS.medium} →`}
                  value={r.draft.t3}
                  onChange={v => updateThreshold(meta.key, 't3', v)}
                />
                <ThresholdInput
                  label={`${TIER_LABELS.high} →`}
                  value={r.draft.t4}
                  onChange={v => updateThreshold(meta.key, 't4', v)}
                />
              </div>
            </fieldset>

            {/* Visual recap: the five tiers + their R-ranges, so
                the admin SEES the result of their numbers before
                hitting Save. */}
            <TierRangePreview thresholds={r.draft} />

            {orderErr && (
              <div style={{ color: 'var(--danger)', fontSize: '0.8125rem', marginTop: 8 }}>
                ⚠ Thresholds must read low → high. Each value needs to be smaller than the next.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: '0.8125rem' }}
                onClick={() => recalcChannel(meta.key)}
                disabled={!unlocked || r.saving}
                title={unlocked
                  ? 'Recompute the four thresholds as quintiles of the current property inventory.'
                  : 'Unlock the page to recalculate.'}
              >
                ↻ Recalculate from inventory
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => saveChannel(meta.key)}
                disabled={!unlocked || !dirty || orderErr || r.saving}
                title={!unlocked ? 'Unlock the page to save.' : undefined}
              >
                {r.saving ? 'Saving…' : (r.isDefaults ? 'Save initial tiers' : (dirty ? 'Save changes' : 'Saved'))}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  return embedded ? content : <div style={{ maxWidth: 880, margin: '0 auto', padding: 16 }}>{content}</div>;
}

function ThresholdInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="form-group" style={{ margin: 0 }}>
      <label className="form-label" style={{ fontSize: '0.75rem' }}>{label}</label>
      <input
        type="number"
        className="form-input"
        min={0}
        step={100}
        value={value}
        onChange={e => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </div>
  );
}

function TierRangePreview({ thresholds }: { thresholds: TierThresholds }) {
  const ranges = useMemo(() => ([
    { label: TIER_LABELS.very_low,  range: `up to ${fmtRand(thresholds.t1)}` },
    { label: TIER_LABELS.low,       range: `${fmtRand(thresholds.t1)} – ${fmtRand(thresholds.t2)}` },
    { label: TIER_LABELS.medium,    range: `${fmtRand(thresholds.t2)} – ${fmtRand(thresholds.t3)}` },
    { label: TIER_LABELS.high,      range: `${fmtRand(thresholds.t3)} – ${fmtRand(thresholds.t4)}` },
    { label: TIER_LABELS.very_high, range: `above ${fmtRand(thresholds.t4)}` },
  ]), [thresholds]);
  return (
    <div style={{
      marginTop: 12,
      padding: 12,
      background: 'var(--surface-alt, #F8FAFC)',
      borderRadius: 8,
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      gap: 8,
      fontSize: '0.75rem',
    }}>
      {ranges.map(r => (
        <div key={r.label} style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{r.label}</span>
          <span style={{ color: 'var(--text-light)' }}>{r.range}</span>
        </div>
      ))}
    </div>
  );
}
