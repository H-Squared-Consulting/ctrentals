/**
 * ActionsDueSection — the management-email action queue, rendered as a
 * single dashboard card on the Home page (it used to be a standalone
 * Operations → Actions page; folded in here so the daily to-do list lives
 * on the landing page rather than behind another click).
 *
 * One global queue across every confirmed booking: the management-email
 * sequence (owner confirmations, guest welcome / pre-arrival / deposit /
 * feedback, agent track, the 24h WhatsApp nudge) surfaced wherever an item
 * is due now. The sequence + due dates are computed on the fly from booking
 * dates + the resolved channel (see lib/managementEmails); nothing is
 * pre-populated, so a "pending" item is simply one with no management_actions
 * mark yet. We load a window of bookings (check_out ≥ today−14d, check_in ≤
 * today+60d), build each booking's actions, keep the pending ones, and bucket
 * them by urgency into Overdue / Today / This week.
 *
 * Draft opens the shared EmailComposerModal pre-filled from the DB template
 * rendered with live booking variables; Mark as Sent writes a mark and the
 * item drops off the queue. Open hands off to the full BookingModal.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import { nightsBetween } from '../lib/nights';
import { initialsForEmail } from '../lib/userInitials';
import {
  buildBookingActions,
  resolveBookingChannel,
  buildBookingVars,
  renderEmail,
} from '../lib/managementEmails';
import type {
  Audience,
  BookingActionRow,
  BookingChannel,
  StaffSettings,
} from '../lib/managementEmails';
import { loadParticipantsBulk, loadStaffSettings } from '../lib/bookingParticipants';
import EmailComposerModal from './EmailComposerModal';
import BookingModal from '../pages/BookingModal';

interface Property {
  id: string;
  slug: string | null;
  property_name: string;
  bedrooms?: number | null;
  suburb?: string | null;
  is_published?: boolean;
}

/** One pending action against one booking — the unit of the queue. */
interface QueueItem {
  booking: any;
  property: Property | null;
  enquiry: { agent_id: string | null } | null;
  channel: BookingChannel;
  row: BookingActionRow;
}

/** What the composer is currently showing. Holds the source QueueItem so
 *  Mark as Sent knows which booking + action_key to stamp. */
interface ComposerState {
  item: QueueItem;
  title: string;
  subject: string;
  body: string;
  recipient: { name: string; email?: string | null; phone?: string | null };
  whatsapp: boolean;
}

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

/** Force emails lower-case at the source (design-system rule). */
function lc(s: string | null | undefined): string | null {
  return s ? s.toLowerCase() : null;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDue(d: string | null): string {
  if (!d) return 'No date';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

/** Audience → status-pill variant + short label, so a glance tells the
 *  user who they're about to email. Variants are all defined in app.css. */
const AUDIENCE_PILL: Record<Audience, { variant: string; label: string }> = {
  owner: { variant: 'accepted', label: 'Owner' },
  guest: { variant: 'interested', label: 'Guest' },
  agent: { variant: 'sent', label: 'Agent' },
};

const BUCKETS: Array<{ key: 'overdue' | 'today' | 'this_week'; label: string }> = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
];

export default function ActionsDueSection() {
  const { supabase, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);

  // Resolved-participant + config lookups, kept in state so Draft can build
  // variables lazily (only the item the user clicks) rather than rendering an
  // email for every queued row up front.
  const [ownerByProperty, setOwnerByProperty] = useState<Map<string, any>>(new Map());
  const [agentByEnquiry, setAgentByEnquiry] = useState<Map<string, any>>(new Map());
  const [guidebookByProperty, setGuidebookByProperty] = useState<Map<string, any>>(new Map());
  const [templatesByKey, setTemplatesByKey] = useState<Record<string, { subject: string; body: string }>>({});
  const [staff, setStaff] = useState<StaffSettings | null>(null);
  const [staffInitials, setStaffInitials] = useState<string | null>(null);

  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [editingBooking, setEditingBooking] = useState<any | null>(null);

  async function loadData() {
    if (!supabase) return;
    setLoading(true);
    try {
      // SAST-comparable YYYY-MM-DD strings drive the whole engine; we never
      // compare timestamps. Window: anything checking out in the last
      // fortnight (post-stay feedback still lands) through anything checking
      // in within ~2 months (pre-arrival lead time covered).
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString().slice(0, 10);
      const past = new Date(today); past.setDate(past.getDate() - 14);
      const future = new Date(today); future.setDate(future.getDate() + 60);
      const windowStartISO = past.toISOString().slice(0, 10);
      const windowEndISO = future.toISOString().slice(0, 10);

      const initials = initialsForEmail(user?.email);

      const [bookRes, propRes, tplRes, staffSettings] = await Promise.all([
        supabase
          .from('bookings')
          .select('*')
          .eq('partner_id', CT_RENTALS_PARTNER_ID)
          .eq('kind', 'booking')
          .not('status', 'in', '(tentative,cancelled)')
          .gte('check_out', windowStartISO)
          .lte('check_in', windowEndISO),
        supabase
          .from('partner_properties')
          .select('id, slug, property_name, bedrooms, suburb, is_published')
          .eq('partner_id', CT_RENTALS_PARTNER_ID),
        supabase
          .from('email_templates')
          .select('key, subject, body')
          .eq('partner_id', CT_RENTALS_PARTNER_ID),
        loadStaffSettings(supabase, initials),
      ]);

      const bookingRows = (bookRes.data || []) as any[];
      const propRows = (propRes.data || []) as Property[];

      const tplMap: Record<string, { subject: string; body: string }> = {};
      for (const t of (tplRes.data || []) as any[]) {
        tplMap[t.key] = { subject: t.subject || '', body: t.body || '' };
      }

      // Enquiries only needed for agent_id (drives channel resolution + the
      // agent recipient). One IN() keeps it to a single round-trip.
      const enquiryIds = Array.from(new Set(bookingRows.map(b => b.enquiry_id).filter(Boolean)));
      const enquiryById = new Map<string, { agent_id: string | null }>();
      if (enquiryIds.length) {
        const enqRes = await supabase.from('enquiries').select('id, agent_id').in('id', enquiryIds);
        for (const e of (enqRes.data || []) as any[]) {
          enquiryById.set(e.id, { agent_id: e.agent_id ?? null });
        }
      }

      const bulk = await loadParticipantsBulk(supabase, bookingRows);
      const propById = new Map<string, Property>(propRows.map(p => [p.id, p]));

      const items: QueueItem[] = [];
      for (const booking of bookingRows) {
        const enquiry = booking.enquiry_id ? (enquiryById.get(booking.enquiry_id) ?? null) : null;
        const channel = resolveBookingChannel(booking, enquiry);
        const marks = bulk.marksByBooking.get(booking.id) || {};
        const actions = buildBookingActions(booking, enquiry, marks, todayISO);
        for (const row of actions) {
          if (row.status !== 'pending') continue;
          // Upcoming items aren't actionable yet — the queue is strictly
          // overdue / today / this-week so it stays a real to-do list.
          if (row.urgency !== 'overdue' && row.urgency !== 'today' && row.urgency !== 'this_week') continue;
          items.push({ booking, property: propById.get(booking.property_id) ?? null, enquiry, channel, row });
        }
      }
      items.sort((a, b) => (a.row.dueDate ?? '9999-12-31').localeCompare(b.row.dueDate ?? '9999-12-31'));

      setOwnerByProperty(bulk.ownerByProperty);
      setAgentByEnquiry(bulk.agentByEnquiry);
      setGuidebookByProperty(bulk.guidebookByProperty);
      setTemplatesByKey(tplMap);
      setStaff(staffSettings);
      setStaffInitials(initials);
      setProperties(propRows);
      setQueue(items);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  useEffect(() => { if (supabase) loadData(); /* eslint-disable-next-line */ }, [supabase]);

  const grouped = useMemo(() => {
    const g: Record<'overdue' | 'today' | 'this_week', QueueItem[]> = { overdue: [], today: [], this_week: [] };
    for (const it of queue) {
      if (it.row.urgency === 'overdue' || it.row.urgency === 'today' || it.row.urgency === 'this_week') {
        g[it.row.urgency].push(it);
      }
    }
    return g;
  }, [queue]);

  function openDraft(item: QueueItem) {
    if (!staff) return;
    const { booking, property, channel, row } = item;
    const spec = row.spec;
    const owner = ownerByProperty.get(booking.property_id) || null;
    const agent = booking.enquiry_id ? (agentByEnquiry.get(booking.enquiry_id) || null) : null;
    const guidebook = guidebookByProperty.get(booking.property_id) || null;
    const guest = {
      name: booking.guest_name || '',
      email: booking.guest_email || null,
      phone: booking.guest_phone || null,
    };

    const vars = buildBookingVars({ booking, property, owner, guest, agent, guidebook, staff, channel });
    const tpl = templatesByKey[spec.templateKey] || { subject: '', body: '' };
    const rendered = renderEmail(tpl, vars);

    let recipient: { name: string; email?: string | null; phone?: string | null };
    if (spec.audience === 'owner') {
      recipient = { name: titleCase(owner?.name || ''), email: lc(owner?.email), phone: owner?.phone || null };
    } else if (spec.audience === 'agent') {
      recipient = { name: titleCase(agent?.name || ''), email: lc(agent?.email), phone: agent?.phone || null };
    } else {
      recipient = { name: titleCase(booking.guest_name || ''), email: lc(booking.guest_email), phone: booking.guest_phone || null };
    }

    setComposer({
      item,
      title: spec.label,
      subject: rendered.subject,
      body: rendered.body,
      recipient,
      whatsapp: spec.recipientChannel === 'whatsapp',
    });
  }

  async function handleMarkSent(channel: 'email' | 'whatsapp') {
    if (!composer) return;
    const { item } = composer;
    const spec = item.row.spec;
    // Upsert the mark (one row per booking+action). due_date is snapshotted
    // so the historical record survives later date edits. The item then drops
    // off the queue on reload because pending = absence of a mark.
    await supabase.from('management_actions').upsert({
      partner_id: CT_RENTALS_PARTNER_ID,
      booking_id: item.booking.id,
      action_key: spec.key,
      status: 'sent',
      channel,
      due_date: item.row.dueDate,
      sent_at: new Date().toISOString(),
      sent_by: staffInitials,
    }, { onConflict: 'booking_id,action_key' });
    setComposer(null);
    await loadData();
  }

  return (
    <>
      <div className="card" style={{ padding: 20 }}>
        <div
          className="detail-modal-section-heading"
          style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <span>Actions due</span>
          {!loading && queue.length > 0 && (
            <span style={{
              display: 'inline-block', padding: '2px 10px', borderRadius: 12,
              fontSize: '0.75rem', fontWeight: 700,
              background: '#FEF3C7', color: '#92400E',
            }}>
              {queue.length}
            </span>
          )}
        </div>

        {loading && queue.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Loading…</div>
        ) : queue.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            You're all caught up — no actions due this week.
          </div>
        ) : (
          BUCKETS.map(bucket => {
            const items = grouped[bucket.key];
            if (!items.length) return null;
            const isOverdue = bucket.key === 'overdue';
            return (
              <div key={bucket.key} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                  <h3 style={{
                    margin: 0,
                    fontSize: '0.6875rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 700,
                    color: isOverdue ? 'var(--error)' : 'var(--text)',
                  }}>
                    {bucket.label}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{items.length}</span>
                </div>

                {items.map((item, i) => {
                  const spec = item.row.spec;
                  const aud = AUDIENCE_PILL[spec.audience];
                  const guestName = titleCase(item.booking.guest_name || '');
                  const propName = titleCase(item.property?.property_name || '');
                  const last = i === items.length - 1;
                  return (
                    <div
                      key={`${item.booking.id}-${spec.key}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 0',
                        borderTop: i === 0 ? '1px solid var(--border-light)' : 'none',
                        borderBottom: last ? 'none' : '1px solid var(--border-light)',
                      }}
                    >
                      <span className={`ops-status-pill ops-status-pill--${aud.variant}`} style={{ flexShrink: 0 }}>
                        <span className="ops-status-pill-dot" />
                        {aud.label}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text)' }}>{spec.label}</div>
                        <div style={{
                          fontSize: '0.8125rem',
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {guestName || '—'} · {propName || '—'}
                        </div>
                      </div>
                      <div style={{
                        flexShrink: 0,
                        fontSize: '0.8125rem',
                        fontWeight: 700,
                        color: isOverdue ? 'var(--error)' : 'var(--text)',
                      }}>
                        {fmtDue(item.row.dueDate)}
                      </div>
                      <button className="btn btn-outline" style={{ flexShrink: 0 }} onClick={() => openDraft(item)}>
                        Draft
                      </button>
                      <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={() => setEditingBooking(item.booking)}>
                        Open
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {composer && (
        <EmailComposerModal
          title={composer.title}
          subtitle={<>To {composer.recipient.name || '—'}</>}
          recipient={composer.recipient}
          subject={composer.subject}
          body={composer.body}
          contextSummary={
            <>
              <strong>{titleCase(composer.item.property?.property_name || '')}</strong>
              {' · '}
              {fmtDate(composer.item.booking.check_in)} → {fmtDate(composer.item.booking.check_out)}
              {(() => {
                const n = nightsBetween(composer.item.booking.check_in, composer.item.booking.check_out);
                return n ? ` · ${n} night${n === 1 ? '' : 's'}` : '';
              })()}
            </>
          }
          whatsapp={composer.whatsapp}
          onMarkSent={handleMarkSent}
          onClose={() => setComposer(null)}
        />
      )}

      {editingBooking && (
        <BookingModal
          booking={editingBooking}
          properties={properties}
          onClose={() => setEditingBooking(null)}
          onSave={async () => { setEditingBooking(null); await loadData(); }}
          supabase={supabase}
          user={user}
          partnerId={CT_RENTALS_PARTNER_ID}
        />
      )}
    </>
  );
}
