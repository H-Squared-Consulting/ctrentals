/**
 * guestLinks — keep enquiries.guest_id pointing at a CRM guests row.
 *
 * Called whenever an enquiry's guest_* fields land for the first time
 * (direct enquiry on creation, or agent enquiry the moment the agent
 * discloses the underlying guest). Behaviour:
 *
 *   1. Skip silently when no guest_name AND no guest_email — nothing to
 *      link, nothing to insert.
 *   2. When guest_email is set, dedupe against the existing guests row
 *      by case-insensitive email match (the guests table has an index on
 *      lower(email)). Match → link. No match → insert.
 *   3. When only guest_name is set (no email), insert unconditionally —
 *      can't dedupe without an identifier, and the alternative
 *      (insert nothing) would leave the CRM blind to the guest until a
 *      booking happens.
 *
 * Existing guests' fields are not overwritten by this helper — the CRM
 * is the source of truth for guest records once they exist. If a name
 * or phone needs updating, the user does it on the Guests page.
 */

export interface EnquiryGuestPayload {
  enquiryId: string;
  partnerId: string;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
}

export async function linkOrCreateGuestForEnquiry(
  supabase: any,
  payload: EnquiryGuestPayload,
): Promise<{ guestId: string | null; created: boolean }> {
  const name = (payload.guestName || '').trim();
  const email = (payload.guestEmail || '').trim();
  const phone = (payload.guestPhone || '').trim();

  if (!name && !email) return { guestId: null, created: false };

  // 1. Try the dedupe path when we have an email.
  if (email) {
    const { data: found } = await supabase
      .from('guests')
      .select('id')
      .ilike('email', email)
      .eq('partner_id', payload.partnerId)
      .limit(1)
      .maybeSingle();
    if (found?.id) {
      await supabase
        .from('enquiries')
        .update({ guest_id: found.id, updated_at: new Date().toISOString() })
        .eq('id', payload.enquiryId);
      return { guestId: found.id, created: false };
    }
  }

  // 2. No match — insert a new guests row and link the enquiry to it.
  const { data: inserted, error } = await supabase
    .from('guests')
    .insert({
      partner_id: payload.partnerId,
      name: name || 'Unnamed guest',
      email: email || null,
      phone: phone || null,
      source: 'enquiry',
    })
    .select('id')
    .single();
  if (error || !inserted?.id) return { guestId: null, created: false };

  await supabase
    .from('enquiries')
    .update({ guest_id: inserted.id, updated_at: new Date().toISOString() })
    .eq('id', payload.enquiryId);

  return { guestId: inserted.id, created: true };
}
