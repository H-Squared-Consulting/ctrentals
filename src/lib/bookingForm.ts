/**
 * bookingForm -- public-side service module for /f/:token (the self-serve
 * guest / agent detail forms).
 *
 * Every call hits one of the two Supabase edge functions:
 *   - booking-form-read   → fetch the booking context + form type + prior answers
 *   - booking-form-submit → write the recipient's answers into booking_details
 *
 * The public form never touches the database directly: RLS keeps the tables
 * auth-only, the edge functions are the single gate. The client ships only the
 * anon URL + key (authenticating the function call) plus the form token (the
 * auth for that specific booking + form type). Analogous to lib/agentPortal.ts.
 */

import { supabase } from './supabase';

const FUNCTIONS_BASE = (() => {
  const url = (supabase as any).supabaseUrl as string | undefined;
  return url ? `${url.replace(/\/$/, '')}/functions/v1` : '';
})();

const ANON_KEY = (supabase as any).supabaseKey as string;

export type BookingFormType = 'guest' | 'agent';

export interface BookingFormContext {
  guestName: string;
  propertyName: string;
  checkIn: string | null;
  checkOut: string | null;
  guestsTotal: number | null;
}

export interface BookingFormBundle {
  formType: BookingFormType;
  booking: BookingFormContext;
  /** Prior answers for THIS form type (so re-opening the link prefills). */
  submission: Record<string, unknown>;
  submittedAt: string | null;
}

/** Load the booking context + form type + any prior submission. Returns null
 *  on an unknown / revoked token (caller renders the "Link not valid" state). */
export async function getBookingForm(token: string): Promise<BookingFormBundle | null> {
  if (!token) return null;
  const url = `${FUNCTIONS_BASE}/booking-form-read?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) {
    console.error('booking-form-read failed:', res.status, await res.text().catch(() => ''));
    return null;
  }
  const body = await res.json().catch(() => null);
  if (!body?.ok) return null;
  return {
    formType: body.formType,
    booking: body.booking,
    submission: body.submission || {},
    submittedAt: body.submittedAt ?? null,
  };
}

export interface SubmitBookingFormInput {
  token: string;
  formType: BookingFormType;
  fields: Record<string, unknown>;
}

export interface SubmitBookingFormResult {
  ok: boolean;
  reason?: string;
}

export async function submitBookingForm(input: SubmitBookingFormInput): Promise<SubmitBookingFormResult> {
  const url = `${FUNCTIONS_BASE}/booking-form-submit`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    return { ok: false, reason: body?.reason || 'unknown' };
  }
  return { ok: true };
}
