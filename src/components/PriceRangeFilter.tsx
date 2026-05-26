/**
 * PriceRangeFilter — dual-thumb price slider with a Per night /
 * Total stay toggle. Single source of truth for "what budget is
 * this enquiry / search after" across the platform:
 *
 *   - GlobalSearchModal       (filter pane)
 *   - EnquiryForm             (budget min / max)
 *   - PipelinePage deal modal (budget min / max in edit mode)
 *
 * Storage is ALWAYS per-night (the canonical baseline). The toggle
 * only changes the display axis + labels — flipping it never
 * shifts the underlying value, so a value typed in "stay" mode
 * round-trips cleanly through "night" and back.
 *
 * Bounds + step:
 *   - PRICE_PER_NIGHT_CEILING = R 100,000 / night — covers the high
 *     end of the portfolio with plenty of headroom.
 *   - PRICE_PER_NIGHT_STEP    = R 500 — fine grain for low-end
 *     properties without producing noisy slider values.
 *   In "stay" mode both scale by `nights`.
 *
 *   When the user drags the min thumb all the way left we return
 *   null for `min` (= "no minimum"); same for max thumb fully
 *   right (= "no maximum"). Both nulls = "any price".
 */
import { useMemo } from 'react';

export const PRICE_PER_NIGHT_CEILING = 100_000;
export const PRICE_PER_NIGHT_STEP    = 500;

export interface PriceRangeFilterProps {
  /** Per-night R values. `null` = "no constraint at this end". */
  min: number | null;
  max: number | null;
  /** Stay length in nights — drives the per-stay scale. 0 disables
   *  the Total stay toggle (with a tooltip pointing at the date
   *  picker). */
  nights: number;
  /** Current display basis. Caller owns the state so two adjacent
   *  PriceRangeFilters (rare but possible) can independently toggle. */
  basis: 'night' | 'stay';
  onChange: (min: number | null, max: number | null) => void;
  onBasisChange: (basis: 'night' | 'stay') => void;
  /** Optional CSS override for the outermost wrapper — used when
   *  the host wants to shrink the gap between labels and slider. */
  style?: React.CSSProperties;
}

export default function PriceRangeFilter({
  min, max, nights, basis, onChange, onBasisChange, style,
}: PriceRangeFilterProps) {
  const canSwitchToStay = nights > 0;
  const effectiveBasis: 'night' | 'stay' = canSwitchToStay ? basis : 'night';

  // Resolve current min/max into DISPLAY units (per-night vs
  // per-stay). null is treated as the "open" end (0 for min,
  // ceiling for max) so the slider has somewhere to render — the
  // sentinel only matters when we feed values back to the parent.
  const ceilingDisplay = effectiveBasis === 'stay' && nights > 0
    ? PRICE_PER_NIGHT_CEILING * nights
    : PRICE_PER_NIGHT_CEILING;
  const stepDisplay = effectiveBasis === 'stay' && nights > 0
    ? PRICE_PER_NIGHT_STEP * nights
    : PRICE_PER_NIGHT_STEP;
  const lo = min == null ? 0 : (effectiveBasis === 'stay' && nights > 0 ? min * nights : min);
  const hi = max == null ? ceilingDisplay : (effectiveBasis === 'stay' && nights > 0 ? max * nights : max);

  /** Convert a slider DISPLAY value back to the per-night figure
   *  we store. null sentinel when the user has dragged a thumb
   *  back to its open-ended end (clears the constraint). */
  function toPerNight(displayVal: number, isMax: boolean): number | null {
    if (!isMax && displayVal <= 0) return null;
    if (isMax && displayVal >= ceilingDisplay) return null;
    if (effectiveBasis === 'stay' && nights > 0) return Math.round(displayVal / nights);
    return Math.round(displayVal);
  }

  function handleMin(v: number) {
    // Don't let the min thumb cross the max — snap one step below.
    const clamped = Math.min(v, hi - stepDisplay);
    onChange(toPerNight(Math.max(0, clamped), false), max);
  }
  function handleMax(v: number) {
    const clamped = Math.max(v, lo + stepDisplay);
    onChange(min, toPerNight(Math.min(ceilingDisplay, clamped), true));
  }

  // Cached track positions so the highlighted band renders without
  // a per-event recompute storm during drag.
  const { pctLow, pctHigh } = useMemo(() => ({
    pctLow:  Math.max(0, Math.min(100, Math.round((lo / ceilingDisplay) * 100))),
    pctHigh: Math.max(0, Math.min(100, Math.round((hi / ceilingDisplay) * 100))),
  }), [lo, hi, ceilingDisplay]);

  const fmt = (n: number) => `R${n.toLocaleString('en-ZA')}`;
  const minLabel = min == null ? 'No min' : fmt(lo);
  const maxLabel = max == null ? 'No max' : (hi >= ceilingDisplay ? `${fmt(ceilingDisplay)}+` : fmt(hi));

  return (
    <div className="price-range" style={style}>
      <div className="price-range__labels">
        <span>{minLabel}</span>
        <span className="price-range__divider">–</span>
        <span>{maxLabel}</span>
        <div className="view-toggle" style={{ marginBottom: 0, marginLeft: 'auto' }}>
          <button
            type="button"
            className={`view-toggle-btn ${effectiveBasis === 'night' ? 'active' : ''}`}
            style={{ fontSize: '0.6875rem' }}
            onClick={() => onBasisChange('night')}
          >
            Per night
          </button>
          <button
            type="button"
            className={`view-toggle-btn ${effectiveBasis === 'stay' ? 'active' : ''}`}
            style={{
              fontSize: '0.6875rem',
              opacity: canSwitchToStay ? 1 : 0.4,
              cursor: canSwitchToStay ? 'pointer' : 'not-allowed',
            }}
            disabled={!canSwitchToStay}
            onClick={() => canSwitchToStay && onBasisChange('stay')}
            title={canSwitchToStay ? `Total for ${nights} night${nights === 1 ? '' : 's'}` : 'Pick check-in + check-out first'}
          >
            Total stay {nights > 0 ? `(${nights}n)` : ''}
          </button>
        </div>
      </div>
      <div className="price-range__track-wrap">
        <div className="price-range__track" />
        <div
          className="price-range__track price-range__track--active"
          style={{ left: `${pctLow}%`, right: `${100 - pctHigh}%` }}
        />
        <input
          type="range"
          className="price-range__thumb price-range__thumb--min"
          min={0}
          max={ceilingDisplay}
          step={stepDisplay}
          value={lo}
          onChange={(e) => handleMin(Number(e.target.value))}
          aria-label="Minimum price"
        />
        <input
          type="range"
          className="price-range__thumb price-range__thumb--max"
          min={0}
          max={ceilingDisplay}
          step={stepDisplay}
          value={hi}
          onChange={(e) => handleMax(Number(e.target.value))}
          aria-label="Maximum price"
        />
      </div>
    </div>
  );
}
