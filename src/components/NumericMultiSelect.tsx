/**
 * NumericMultiSelect — collapsed-by-default multi-select dropdown
 * for a numeric range. Trigger button uses the platform's
 * .form-input shape; clicking opens a checkbox panel. Same look
 * and feel as the other dropdowns on the form.
 *
 * Used by: EnquiryForm (Bedrooms, Total guests) and the Deal
 * modal's edit form on PipelinePage so the New / Edit surfaces
 * stay consistent.
 */
import { useEffect, useRef, useState } from 'react';

export interface NumericMultiSelectProps {
  max: number;
  min?: number;
  value: number[];
  onChange: (next: number[]) => void;
  /** Empty-state label inside the trigger. */
  placeholder?: string;
  /** Word for one selected item (e.g. "bedroom") — shown in the
   *  trigger summary. Plural variant defaults to singular + 's'. */
  singular?: string;
  plural?: string;
  disabled?: boolean;
}

export default function NumericMultiSelect({
  max, min = 1, value, onChange, placeholder = 'Pick one or more…', singular, plural, disabled,
}: NumericMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function toggle(n: number) {
    const set = new Set(value);
    if (set.has(n)) set.delete(n); else set.add(n);
    onChange([...set].sort((a, b) => a - b));
  }

  const options = Array.from({ length: max - min + 1 }, (_, i) => i + min);
  const summary = value.length === 0
    ? placeholder
    : `${value.join(', ')}${singular ? ` ${value.length === 1 ? singular : (plural || singular + 's')}` : ''}`;

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="form-input"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        style={{
          width: '100%',
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          background: 'var(--surface)',
        }}
        aria-expanded={open}
      >
        <span style={{
          flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: value.length === 0 ? 'var(--text-light)' : 'var(--text)',
        }}>
          {summary}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          zIndex: 20,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: 'var(--shadow-md, 0 4px 16px rgba(0,0,0,0.1))',
          padding: 8,
          maxHeight: 280,
          overflowY: 'auto',
        }}>
          {options.map(n => {
            const selected = value.includes(n);
            return (
              <label
                key={n}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 8px',
                  cursor: 'pointer',
                  background: selected ? 'var(--bg)' : 'transparent',
                  borderRadius: 4,
                }}
              >
                <input type="checkbox" checked={selected} onChange={() => toggle(n)} />
                <span style={{ fontSize: '0.875rem' }}>{n}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
