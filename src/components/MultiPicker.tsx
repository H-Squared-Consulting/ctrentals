/* eslint-disable */
// @ts-nocheck
/**
 * MultiPicker — compact dropdown that lets the user check off multiple
 * values. Designed for the Properties toolbar's bed / bath / sleeps
 * filters where "3 OR 4 bedrooms" is a real use case (a "3+" threshold
 * wrongly pulls in 12-bed estates).
 *
 * Button shows: label + selected values (comma list, or "any" when none).
 * Click toggles a popover with one checkbox per option. Click outside
 * or press Escape to close. Selected = none → no filter applied
 * upstream.
 */
import { useEffect, useRef, useState } from 'react';

export default function MultiPicker({
  label,
  options,
  selected,
  onChange,
  format,
}: {
  label: string;
  options: (number | string)[];
  selected: (number | string)[];
  onChange: (next: (number | string)[]) => void;
  format?: (v: number | string) => string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle(v: number | string) {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v].sort((a, b) => Number(a) - Number(b)));
  }

  const fmt = format || ((v) => String(v));
  const summary = selected.length === 0
    ? 'any'
    : selected.length <= 3
      ? selected.map(fmt).join(', ')
      : `${selected.length} selected`;

  return (
    <div className="multi-picker" ref={rootRef}>
      <button
        type="button"
        className={`list-filter-select multi-picker-btn ${selected.length ? 'is-active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={`${label}: ${summary}`}
      >
        {label}: {summary}
      </button>
      {open && (
        <div className="multi-picker-menu">
          {options.map(v => {
            const on = selected.includes(v);
            return (
              <label key={String(v)} className={`multi-picker-item ${on ? 'is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(v)} />
                <span>{fmt(v)}</span>
              </label>
            );
          })}
          {selected.length > 0 && (
            <button type="button" className="multi-picker-clear" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
