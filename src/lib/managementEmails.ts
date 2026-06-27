/**
 * managementEmails — the pure "management phase" engine.
 *
 * A confirmed booking has a fixed sequence of emails / WhatsApps the team
 * sends to the owner, the guest, or (for agent deals) the agent. The wording,
 * the timing ("6 weeks prior to check-in", "day after check-out") and which
 * variant applies (platform vs direct vs agent) used to live in Nicki and
 * Hayley's heads. This module encodes that as data + pure functions so the
 * UI, the per-booking checklist and the global "Actions due" dashboard all
 * derive the same sequence the same way.
 *
 * Everything here is PURE: no React, no Supabase, no Date.now(). Callers pass
 * `todayISO` in, resolvers in `bookingParticipants.ts` do the IO. That keeps
 * this file trivially unit-testable.
 *
 * Date model: all due-date math runs on `YYYY-MM-DD` strings interpreted as
 * SAST calendar dates (UTC+2, no DST). We never compare raw timestamps, so a
 * machine in another timezone can't shift a due date by a day.
 */

import { nightsBetween } from './nights';
import { fmtRand } from './pricingEngine';
import { PLATFORM_OPTIONS } from '../pages/constants';

// ─── Brand ──────────────────────────────────────────────────────────────
// The public domain templates link to. Defaults to Southern Escapes but is
// overridable per-deploy so the same engine can serve a sibling brand.
const BRAND_DOMAIN = (import.meta as any).env?.VITE_BRAND_DOMAIN || 'southernescapes.co.za';
const BRAND_NAME = (import.meta as any).env?.VITE_BRAND_NAME || 'Southern Escapes';

// ─── Shared types ───────────────────────────────────────────────────────

/** Who an action is addressed to. Drives recipient resolution + which
 *  variables the template editor offers as insert chips. */
export type Audience = 'owner' | 'guest' | 'agent';

/** How a booking reached us. Determines which subset of the 12 actions
 *  applies and the wording of the owner payment paragraph. */
export type BookingChannel = 'direct' | 'platform' | 'agent';

/** State of a single action for a single booking. `pending` is implicit
 *  (no row in `management_actions`); `sent`/`skipped` mean a staffer acted. */
export type MarkStatus = 'pending' | 'sent' | 'skipped';

/** Urgency bucket used for pills and dashboard grouping. */
export type Urgency = 'done' | 'overdue' | 'today' | 'this_week' | 'upcoming';

/** The static config for one step in the sequence. There are exactly 12. */
export interface ActionSpec {
  /** Stable key; 1:1 with a row in `management_actions` and `email_templates`. */
  key: string;
  /** Which `email_templates.key` to render for this step (here, same as key). */
  templateKey: string;
  audience: Audience;
  /** Short human label for the checklist row. */
  label: string;
  /** Channels this step applies to. owner_* apply to all three. */
  channels: BookingChannel[];
  /** Whether the composer opens an email draft or a WhatsApp message. */
  recipientChannel: 'email' | 'whatsapp';
  /** When it's due, relative to an anchor date. `confirm` = on confirmation,
   *  which uses the booking's `confirmed_at` (set only for in-app confirms;
   *  imported bookings have none, so confirm-anchored steps are skipped). */
  due: { anchor: 'check_in' | 'check_out' | 'confirm'; offsetDays: number };
}

/** A persisted "mark" row, keyed by `action_key` in the maps callers pass in. */
export interface MarkRow {
  action_key: string;
  status: MarkStatus;
  due_date: string | null;
  sent_at: string | null;
  sent_by: string | null;
}

/** One resolved checklist row: the spec + its computed due date + live state. */
export interface BookingActionRow {
  spec: ActionSpec;
  dueDate: string | null;
  status: MarkStatus;
  urgency: Urgency;
  sentAt: string | null;
  sentBy: string | null;
}

/** The signed-in staffer's personal sign-off + bank blocks the templates inject. */
export interface StaffSettings {
  initials: string;
  display_name: string;
  reply_email?: string | null;
  reply_phone?: string | null;
  signature?: string | null;
  bank_sa?: string | null;
  bank_uk?: string | null;
}

/** Everything `buildBookingVars` needs to render a template with live data. */
export interface BuildVarsArgs {
  booking: any;
  property: { property_name?: string | null } | null;
  owner: { name?: string | null; email?: string | null; phone?: string | null; payment_notes?: string | null } | null;
  guest?: any;
  agent: { name?: string | null; email?: string | null } | null;
  guidebook: { slug: string; is_published?: boolean } | null;
  staff: StaffSettings;
  channel: BookingChannel;
}

/** A variable the template editor can offer as an insert chip. */
export interface VariableInfo {
  key: string;
  label: string;
  audiences: Audience[];
}

// ─── The 12 specs (plan 1.2) ────────────────────────────────────────────
// Order matches the seeded `email_templates.sort_order` (10…120) so the
// editor's flat list and this array line up. owner_* go to all three
// channels; guest_* split direct vs platform; agent_* only on agent deals.

export const MANAGEMENT_ACTIONS: ActionSpec[] = [
  {
    key: 'owner_confirmation',
    templateKey: 'owner_confirmation',
    audience: 'owner',
    label: 'Owner confirmation',
    channels: ['direct', 'platform', 'agent'],
    recipientChannel: 'email',
    due: { anchor: 'confirm', offsetDays: 0 },
  },
  {
    key: 'owner_balance_reminder',
    templateKey: 'owner_balance_reminder',
    audience: 'owner',
    label: 'Owner balance reminder',
    channels: ['direct', 'platform', 'agent'],
    recipientChannel: 'email',
    due: { anchor: 'check_in', offsetDays: -42 },
  },
  {
    key: 'owner_post_stay',
    templateKey: 'owner_post_stay',
    audience: 'owner',
    label: 'Owner post-stay',
    channels: ['direct', 'platform', 'agent'],
    recipientChannel: 'email',
    due: { anchor: 'check_out', offsetDays: 1 },
  },
  {
    key: 'guest_welcome',
    templateKey: 'guest_welcome',
    audience: 'guest',
    label: 'Guest welcome',
    channels: ['direct', 'platform'],
    recipientChannel: 'email',
    due: { anchor: 'confirm', offsetDays: 0 },
  },
  {
    key: 'guest_prearrival_direct',
    templateKey: 'guest_prearrival_direct',
    audience: 'guest',
    label: 'Guest pre-arrival (direct)',
    channels: ['direct'],
    recipientChannel: 'email',
    due: { anchor: 'check_in', offsetDays: -49 },
  },
  {
    key: 'guest_prearrival_platform',
    templateKey: 'guest_prearrival_platform',
    audience: 'guest',
    label: 'Guest pre-arrival (platform)',
    channels: ['platform'],
    recipientChannel: 'email',
    due: { anchor: 'check_in', offsetDays: -21 },
  },
  {
    key: 'guest_deposit_direct',
    templateKey: 'guest_deposit_direct',
    audience: 'guest',
    label: 'Guest deposit reminder',
    channels: ['direct'],
    recipientChannel: 'email',
    due: { anchor: 'check_in', offsetDays: -7 },
  },
  {
    key: 'guest_feedback_direct',
    templateKey: 'guest_feedback_direct',
    audience: 'guest',
    label: 'Guest feedback request',
    channels: ['direct'],
    recipientChannel: 'email',
    due: { anchor: 'check_out', offsetDays: 7 },
  },
  {
    key: 'guest_whatsapp_24h',
    templateKey: 'guest_whatsapp_24h',
    audience: 'guest',
    label: 'Guest WhatsApp (24h before)',
    channels: ['direct', 'platform'],
    recipientChannel: 'whatsapp',
    due: { anchor: 'check_in', offsetDays: -1 },
  },
  {
    key: 'agent_details_request',
    templateKey: 'agent_details_request',
    audience: 'agent',
    label: 'Agent details request',
    channels: ['agent'],
    recipientChannel: 'email',
    due: { anchor: 'confirm', offsetDays: 0 },
  },
  {
    key: 'agent_prearrival',
    templateKey: 'agent_prearrival',
    audience: 'agent',
    label: 'Agent pre-arrival',
    channels: ['agent'],
    recipientChannel: 'email',
    due: { anchor: 'check_in', offsetDays: -49 },
  },
  {
    key: 'agent_feedback',
    templateKey: 'agent_feedback',
    audience: 'agent',
    label: 'Agent feedback request',
    channels: ['agent'],
    recipientChannel: 'email',
    due: { anchor: 'check_out', offsetDays: 7 },
  },
];

// Platform values that count as "platform" channel (mirrors PLATFORM_OPTIONS
// minus the direct/repeat values, which resolve to `direct`).
const PLATFORM_CHANNEL_VALUES = new Set(['airbnb', 'booking_com', 'vrbo', 'lekkeslaap', 'other']);

// ─── Small pure helpers ─────────────────────────────────────────────────

/** Local title-case (no shared export). Lowercases then capitalises the
 *  first letter of each word, including after hyphens/apostrophes. Matches
 *  the helper SendProposalDialog defines. */
function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

function firstNameOf(full: string | null | undefined): string {
  const t = titleCase(full).trim().split(/\s+/)[0];
  return t || '';
}

function lc(s: string | null | undefined): string {
  return (s ?? '').toString().trim().toLowerCase();
}

function toNumber(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Human label for a stored platform value, via the shared options list. */
function platformLabel(value: string | null | undefined): string {
  if (!value) return '';
  const found = PLATFORM_OPTIONS.find(o => o.value === value);
  return found ? found.label : titleCase(value);
}

// ─── Date math (SAST, string-based) ─────────────────────────────────────

const SAST_OFFSET_MINUTES = 120; // UTC+2, no daylight saving in South Africa.

/** Normalise any date-ish input to a `YYYY-MM-DD` SAST calendar date.
 *  - A bare date string ('2026-08-12') is trusted as-is (it's already a
 *    calendar date, not an instant).
 *  - A full timestamp ('2026-08-12T23:30:00Z') is shifted into SAST before
 *    its date part is read, so late-evening UTC instants land on the right
 *    local day. */
function toSastDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    return m ? m[1] : null;
  }
  const shifted = new Date(t + SAST_OFFSET_MINUTES * 60_000);
  const y = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Add a (possibly negative) number of days to a `YYYY-MM-DD` string and
 *  return another `YYYY-MM-DD`. Uses Date.UTC so the result is independent
 *  of the runtime's local timezone. */
function addDaysISO(ymd: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86_400_000;
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Friendly long date for email bodies, e.g. "Wednesday, 12 August 2026".
 *  Built from the SAST calendar date at local midnight so the displayed day
 *  never drifts. */
function formatLongDate(input: string | null | undefined): string {
  const iso = toSastDate(input);
  if (!iso) return '';
  const dt = new Date(`${iso}T00:00:00`);
  if (!Number.isFinite(dt.getTime())) return '';
  return dt.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── Channel + sequence resolution ──────────────────────────────────────

/** Decide the booking channel: an agent enquiry wins; otherwise a platform
 *  value classifies as `platform`; everything else (direct/repeat/null) is
 *  `direct`. */
export function resolveBookingChannel(
  booking: { platform: string | null },
  enquiry: { agent_id: string | null } | null,
): BookingChannel {
  if (enquiry?.agent_id) return 'agent';
  const p = lc(booking?.platform);
  if (PLATFORM_CHANNEL_VALUES.has(p)) return 'platform';
  return 'direct';
}

/** The specs that apply to a given channel. */
export function getApplicableActions(channel: BookingChannel): ActionSpec[] {
  return MANAGEMENT_ACTIONS.filter(a => a.channels.includes(channel));
}

/** Compute a spec's due date for a booking, as `YYYY-MM-DD`. The `confirm`
 *  anchor uses `confirmed_at` — when the booking was genuinely confirmed
 *  in-app. Imported bookings have no `confirmed_at`, so confirm-anchored steps
 *  return null here (and are dropped by buildBookingActions), which stops every
 *  import from showing an "overdue" confirmation on its import date. */
export function computeDueDate(
  spec: ActionSpec,
  booking: { check_in: string | null; check_out: string | null; confirmed_at?: string | null },
): string | null {
  const anchorValue =
    spec.due.anchor === 'check_in' ? booking?.check_in
    : spec.due.anchor === 'check_out' ? booking?.check_out
    : booking?.confirmed_at ?? null;
  const base = toSastDate(anchorValue);
  if (!base) return null;
  return addDaysISO(base, spec.due.offsetDays);
}

/** Bucket a due date into an urgency. Marked rows (sent/skipped) are `done`.
 *  Comparisons are plain string compares on `YYYY-MM-DD`, which is
 *  chronological. */
export function urgencyFor(dueDate: string | null, status: MarkStatus, todayISO: string): Urgency {
  if (status === 'sent' || status === 'skipped') return 'done';
  const today = toSastDate(todayISO);
  if (!dueDate || !today) return 'upcoming';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  const weekEnd = addDaysISO(today, 7);
  if (weekEnd && dueDate <= weekEnd) return 'this_week';
  return 'upcoming';
}

/** Build the full checklist for a booking: applicable specs × their due
 *  dates × any persisted marks, sorted by due date (undated rows last). */
export function buildBookingActions(
  booking: any,
  enquiry: { agent_id: string | null } | null,
  marks: Record<string, MarkRow>,
  todayISO: string,
): BookingActionRow[] {
  const channel = resolveBookingChannel(booking ?? { platform: null }, enquiry);
  // Confirm-anchored steps (confirmation / welcome / agent details) are dated
  // from confirmed_at (set only on a genuine in-app confirm). Imported bookings
  // have none, so computeDueDate returns null → these render as "Upcoming · no
  // fixed date": still draftable from the comms tab, but never overdue and never
  // surfaced on the dashboard (which only shows dated, actually-due items). This
  // is why an imported upcoming booking can still send a welcome without the
  // whole import batch flooding the queue.
  const rows: BookingActionRow[] = getApplicableActions(channel)
    .map(spec => {
    const dueDate = computeDueDate(spec, booking ?? { check_in: null, check_out: null });
    const mark = marks?.[spec.key];
    const status: MarkStatus = mark?.status ?? 'pending';
    return {
      spec,
      dueDate,
      status,
      urgency: urgencyFor(dueDate, status, todayISO),
      sentAt: mark?.sent_at ?? null,
      sentBy: mark?.sent_by ?? null,
    };
  });

  rows.sort((a, b) => {
    if (a.dueDate === b.dueDate) return 0;
    if (a.dueDate == null) return 1;
    if (b.dueDate == null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  });
  return rows;
}

/**
 * Reduce a booking's full checklist to just the CURRENT STEP — the email
 * (or same-day set) that actually needs sending right now.
 *
 * A booking's emails are a time sequence. If several are overdue (e.g. a stay
 * that has already happened) we deliberately do NOT surface the whole backlog
 * — nobody sends a "welcome" or "pre-arrival" to a guest who has already been
 * and gone. Earlier missed steps fall away; the full sequence is still
 * reachable via the Communications "All" view.
 *
 * Rule:
 *   1. Only pending rows count (sent/skipped are done).
 *   2. "Arrived" = pending rows whose date has come (overdue or today). If any
 *      exist, return those sharing the LATEST due date — the most-advanced
 *      step — and drop the earlier overdue ones. Same-day ties (e.g.
 *      owner_confirmation + guest_welcome, both on confirm) stay together.
 *   3. Otherwise, if any pending rows are due this week, return those sharing
 *      the EARLIEST such due date — the soonest upcoming step.
 *   4. Otherwise nothing is due now (the next step is further out): return [].
 */
export function currentStepActions(rows: BookingActionRow[]): BookingActionRow[] {
  const pending = (rows || []).filter(r => r.status === 'pending');
  if (pending.length === 0) return [];

  const arrived = pending.filter(r => r.urgency === 'overdue' || r.urgency === 'today');
  if (arrived.length > 0) {
    const latest = arrived.reduce<string | null>((max, r) => {
      if (r.dueDate == null) return max;
      if (max == null) return r.dueDate;
      return r.dueDate > max ? r.dueDate : max;
    }, null);
    return arrived.filter(r => r.dueDate === latest);
  }

  const thisWeek = pending.filter(r => r.urgency === 'this_week');
  if (thisWeek.length > 0) {
    const earliest = thisWeek.reduce<string | null>((min, r) => {
      if (r.dueDate == null) return min;
      if (min == null) return r.dueDate;
      return r.dueDate < min ? r.dueDate : min;
    }, null);
    return thisWeek.filter(r => r.dueDate === earliest);
  }

  return [];
}

// ─── Variable catalog ───────────────────────────────────────────────────

/** Pull a free-text value off `booking.extras` if it's stored there, else
 *  blank. These vars (housekeeper_days, deposit_amount, …) have no
 *  structured source in Stage 1; Stage 2 forms begin populating some. */
function extrasText(booking: any, key: string): string {
  const ex = booking?.extras;
  if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
    const v = (ex as any)[key];
    if (v !== null && v !== undefined && v !== '') return String(v);
  }
  return '';
}

/**
 * Build the `{{variable}}` → value map for a booking. Every catalog key is
 * always present (blank when there's no data) so `renderTemplate` treats
 * them as KNOWN and blanks them, while genuine editor typos stay literal.
 */
export function buildBookingVars(args: BuildVarsArgs): Record<string, string> {
  const { booking, property, owner, agent, guidebook, staff, channel } = args;

  // Guest identity: prefer the booking's stored name, fall back to a richer
  // guest record if one was passed.
  const guestFullRaw =
    booking?.guest_name ||
    args.guest?.name ||
    [args.guest?.first_name, args.guest?.last_name].filter(Boolean).join(' ') ||
    '';
  const guestFull = titleCase(guestFullRaw);

  // Stay figures.
  const nights = nightsBetween(booking?.check_in, booking?.check_out);
  // total_amount stores the PER-NIGHT rate (not a full total) — both the accept
  // flow (client_price_excl_vat) and the legacy imports hold per-night. The
  // real total is rate × nights.
  const perNight = toNumber(booking?.total_amount);
  const balance = toNumber(booking?.balance_due);
  const nightlyRate = perNight != null ? fmtRand(perNight) : '';
  const totalPrice = perNight != null && nights && nights > 0 ? fmtRand(perNight * nights) : '';

  // Guest counts.
  const adults = toNumber(booking?.guests_adults);
  const children = toNumber(booking?.guests_children);
  const totalGuests =
    toNumber(booking?.guests_total) ??
    (adults != null || children != null ? (adults ?? 0) + (children ?? 0) : null);

  // Guidebook link only when a published guidebook row exists.
  const guidebookUrl =
    guidebook && guidebook.slug && guidebook.is_published !== false
      ? `https://${BRAND_DOMAIN}/g/${guidebook.slug}`
      : '';

  // Check-in contact is always the booking's Manager field (booking.manager),
  // not the property's house_contact and not the drafting staffer.
  const checkInContact = (booking?.manager && String(booking.manager).trim()) || '';

  // Owner payment paragraph varies by channel. Platform money clears after
  // check-in; direct/agent follow the 50%-now / balance-6-weeks-prior cadence.
  const pLabel = platformLabel(booking?.platform) || 'platform';
  const ownerPaymentParagraph =
    channel === 'platform'
      ? `As it is a ${pLabel} booking it will clear after check-in and I will then pay across.`
      : 'I will pay across the 50% as soon as it clears and the balance is due 6 weeks prior to check-in.';

  // Sign-off is derived per logged-in user, not stored or edited: it always
  // reads "Warm regards, <their name>". Hayley's drafts sign off as Hayley,
  // Nicki's as Nicki — driven purely by who's logged in (no settings page).
  const staffName = staff?.display_name ?? '';
  const staffSignature = staffName ? `Warm regards,\n${staffName}` : 'Warm regards,';

  const vars: Record<string, string> = {
    // Guest
    guest_name: guestFull,
    guest_first_name: firstNameOf(guestFullRaw),
    guest_email: lc(booking?.guest_email),
    guest_phone: booking?.guest_phone ?? '',
    // Templates use {{adults}}/{{children}}; keep guests_* as aliases.
    adults: adults != null ? String(adults) : '',
    children: children != null ? String(children) : '',
    guests_adults: adults != null ? String(adults) : '',
    guests_children: children != null ? String(children) : '',
    guests_total: totalGuests != null ? String(totalGuests) : '',

    // Stay
    check_in: formatLongDate(booking?.check_in),
    check_out: formatLongDate(booking?.check_out),
    nights: nights != null ? String(nights) : '',
    nightly_rate: nightlyRate,
    total_amount: totalPrice,
    balance_due: balance != null ? fmtRand(balance) : '',

    // Property
    property_name: titleCase(property?.property_name),
    guidebook_url: guidebookUrl,
    check_in_contact: checkInContact,

    // Owner
    owner_name: titleCase(owner?.name),
    owner_first_name: firstNameOf(owner?.name),
    owner_email: lc(owner?.email),
    owner_phone: owner?.phone ?? '',
    payment_notes: owner?.payment_notes ?? '',
    owner_payment_paragraph: ownerPaymentParagraph,
    payment_paragraph: ownerPaymentParagraph, // alias for the plan's bare name

    // Agent
    agent_name: titleCase(agent?.name),
    agent_first_name: firstNameOf(agent?.name),
    agent_email: lc(agent?.email),

    // Staff sign-off
    staff_name: staff?.display_name ?? '',
    staff_initials: staff?.initials ?? '',
    signature: staffSignature,
    staff_signature: staffSignature, // alias
    bank_sa: staff?.bank_sa ?? '',
    bank_uk: staff?.bank_uk ?? '',
    reply_email: lc(staff?.reply_email),
    reply_phone: staff?.reply_phone ?? '',

    // Brand
    brand: BRAND_NAME,
    brand_domain: BRAND_DOMAIN,
    platform: platformLabel(booking?.platform),

    // Free-text (blank until structured; readable from extras if present)
    special_requests: (booking?.special_requests ?? '').toString().trim(),
    housekeeper_days: extrasText(booking, 'housekeeper_days'),
    deposit_amount: extrasText(booking, 'deposit_amount'),
    payment_terms: extrasText(booking, 'payment_terms'),
    weekend_housekeeping_rate: extrasText(booking, 'weekend_housekeeping_rate'),

    // Stage 2 self-serve links (resolved later; blank for now)
    guest_form_link: '',
    agent_form_link: '',
  };

  return vars;
}

/** The variables the template editor surfaces as insert chips, grouped by
 *  which audience(s) usually need them. */
export const VARIABLE_CATALOG: VariableInfo[] = [
  // Guest
  { key: 'guest_name', label: 'Guest name', audiences: ['guest', 'owner', 'agent'] },
  { key: 'guest_first_name', label: 'Guest first name', audiences: ['guest'] },
  { key: 'adults', label: 'Adults', audiences: ['guest', 'owner', 'agent'] },
  { key: 'children', label: 'Children', audiences: ['guest', 'owner', 'agent'] },
  { key: 'guests_total', label: 'Total guests', audiences: ['guest', 'owner', 'agent'] },

  // Stay
  { key: 'check_in', label: 'Check-in date', audiences: ['guest', 'owner', 'agent'] },
  { key: 'check_out', label: 'Check-out date', audiences: ['guest', 'owner', 'agent'] },
  { key: 'nights', label: 'Nights', audiences: ['guest', 'owner', 'agent'] },
  { key: 'nightly_rate', label: 'Rate per night', audiences: ['guest', 'owner', 'agent'] },
  { key: 'total_amount', label: 'Total (rate × nights)', audiences: ['guest', 'owner', 'agent'] },
  { key: 'balance_due', label: 'Balance due', audiences: ['guest', 'owner', 'agent'] },

  // Property
  { key: 'property_name', label: 'Property name', audiences: ['guest', 'owner', 'agent'] },
  { key: 'guidebook_url', label: 'Guidebook link', audiences: ['guest', 'agent'] },
  { key: 'check_in_contact', label: 'Check-in contact', audiences: ['guest', 'agent'] },

  // Owner
  { key: 'owner_name', label: 'Owner name', audiences: ['owner'] },
  { key: 'owner_first_name', label: 'Owner first name', audiences: ['owner'] },
  { key: 'owner_email', label: 'Owner email', audiences: ['owner'] },
  { key: 'owner_phone', label: 'Owner phone', audiences: ['owner'] },
  { key: 'payment_notes', label: 'Owner payment notes', audiences: ['owner'] },
  { key: 'owner_payment_paragraph', label: 'Owner payment paragraph', audiences: ['owner'] },

  // Agent
  { key: 'agent_name', label: 'Agent name', audiences: ['agent'] },
  { key: 'agent_first_name', label: 'Agent first name', audiences: ['agent'] },
  { key: 'agent_email', label: 'Agent email', audiences: ['agent'] },

  // Free-text
  { key: 'special_requests', label: 'Special requests', audiences: ['guest', 'owner', 'agent'] },
  { key: 'housekeeper_days', label: 'Housekeeper days', audiences: ['guest', 'owner', 'agent'] },
  { key: 'deposit_amount', label: 'Deposit amount', audiences: ['guest', 'agent'] },
  { key: 'payment_terms', label: 'Payment terms', audiences: ['guest', 'agent'] },
  { key: 'weekend_housekeeping_rate', label: 'Weekend housekeeping rate', audiences: ['guest'] },

  // Staff sign-off
  { key: 'staff_name', label: 'Your name', audiences: ['guest', 'owner', 'agent'] },
  { key: 'signature', label: 'Your signature', audiences: ['guest', 'owner', 'agent'] },
  { key: 'reply_email', label: 'Your reply email', audiences: ['guest', 'owner', 'agent'] },
  { key: 'reply_phone', label: 'Your reply phone', audiences: ['guest', 'owner', 'agent'] },
  // Bank details now live inline in the deposit template (SA only) — no {{bank_*}} chips.

  // Brand + links
  { key: 'brand', label: 'Brand name', audiences: ['guest', 'owner', 'agent'] },
  { key: 'brand_domain', label: 'Brand domain', audiences: ['guest', 'owner', 'agent'] },
  { key: 'guest_form_link', label: 'Guest details form link', audiences: ['guest'] },
  { key: 'agent_form_link', label: 'Agent details form link', audiences: ['agent'] },
];

// ─── Rendering ──────────────────────────────────────────────────────────

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Substitute `{{key}}` tokens. Known keys (present in `vars`) are replaced —
 * with blank when their value is empty — so missing data doesn't leave raw
 * tokens in an email. Unknown keys are left literal so an editor typo like
 * `{{guset_name}}` stays visible. Finally, runs of blank lines (left behind
 * by blanked vars) collapse to a single blank line so emails don't gap.
 */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  if (!tpl) return '';
  const replaced = tpl.replace(TOKEN_RE, (match, rawKey) => {
    const key = String(rawKey).trim();
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key] ?? '';
    }
    return match;
  });
  // A line that was "Label: {{var}}" and is now just "Label:" (its var blanked)
  // is dropped entirely — an empty Special requests / Housekeeper days line
  // shouldn't print a bare label. Lines with any real value survive.
  const deLabelled = replaced
    .split('\n')
    .filter((line) => !/^[ \t]*[^:\n]{1,40}:[ \t]*$/.test(line))
    .join('\n');
  return deLabelled
    .replace(/[ \t]+\n/g, '\n') // drop trailing spaces left when a var blanked
    .replace(/\n{3,}/g, '\n\n'); // collapse 3+ newlines to one blank line
}

/** Render a `{subject, body}` template pair. The subject is flattened to a
 *  single line (no stray newlines from a wrapped variable) and trimmed. */
export function renderEmail(
  t: { subject: string; body: string },
  vars: Record<string, string>,
): { subject: string; body: string } {
  return {
    subject: renderTemplate(t?.subject ?? '', vars).replace(/\s*\n\s*/g, ' ').trim(),
    body: renderTemplate(t?.body ?? '', vars),
  };
}
