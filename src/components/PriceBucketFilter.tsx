/**
 * PriceBucketFilter — multi-select price tier chip row, used
 * everywhere the team wants to narrow by "what the guest can
 * afford" (global search, enquiry form, deal modal).
 *
 * Five chips: Very low / Low / Medium / High / Very high. The user
 * can tap any combination; the filter collapses the picks into a
 * single range running from the floor of the lowest selected tier
 * to the ceiling of the highest. Picking Very low + High silently
 * includes Low + Medium too — same range as picking all four.
 *
 * Thresholds are pulled from /settings/price-tiers per channel.
 * While they load, the chips render in a muted state and the
 * R-range hints read "loading…".
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fmtRand } from '../lib/pricingEngine';
import {
  fetchPriceTiers,
  computeDefaultTiers,
  selectedTierRange,
  TIER_ORDER,
  TIER_LABELS,
  type TierKey,
  type TierThresholds,
} from '../lib/priceTiers';
import type { SearchChannel } from './GlobalSearchModal';

interface Props {
  /** Which channel's thresholds to load. The bucket's R-amount
   *  changes per channel (different commission math). */
  channel: SearchChannel;
  /** Currently selected tier(s). Empty = no filter. */
  value: TierKey[];
  onChange: (next: TierKey[]) => void;
}

function rangeLabel(tier: TierKey, t: TierThresholds): string {
  switch (tier) {
    case 'very_low':  return `up to ${fmtRand(t.t1)}`;
    case 'low':       return `${fmtRand(t.t1)} – ${fmtRand(t.t2)}`;
    case 'medium':    return `${fmtRand(t.t2)} – ${fmtRand(t.t3)}`;
    case 'high':      return `${fmtRand(t.t3)} – ${fmtRand(t.t4)}`;
    case 'very_high': return `above ${fmtRand(t.t4)}`;
  }
}

export default function PriceBucketFilter({ channel, value, onChange }: Props) {
  const { supabase } = useAuth();
  const [thresholds, setThresholds] = useState<TierThresholds | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const saved = await fetchPriceTiers(supabase);
        let t = saved.get(channel);
        if (!t) t = await computeDefaultTiers(supabase, channel);
        if (!cancelled) setThresholds(t);
      } catch (err) {
        console.error('PriceBucketFilter load failed:', err);
        if (!cancelled) setThresholds(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, channel]);

  // Selected set for O(1) chip lookup. Auto-fill: when picks span
  // a gap (e.g. Very low + High), highlight EVERY chip in the
  // range so the user sees "this is what your filter actually
  // catches". Click handlers still toggle the literal pick.
  const orderIndex = (t: TierKey) => TIER_ORDER.indexOf(t);
  const sortedSelected = [...value].sort((a, b) => orderIndex(a) - orderIndex(b));
  const loIdx = sortedSelected.length > 0 ? orderIndex(sortedSelected[0]) : -1;
  const hiIdx = sortedSelected.length > 0 ? orderIndex(sortedSelected[sortedSelected.length - 1]) : -1;
  const inAutoRange = (t: TierKey) => {
    const i = orderIndex(t);
    return loIdx >= 0 && i >= loIdx && i <= hiIdx;
  };

  function toggle(tier: TierKey) {
    if (value.includes(tier)) {
      onChange(value.filter(t => t !== tier));
    } else {
      onChange([...value, tier]);
    }
  }

  const range = useMemo(
    () => (thresholds ? selectedTierRange(value, thresholds) : null),
    [value, thresholds],
  );
  const rangeText = useMemo(() => {
    if (!range || !thresholds) return null;
    const lo = range.floor   == null ? 'R0'           : fmtRand(range.floor);
    const hi = range.ceiling == null ? 'no upper cap' : fmtRand(range.ceiling);
    return `${lo} – ${hi}`;
  }, [range, thresholds]);

  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 6,
      }}>
        {TIER_ORDER.map(tier => {
          const explicit = value.includes(tier);
          const auto = inAutoRange(tier);
          const highlight = explicit || auto;
          return (
            <button
              key={tier}
              type="button"
              className={`btn ${highlight ? 'btn-primary' : 'btn-outline'}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                padding: '10px 6px',
                lineHeight: 1.25,
                minHeight: 56,
                opacity: loading ? 0.6 : (highlight && !explicit ? 0.85 : 1),
              }}
              onClick={() => toggle(tier)}
              disabled={loading}
              title={loading
                ? 'Loading tier ranges…'
                : explicit
                  ? `Remove ${TIER_LABELS[tier]} from the selection`
                  : auto
                    ? `Auto-included by your range — click to lock it in explicitly`
                    : `Add ${TIER_LABELS[tier]} to the selection`}
            >
              <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{TIER_LABELS[tier]}</span>
              <span style={{
                fontSize: '0.6875rem',
                color: highlight ? 'rgba(255,255,255,0.85)' : 'var(--text-light)',
                whiteSpace: 'nowrap',
              }}>
                {loading || !thresholds ? 'loading…' : rangeLabel(tier, thresholds)}
              </span>
            </button>
          );
        })}
      </div>
      {value.length > 0 && rangeText && (
        <div style={{
          marginTop: 8,
          fontSize: '0.75rem',
          color: 'var(--text-light)',
        }}>
          {value.length === 1
            ? <>Showing only properties in the <strong>{TIER_LABELS[value[0]]}</strong> band — peak-season guest pays {rangeText}/night.</>
            : <>Showing properties whose peak-season guest pays sits between <strong>{rangeText}</strong>/night.</>}
        </div>
      )}
    </div>
  );
}
