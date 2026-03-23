import { useState, useEffect, useRef } from 'react';

interface DateInputProps {
  value: string; // ISO date string (yyyy-mm-dd) or empty
  onChange: (isoDate: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04',
  june: '06', july: '07', august: '08', september: '09',
  october: '10', november: '11', december: '12',
};

function parseFlexibleDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // Already ISO: 2026-03-27
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

  // dd/mm/yy or dd-mm-yy
  const dmy2 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
  if (dmy2) {
    const yr = parseInt(dmy2[3], 10);
    const fullYear = yr >= 50 ? 1900 + yr : 2000 + yr;
    return `${fullYear}-${dmy2[2].padStart(2, '0')}-${dmy2[1].padStart(2, '0')}`;
  }

  // dd Mon yyyy or dd Mon yy — e.g. "27 Mar 2026", "27 March 2026", "27 Mar 26"
  const textMonth = s.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{2,4})$/);
  if (textMonth) {
    const mon = MONTH_MAP[textMonth[2].toLowerCase()];
    if (mon) {
      let yr = textMonth[3];
      if (yr.length === 2) {
        const n = parseInt(yr, 10);
        yr = String(n >= 50 ? 1900 + n : 2000 + n);
      }
      return `${yr}-${mon}-${textMonth[1].padStart(2, '0')}`;
    }
  }

  // dd Mon (no year — assume current or next year)
  const textMonthNoYear = s.match(/^(\d{1,2})\s+([a-zA-Z]+)$/);
  if (textMonthNoYear) {
    const mon = MONTH_MAP[textMonthNoYear[2].toLowerCase()];
    if (mon) {
      const now = new Date();
      let yr = now.getFullYear();
      const candidate = new Date(yr, parseInt(mon, 10) - 1, parseInt(textMonthNoYear[1], 10));
      if (candidate < now) yr++;
      return `${yr}-${mon}-${textMonthNoYear[1].padStart(2, '0')}`;
    }
  }

  return null;
}

function formatDisplay(isoDate: string): string {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DateInput({ value, onChange, placeholder = 'e.g. 27 Mar 2026', className, style }: DateInputProps) {
  const [text, setText] = useState(() => formatDisplay(value));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync when external value changes
  useEffect(() => {
    if (!focused) {
      setText(formatDisplay(value));
      setError(false);
    }
  }, [value, focused]);

  function handleFocus() {
    setFocused(true);
    // Show ISO date for easier editing, or keep display format
  }

  function handleBlur() {
    setFocused(false);
    if (!text.trim()) {
      onChange('');
      setError(false);
      return;
    }
    const parsed = parseFlexibleDate(text);
    if (parsed) {
      onChange(parsed);
      setText(formatDisplay(parsed));
      setError(false);
    } else {
      setError(true);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      className={className}
      style={{
        ...style,
        borderColor: error ? 'var(--error)' : undefined,
        background: error ? '#FEF2F2' : undefined,
      }}
      value={text}
      onChange={(e) => { setText(e.target.value); setError(false); }}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      autoComplete="off"
    />
  );
}
