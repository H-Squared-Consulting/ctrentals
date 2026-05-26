/**
 * bookingConflicts — shared overlap guard for BookingModal + BlockModal.
 *
 * Two date ranges [a_start, a_end) and [b_start, b_end) overlap iff
 * a_start < b_end AND a_end > b_start. Postgres handles the comparison
 * directly via lt/gt on the ISO date strings; we filter out cancelled
 * rows and (when editing) the row being saved.
 *
 * Returns the first conflicting row found, or null if the range is clear.
 * Callers translate that into a toast and abort the save — the DB has no
 * exclusion constraint of its own, so this is the only thing standing
 * between two ops users double-booking the same property.
 */

export interface BookingConflict {
  id: string;
  kind: 'booking' | 'block';
  check_in: string;
  check_out: string;
  guest_name: string | null;
}

export async function findBookingConflict({
  supabase,
  partnerId,
  propertyId,
  checkIn,
  checkOut,
  excludeId,
}: {
  supabase: any;
  partnerId: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  excludeId?: string;
}): Promise<BookingConflict | null> {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, kind, check_in, check_out, guest_name, status')
    .eq('partner_id', partnerId)
    .eq('property_id', propertyId)
    .neq('status', 'cancelled')
    .lt('check_in', checkOut)
    .gt('check_out', checkIn);
  if (error) throw error;
  const row = (data || []).find((r: any) => r.id !== excludeId);
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    check_in: row.check_in,
    check_out: row.check_out,
    guest_name: row.guest_name,
  };
}

/** Human-readable summary of a conflict for toast / error messages. */
export function describeConflict(c: BookingConflict): string {
  const label = c.kind === 'block'
    ? (c.guest_name || 'Block')
    : (c.guest_name || 'Existing booking');
  return `${label} (${c.check_in} → ${c.check_out})`;
}
