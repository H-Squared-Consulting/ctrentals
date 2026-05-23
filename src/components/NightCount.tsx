/**
 * NightCount — inline "(N nights)" label rendered next to any date pair.
 *
 * Drop in next to a check_in / check_out display so Hayley never has to
 * mentally count nights again. Renders nothing when either date is
 * missing or the range is invalid — never noisy.
 */

import { nightsBetween } from '../lib/nights';

interface Props {
  checkIn: string | null | undefined;
  checkOut: string | null | undefined;
  /** Optional inline style overrides, mostly for spacing tweaks. */
  style?: React.CSSProperties;
}

export default function NightCount({ checkIn, checkOut, style }: Props) {
  const n = nightsBetween(checkIn, checkOut);
  if (n == null) return null;
  return (
    <span
      style={{
        fontSize: '0.75rem',
        color: 'var(--text-secondary)',
        marginLeft: '6px',
        ...style,
      }}
    >
      ({n} night{n === 1 ? '' : 's'})
    </span>
  );
}
