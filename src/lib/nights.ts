/**
 * nights — single source of truth for "how many nights between these dates".
 *
 * Used to live in three different pages with slightly different return
 * shapes (number vs number | null). Consolidated here so every surface
 * displaying a date pair computes the count the same way.
 */

/** Count nights between two ISO date strings. Returns null when either
 *  date is missing or the range is invalid (checkout on/before checkin). */
export function nightsBetween(checkIn: string | null | undefined, checkOut: string | null | undefined): number | null {
  if (!checkIn || !checkOut) return null;
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 86_400_000);
}
