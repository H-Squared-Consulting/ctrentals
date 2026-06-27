/**
 * BookingManagementSection -- the per-booking "management phase" checklist.
 *
 * Once a booking is confirmed, staff run a sequence of owner / guest / agent
 * emails (confirmation, balance reminder, pre-arrival, post-stay, etc.). This
 * component computes that sequence on the fly from the booking dates + the
 * resolved channel (direct / platform / agent) and the pure engine in
 * ../lib/managementEmails, then renders it as a checklist with a due-date hint
 * and a sent/pending pill per step.
 *
 * It owns its own data loading (kept out of the @ts-nocheck BookingModal) and
 * the composer wiring: clicking Draft looks up the DB template for the step,
 * renders it against live booking variables, and opens <EmailComposerModal>,
 * which hands off to the user's mail client via mailto:. "Mark as Sent" writes
 * a sparse row into management_actions; pending = absence of a row, so Undo is
 * just a delete.
 *
 * Renders the inner content only -- BookingModal wraps it in a
 * <DetailModalSection heading="Management">.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import { initialsForEmail, INITIALS_TO_NAME } from '../lib/userInitials';
import {
  resolveBookingChannel,
  buildBookingActions,
  currentStepActions,
  buildBookingVars,
  renderEmail,
  type Audience,
  type BookingActionRow,
  type BookingChannel,
  type MarkRow,
  type StaffSettings,
  type Urgency,
} from '../lib/managementEmails';
import {
  resolveOwnerForProperty,
  resolveAgentForEnquiry,
  resolveGuidebookForProperty,
  loadStaffSettings,
  loadMarks,
} from '../lib/bookingParticipants';
import EmailComposerModal from './EmailComposerModal';
import { useToast } from './ToastProvider';

/** Local title-case (no shared export). Matches the helper used across the
 *  booking/proposal modals so names render consistently. */
function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

/** Force emails lower-case per the design system, or null when empty. */
function lc(email: string | null | undefined): string | null {
  return email ? email.toLowerCase() : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format a YYYY-MM-DD due date as e.g. "1 Jul 2026" without timezone drift
 *  (parsing the string directly, not via new Date()). */
function fmtDueDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Format a sent_at timestamp as a short SAST date, e.g. "1 Jul". */
function fmtSentAt(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '';
  }
}

/** Today as a YYYY-MM-DD string in SAST (en-CA gives ISO date order), so the
 *  engine compares like-for-like date strings rather than timestamps. */
function todaySAST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

/** Map who-sent-it (an email) to a friendly name via the team initials. */
function shortWho(email: string | null): string {
  if (!email) return '';
  const ini = initialsForEmail(email);
  return ini ? INITIALS_TO_NAME[ini] : email.toLowerCase();
}

/** Pill variant + label per the locked urgency mapping. The pill word is the
 *  status only; the readable step label sits in dark text alongside it. */
const URGENCY_PILL: Record<Urgency, { variant: string; label: string }> = {
  done:      { variant: 'won',      label: 'Sent' },
  overdue:   { variant: 'lost',     label: 'Overdue' },
  today:     { variant: 'ready',    label: 'Today' },
  this_week: { variant: 'ready',    label: 'This week' },
  upcoming:  { variant: 'drafting', label: 'Upcoming' },
};

function channelLabel(channel: BookingChannel, platform: string | null | undefined): string {
  if (channel === 'agent') return 'Agent booking';
  if (channel === 'platform') return `Platform booking${platform ? ` · ${titleCase(platform)}` : ''}`;
  return 'Direct booking';
}

interface EmailTemplateRow {
  key: string;
  subject: string | null;
  body: string | null;
  label?: string | null;
  audience?: string | null;
  channel_variant?: string | null;
  is_active?: boolean;
}

/** What we hand the composer once a Draft is opened. Subject/body are captured
 *  at draft time so later template edits don't mutate an open draft. */
interface ComposerState {
  row: BookingActionRow;
  subject: string;
  body: string;
  recipient: { name: string; email?: string | null; phone?: string | null };
  whatsapp: boolean;
}

export default function BookingManagementSection({
  booking,
  property,
  supabase,
  user,
  initialFilter = 'due',
}: {
  booking: any;
  property: any;
  supabase: any;
  user: any;
  /** Which subset to show first. 'due' (default) = only the emails that need
   *  sending now (pending + overdue/today/this-week); 'all' = the full
   *  sequence. The dashboard and the accept-confirmation flow rely on 'due'
   *  so staff aren't faced with all 8 templates at once. */
  initialFilter?: 'due' | 'all';
}) {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [enquiry, setEnquiry] = useState<{ agent_id: string | null } | null>(null);
  const [owner, setOwner] = useState<any>(null);
  const [agent, setAgent] = useState<any>(null);
  const [guidebook, setGuidebook] = useState<any>(null);
  const [staff, setStaff] = useState<StaffSettings | null>(null);
  const [marks, setMarks] = useState<Record<string, MarkRow>>({});
  const [templatesByKey, setTemplatesByKey] = useState<Record<string, EmailTemplateRow>>({});
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<'due' | 'all'>(initialFilter === 'all' ? 'all' : 'due');
  // Per-row "mark as already sent" confirmation — holds the spec.key of the row
  // awaiting a yes/no, so the inline Confirm/Cancel shows only on that row. Lets
  // staff clear emails they sent outside the system (e.g. before this launched).
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  // Today is fixed for the lifetime of the modal — recomputing per render
  // would churn the memoised action rows for no reason.
  const todayISO = useMemo(() => todaySAST(), []);

  // Reload just the marks (after a Mark-as-Sent upsert or an Undo delete).
  const reloadMarks = useCallback(async () => {
    const m = await loadMarks(supabase, booking.id);
    setMarks(m || {});
  }, [supabase, booking.id]);

  // Initial load: everything the engine needs to compute + render the steps.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Enquiry only matters for its agent_id (drives channel = agent).
        let enq: { agent_id: string | null } | null = null;
        if (booking.enquiry_id) {
          const { data } = await supabase
            .from('enquiries')
            .select('agent_id')
            .eq('id', booking.enquiry_id)
            .maybeSingle();
          enq = data ? { agent_id: data.agent_id ?? null } : null;
        }

        const initials = initialsForEmail(user?.email);
        const [ownerRes, agentRes, guidebookRes, staffRes, marksRes, templatesRes] = await Promise.all([
          booking.property_id ? resolveOwnerForProperty(supabase, booking.property_id) : Promise.resolve(null),
          resolveAgentForEnquiry(supabase, booking.enquiry_id ?? null),
          booking.property_id ? resolveGuidebookForProperty(supabase, booking.property_id) : Promise.resolve(null),
          loadStaffSettings(supabase, initials),
          loadMarks(supabase, booking.id),
          supabase
            .from('email_templates')
            .select('key, subject, body, label, audience, channel_variant, is_active')
            .eq('partner_id', CT_RENTALS_PARTNER_ID),
        ]);
        if (cancelled) return;

        setEnquiry(enq);
        setOwner(ownerRes);
        setAgent(agentRes);
        setGuidebook(guidebookRes);
        setStaff(staffRes);
        setMarks(marksRes || {});

        const map: Record<string, EmailTemplateRow> = {};
        for (const t of (templatesRes?.data || [])) map[t.key] = t;
        setTemplatesByKey(map);
      } catch (err) {
        console.error('Failed to load booking management data', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, booking.id, booking.property_id, booking.enquiry_id, user?.email]);

  const channel = useMemo(() => resolveBookingChannel(booking, enquiry), [booking, enquiry]);
  const rows = useMemo(
    () => buildBookingActions(booking, enquiry, marks, todayISO),
    [booking, enquiry, marks, todayISO],
  );
  // "Due" = the CURRENT STEP only — the one email (or same-day set) the
  // booking is at right now. If several steps are overdue (e.g. a finished
  // stay) we surface only the most-advanced one; the earlier missed steps
  // fall away and remain available under All. See currentStepActions.
  const dueRows = useMemo(() => currentStepActions(rows), [rows]);
  const visibleRows = filter === 'due' ? dueRows : rows;

  /** Recipient contact for a step, by audience. Emails lower-cased, names
 *  title-cased. Missing email/phone is fine — the composer degrades to
 *  Copy-only. */
  function recipientFor(audience: Audience): { name: string; email?: string | null; phone?: string | null } {
    if (audience === 'owner') {
      return { name: titleCase(owner?.name) || 'Owner', email: lc(owner?.email), phone: owner?.phone ?? null };
    }
    if (audience === 'agent') {
      return { name: titleCase(agent?.name) || 'Agent', email: lc(agent?.email), phone: agent?.phone ?? null };
    }
    return {
      name: titleCase(booking.guest_name) || 'Guest',
      email: lc(booking.guest_email),
      phone: booking.guest_phone ?? null,
    };
  }

  function openDraft(row: BookingActionRow) {
    if (!staff) return;
    const spec = row.spec;
    const tpl = templatesByKey[spec.templateKey];
    if (!tpl) {
      toast.error('No template found for this step. Add it in Settings → Email templates.');
      return;
    }
    const vars = buildBookingVars({
      booking,
      property: property ?? null,
      owner,
      agent,
      guidebook,
      staff,
      channel,
    });
    const { subject, body } = renderEmail({ subject: tpl.subject || '', body: tpl.body || '' }, vars);
    setComposer({
      row,
      subject,
      body,
      recipient: recipientFor(spec.audience),
      whatsapp: spec.recipientChannel === 'whatsapp',
    });
  }

  async function markSent(row: BookingActionRow, channelUsed: 'email' | 'whatsapp') {
    setBusyKey(row.spec.key);
    try {
      const { error } = await supabase
        .from('management_actions')
        .upsert(
          {
            partner_id: CT_RENTALS_PARTNER_ID,
            booking_id: booking.id,
            action_key: row.spec.key,
            status: 'sent',
            channel: channelUsed,
            due_date: row.dueDate,
            sent_at: new Date().toISOString(),
            sent_by: user?.email ?? null,
          },
          { onConflict: 'booking_id,action_key' },
        );
      if (error) throw error;
      await reloadMarks();
      toast.success(`Marked “${row.spec.label}” as sent`);
    } catch (err: any) {
      toast.error('Failed to mark as sent: ' + (err?.message || err));
    } finally {
      setBusyKey(null);
      setComposer(null);
    }
  }

  async function undo(row: BookingActionRow) {
    setBusyKey(row.spec.key);
    try {
      const { error } = await supabase
        .from('management_actions')
        .delete()
        .eq('booking_id', booking.id)
        .eq('action_key', row.spec.key);
      if (error) throw error;
      await reloadMarks();
      toast.success('Reverted to pending');
    } catch (err: any) {
      toast.error('Failed to undo: ' + (err?.message || err));
    } finally {
      setBusyKey(null);
    }
  }

  function dueHint(row: BookingActionRow): string {
    if (row.status === 'sent') {
      const when = fmtSentAt(row.sentAt);
      const who = shortWho(row.sentBy);
      return `Sent${when ? ` ${when}` : ''}${who ? ` by ${who}` : ''}`;
    }
    if (!row.dueDate) return 'No fixed due date';
    return `Due ${fmtDueDate(row.dueDate)}`;
  }

  if (loading) {
    return (
      <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', padding: '4px 0' }}>
        Loading management checklist…
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          {channelLabel(channel, booking.platform)} · {rows.length} step{rows.length === 1 ? '' : 's'}
        </div>
        <div className="view-toggle">
          <button
            type="button"
            className={`view-toggle-btn${filter === 'due' ? ' active' : ''}`}
            onClick={() => setFilter('due')}
            title="Only the emails that need sending now"
          >
            Due {dueRows.length}
          </button>
          <button
            type="button"
            className={`view-toggle-btn${filter === 'all' ? ' active' : ''}`}
            onClick={() => setFilter('all')}
            title="The full sequence, including upcoming and already-sent"
          >
            All {rows.length}
          </button>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          {filter === 'due'
            ? 'Nothing due right now. Switch to All to see the full sequence.'
            : 'No management steps apply to this booking.'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          {visibleRows.map((row, i) => {
            const pill = URGENCY_PILL[row.urgency];
            const isSent = row.status === 'sent';
            const busy = busyKey === row.spec.key;
            return (
              <div
                key={row.spec.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderTop: i === 0 ? undefined : '1px solid var(--border)',
                  background: 'var(--surface)',
                }}
              >
                <span
                  className={`ops-status-pill ops-status-pill--${pill.variant}`}
                  style={{ flexShrink: 0, minWidth: 78, justifyContent: 'center' }}
                >
                  <span className="ops-status-pill-dot" />
                  {pill.label}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>{row.spec.label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{dueHint(row)}</div>
                </div>
                {isSent ? (
                  <button
                    className="btn btn-ghost"
                    onClick={() => undo(row)}
                    disabled={busy}
                    style={{ flexShrink: 0 }}
                    title="Revert this step to pending"
                  >
                    {busy ? '…' : '↺ Undo'}
                  </button>
                ) : confirmKey === row.spec.key ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Mark as already sent?
                    </span>
                    <button
                      className="btn btn-outline-success"
                      onClick={async () => { await markSent(row, row.spec.recipientChannel); setConfirmKey(null); }}
                      disabled={busy}
                      title="Record this email as already sent — nothing is emailed"
                    >
                      {busy ? '…' : '✓ Yes'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setConfirmKey(null)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button
                      className="btn btn-outline"
                      onClick={() => openDraft(row)}
                      disabled={busy}
                      title="Compose this email"
                    >
                      ✉ Draft
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setConfirmKey(row.spec.key)}
                      disabled={busy}
                      title="Already sent this outside the system? Mark it as sent to clear it from the queue."
                    >
                      ✓ Mark sent
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {composer && (
        <EmailComposerModal
          title={composer.row.spec.label}
          subtitle={composer.recipient.name}
          recipient={composer.recipient}
          subject={composer.subject}
          body={composer.body}
          whatsapp={composer.whatsapp}
          markSentLabel={composer.row.status === 'sent' ? 'Re-mark as Sent' : 'Mark as Sent'}
          contextSummary={
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="form-label" style={{ margin: 0 }}>Property</span>
                <span style={{ fontWeight: 500, textAlign: 'right' }}>
                  {titleCase(property?.property_name) || '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="form-label" style={{ margin: 0 }}>Dates</span>
                <span style={{ fontWeight: 500, textAlign: 'right' }}>
                  {booking.check_in || '—'} → {booking.check_out || '—'}
                </span>
              </div>
            </>
          }
          onMarkSent={(ch) => markSent(composer.row, ch)}
          onClose={() => setComposer(null)}
        />
      )}
    </>
  );
}
