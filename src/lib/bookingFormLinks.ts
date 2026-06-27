/**
 * bookingFormLinks -- admin-side helpers for the self-serve booking forms.
 *
 * Called from inside the authenticated admin app (booking modal share button,
 * and the management-email composer when it needs to embed {{guest_form_link}}
 * / {{agent_form_link}}). Mirrors lib/agentPortalAdmin.ts: one active,
 * revocable token row per (booking, form_type) in booking_form_tokens.
 *
 * The public form page (/f/:token) does NOT use this module — it talks to the
 * booking-form-read / booking-form-submit edge functions via lib/bookingForm.ts
 * so the public surface has no direct DB access.
 */

import type { BookingFormType } from './bookingForm';

/** Loosely-typed Supabase client — matches how the codebase passes it around. */
type Client = any;

/** Generate a 128-bit (32 hex char) random token. Same as enablePortal(). */
export function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build the public form URL for a token. The GUEST link uses the brand
 *  domain; the AGENT link uses the neutral ctvilla.co.za (same brand-leak
 *  reasoning as the agent portal — Nicki pastes it to an agent). Dev falls
 *  back to window.location.origin so localhost works. */
export function getBookingFormUrl(token: string, formType: BookingFormType): string {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
  if (isLocal) return `${window.location.origin}/f/${token}`;
  const env = (import.meta as any).env || {};
  const domain = formType === 'agent'
    ? (env.VITE_AGENT_DOMAIN || 'ctvilla.co.za')
    : (env.VITE_BRAND_DOMAIN || 'southernescapes.co.za');
  return `https://${domain}/f/${token}`;
}

/** Idempotent get-or-mint of the active token for (booking, form_type). THIS
 *  is the seam the management-email composer calls to embed a working link.
 *  Returns an active token string. Re-running returns the SAME token (so
 *  re-composing or re-sending an email reuses the link, no orphans). */
export async function ensureBookingFormToken(
  supabase: Client,
  bookingId: string,
  formType: BookingFormType,
): Promise<string> {
  // Existing active row?
  const { data: existing } = await supabase
    .from('booking_form_tokens')
    .select('token, revoked_at')
    .eq('booking_id', bookingId)
    .eq('form_type', formType)
    .maybeSingle();
  if (existing?.token && !existing.revoked_at) return existing.token;

  // Mint + upsert (one row per booking,form_type — overwrite on rotate).
  const token = generateToken();
  const { error } = await supabase
    .from('booking_form_tokens')
    .upsert(
      {
        booking_id: bookingId,
        form_type: formType,
        token,
        issued_at: new Date().toISOString(),
        revoked_at: null,
        submitted_at: null,
      },
      { onConflict: 'booking_id,form_type' },
    );
  if (error) throw error;
  return token;
}

/** Rotate the token — old links stop working, a fresh one is issued. */
export async function regenerateBookingFormToken(
  supabase: Client,
  bookingId: string,
  formType: BookingFormType,
): Promise<string> {
  const token = generateToken();
  const { error } = await supabase
    .from('booking_form_tokens')
    .upsert(
      {
        booking_id: bookingId,
        form_type: formType,
        token,
        issued_at: new Date().toISOString(),
        revoked_at: null,
        submitted_at: null,
      },
      { onConflict: 'booking_id,form_type' },
    );
  if (error) throw error;
  return token;
}

/** Revoke access — token nulled, any live link stops working. */
export async function revokeBookingFormToken(
  supabase: Client,
  bookingId: string,
  formType: BookingFormType,
): Promise<void> {
  const { error } = await supabase
    .from('booking_form_tokens')
    .update({ token: null, revoked_at: new Date().toISOString() })
    .eq('booking_id', bookingId)
    .eq('form_type', formType);
  if (error) throw error;
}

/** The Stage-1 seam: resolve a ready-to-paste public form URL for a booking +
 *  form type (mints the token if needed). Used to fill {{guest_form_link}} /
 *  {{agent_form_link}} at compose time. */
export async function resolveBookingFormLink(
  supabase: Client,
  bookingId: string,
  formType: BookingFormType,
): Promise<string> {
  const token = await ensureBookingFormToken(supabase, bookingId, formType);
  return getBookingFormUrl(token, formType);
}
