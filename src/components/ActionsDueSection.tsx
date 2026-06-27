/**
 * ActionsDueSection — the management-email work queue, rendered as the left
 * ("work") column of the Home command-center dashboard.
 *
 * Grouped PER BOOKING: each confirmed booking with at least one pending
 * management email shows as a single row (guest · property · dates, how many
 * emails are due, which audiences, the most-urgent due date). The actual
 * drafting lives inside the booking — clicking a row opens the BookingModal
 * straight on its Communications tab, where each individual email can be
 * drafted and marked sent. This keeps the dashboard readable at 50+ bookings
 * instead of exploding into hundreds of repeated template rows.
 *
 * The sequence + due dates are computed on the fly from booking dates + the
 * resolved channel (see lib/managementEmails); nothing is pre-populated, so a
 * "pending" item is one with no management_actions mark yet. We load a window
 * of bookings (check_out ≥ today−14d, check_in ≤ today+60d), build each
 * booking's actions, keep the pending ones, and group them by booking.
 *
 * UX: the active bucket (Overdue / Today / This week) is a tab — controlled by
 * the parent so the dashboard KPI chips can switch it; counts on the tabs and
 * in the KPI strip are NUMBERS OF BOOKINGS, matching the rows. An audience
 * dropdown narrows to bookings with a pending Owner / Guest / Agent email. The
 * list caps at CAP rows with a Show-more expander.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import {
  buildBookingActions,
  currentStepActions,
  resolveBookingChannel,
} from '../lib/managementEmails';
import type { Audience, BookingActionRow, BookingChannel } from '../lib/managementEmails';
import { loadParticipantsBulk } from '../lib/bookingParticipants';
// Lazy/code-split wrapper — the modal only mounts when a row is clicked.
import BookingModal from './LazyBookingModal';

/** The three actionable urgency buckets, in priority order. */
export type ActionsBucket = 'overdue' | 'today' | 'this_week';

/** Live counts reported up to the dashboard KPI strip — numbers of BOOKINGS. */
export interface ActionsCounts {
  overdue: number;
  today: number;
  this_week: number;
  total: number;
}

interface Property {
  id: string;
  slug: string | null;
  property_name: string;
  bedrooms?: number | null;
  suburb?: string | null;
  is_published?: boolean;
}

/** One pending action against one booking. */
interface QueueItem {
  booking: any;
  property: Property | null;
  channel: BookingChannel;
  row: BookingActionRow;
}

/** All pending actions for one booking, rolled up for a single dashboard row. */
interface BookingGroup {
  booking: any;
  property: Property | null;
  items: QueueItem[];
  counts: Record<ActionsBucket, number>;
  audiences: Set<Audience>;
  /** Earliest due date among the pending items in each bucket. */
  earliestDue: Record<ActionsBucket, string | null>;
}

interface Props {
  /** Active bucket — controlled by the parent so KPI chips can switch it. */
  tab: ActionsBucket;
  onTabChange: (t: ActionsBucket) => void;
  /** Fires whenever the bucket counts change, to feed the KPI strip. */
  onCounts?: (c: ActionsCounts) => void;
}

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

/** Short SAST date, e.g. "5 Aug". Parses YYYY-MM-DD directly (no TZ drift). */
function fmtShort(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) return '—';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${MONTHS[m - 1]}`;
}

/** Audience → status-pill variant + short label. Variants live in app.css. */
const AUDIENCE_PILL: Record<Audience, { variant: string; label: string }> = {
  owner: { variant: 'accepted', label: 'Owner' },
  guest: { variant: 'interested', label: 'Guest' },
  agent: { variant: 'sent', label: 'Agent' },
};
const AUDIENCE_ORDER: Audience[] = ['owner', 'guest', 'agent'];

const TAB_META: Array<{ key: ActionsBucket; label: string }> = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
];

const AUDIENCE_FILTERS: Array<{ key: 'all' | Audience; label: string }> = [
  { key: 'all', label: 'Everyone' },
  { key: 'owner', label: 'Owners' },
  { key: 'guest', label: 'Guests' },
  { key: 'agent', label: 'Agents' },
];

const EMPTY_COPY: Record<ActionsBucket, string> = {
  overdue: 'Nothing overdue. You’re on top of it.',
  today: 'Nothing due today.',
  this_week: 'Nothing due in the next week.',
};

/** Cap the list so the dashboard stays scannable; the rest is one click away. */
const CAP = 12;

export default function ActionsDueSection({ tab, onTabChange, onCounts }: Props) {
  const { supabase, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [audience, setAudience] = useState<'all' | Audience>('all');
  const [expanded, setExpanded] = useState(false);
  const [editingBooking, setEditingBooking] = useState<any | null>(null);

  async function loadData() {
    if (!supabase) return;
    setLoading(true);
    try {
      // SAST-comparable YYYY-MM-DD strings drive the whole engine; we never
      // compare timestamps. Window is deliberately WIDE: checking out in the
      // last month through checking in up to a year out. Far-future bookings
      // must appear too — an owner *confirmation* email is due the moment the
      // booking is made, so a stay months away can already have an overdue
      // action. The per-action urgency bucketing keeps only what's actually
      // due (overdue/today/this-week) in view, so a wide window doesn't bloat
      // the list — a booking with nothing due yet simply doesn't show.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString().slice(0, 10);
      const past = new Date(today); past.setDate(past.getDate() - 30);
      const future = new Date(today); future.setDate(future.getDate() + 365);
      const windowStartISO = past.toISOString().slice(0, 10);
      const windowEndISO = future.toISOString().slice(0, 10);

      const [bookRes, propRes] = await Promise.all([
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
      ]);

      const bookingRows = (bookRes.data || []) as any[];
      const propRows = (propRes.data || []) as Property[];

      // One batched, concurrent pass for everything the dashboard needs.
      // marksByBooking says which steps are already sent (pending = absence of
      // a mark); enquiryById gives each booking's agent_id for channel
      // resolution without a separate enquiries round-trip. The owner/agent/
      // template lookups for the actual drafting happen inside the booking's
      // Communications tab, not here.
      const bulk = await loadParticipantsBulk(supabase, bookingRows);
      const enquiryById = bulk.enquiryById;
      const propById = new Map<string, Property>(propRows.map(p => [p.id, p]));

      const items: QueueItem[] = [];
      for (const booking of bookingRows) {
        const enquiry = booking.enquiry_id ? (enquiryById.get(booking.enquiry_id) ?? null) : null;
        const channel = resolveBookingChannel(booking, enquiry);
        const marks = bulk.marksByBooking.get(booking.id) || {};
        const actions = buildBookingActions(booking, enquiry, marks, todayISO);
        // CURRENT STEP ONLY: surface just the email this booking is at right
        // now (the most-advanced arrived step, else the soonest this-week one).
        // currentStepActions returns rows that all share one due date, so a
        // booking lands in exactly one bucket and counts once there — instead
        // of dumping its whole overdue backlog onto the queue. This keeps the
        // dashboard in lockstep with the booking's Communications "Due" view.
        for (const row of currentStepActions(actions)) {
          items.push({ booking, property: propById.get(booking.property_id) ?? null, channel, row });
        }
      }

      setProperties(propRows);
      setQueue(items);
    } catch (err) {
      console.error('ActionsDueSection load failed:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (supabase) loadData(); /* eslint-disable-next-line */ }, [supabase]);

  // Roll the flat pending items up into one group per booking.
  const groups = useMemo(() => {
    const byId = new Map<string, BookingGroup>();
    for (const it of queue) {
      const id = it.booking.id;
      let g = byId.get(id);
      if (!g) {
        g = {
          booking: it.booking,
          property: it.property,
          items: [],
          counts: { overdue: 0, today: 0, this_week: 0 },
          audiences: new Set<Audience>(),
          earliestDue: { overdue: null, today: null, this_week: null },
        };
        byId.set(id, g);
      }
      g.items.push(it);
      const u = it.row.urgency as ActionsBucket;
      if (u === 'overdue' || u === 'today' || u === 'this_week') {
        g.counts[u] += 1;
        g.audiences.add(it.row.spec.audience);
        const d = it.row.dueDate;
        if (d && (!g.earliestDue[u] || d < (g.earliestDue[u] as string))) g.earliestDue[u] = d;
      }
    }
    return Array.from(byId.values());
  }, [queue]);

  const bucketCount = (b: ActionsBucket) => groups.reduce((n, g) => n + (g.counts[b] > 0 ? 1 : 0), 0);

  // Report booking-level bucket counts up to the dashboard KPI strip so the
  // chips match the rows.
  useEffect(() => {
    onCounts?.({
      overdue: bucketCount('overdue'),
      today: bucketCount('today'),
      this_week: bucketCount('this_week'),
      total: groups.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, onCounts]);

  // Collapse the show-more expander whenever the view changes.
  useEffect(() => { setExpanded(false); }, [tab, audience]);

  const filtered = useMemo(() => {
    const inBucket = groups.filter(g => g.counts[tab] > 0);
    const byAudience = audience === 'all' ? inBucket : inBucket.filter(g => g.audiences.has(audience));
    return byAudience.sort((a, b) =>
      (a.earliestDue[tab] ?? '9999-12-31').localeCompare(b.earliestDue[tab] ?? '9999-12-31'),
    );
  }, [groups, tab, audience]);

  const visible = expanded ? filtered : filtered.slice(0, CAP);
  const hiddenCount = filtered.length - visible.length;

  return (
    <>
      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Heading + booking-count badge */}
        <div className="detail-modal-section-heading" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Actions due</span>
          {!loading && groups.length > 0 && (
            <span style={{
              display: 'inline-block', padding: '2px 10px', borderRadius: 12,
              fontSize: '0.75rem', fontWeight: 700,
              background: 'var(--warning-bg)', color: 'var(--warning)',
            }}>
              {groups.length} booking{groups.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {/* Tabs (bucket) + audience filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {TAB_META.map(t => {
              const count = bucketCount(t.key);
              const active = t.key === tab;
              const isOverdue = t.key === 'overdue';
              const activeBg = isOverdue ? 'var(--error)' : 'var(--color-primary)';
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onTabChange(t.key)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '6px 12px', borderRadius: 999,
                    fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer',
                    border: active ? '1px solid transparent' : '1px solid var(--border)',
                    background: active ? activeBg : 'var(--surface)',
                    color: active ? '#fff' : 'var(--text)',
                    transition: 'var(--transition)',
                  }}
                >
                  {t.label}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                    fontSize: '0.6875rem', fontWeight: 700,
                    background: active ? 'rgba(255,255,255,0.24)' : (isOverdue && count > 0 ? 'var(--error-bg)' : 'var(--bg)'),
                    color: active ? '#fff' : (isOverdue && count > 0 ? 'var(--error)' : 'var(--text-secondary)'),
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <select
            className="list-filter-select"
            value={audience}
            onChange={(e) => setAudience(e.target.value as 'all' | Audience)}
            aria-label="Filter bookings by pending audience"
          >
            {AUDIENCE_FILTERS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>

        {/* List — one row per booking */}
        {loading && queue.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', padding: '8px 0' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', padding: '16px 0', textAlign: 'center' }}>
            {audience === 'all'
              ? EMPTY_COPY[tab]
              : `No bookings with a pending ${AUDIENCE_FILTERS.find(a => a.key === audience)?.label.toLowerCase().replace(/s$/, '')} email in this view.`}
          </div>
        ) : (
          <div>
            {visible.map((g, i) => {
              const count = g.counts[tab];
              const guestName = titleCase(g.booking.guest_name || '');
              const propName = titleCase(g.property?.property_name || '');
              const isOverdue = tab === 'overdue';
              const open = () => setEditingBooking(g.booking);
              return (
                <div
                  key={g.booking.id}
                  role="button"
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 8px',
                    margin: '0 -8px',
                    borderRadius: 'var(--radius-sm)',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {/* Count of emails due in this bucket for this booking */}
                  <span style={{
                    flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 30, height: 30, borderRadius: 999,
                    fontSize: '0.875rem', fontWeight: 700,
                    background: isOverdue ? 'var(--error-bg)' : 'var(--color-primary-bg)',
                    color: isOverdue ? 'var(--error)' : 'var(--color-primary)',
                  }} title={`${count} email${count === 1 ? '' : 's'} due`}>
                    {count}
                  </span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {guestName || '—'}
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}> · {propName || '—'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {fmtShort(g.booking.check_in)} → {fmtShort(g.booking.check_out)}
                      </span>
                      {AUDIENCE_ORDER.filter(a => g.audiences.has(a)).map(a => (
                        <span
                          key={a}
                          className={`ops-status-pill ops-status-pill--${AUDIENCE_PILL[a].variant}`}
                          style={{ fontSize: '0.625rem', padding: '1px 7px' }}
                        >
                          <span className="ops-status-pill-dot" />
                          {AUDIENCE_PILL[a].label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{
                    flexShrink: 0,
                    fontSize: '0.8125rem',
                    fontWeight: 700,
                    minWidth: 50,
                    textAlign: 'right',
                    color: isOverdue ? 'var(--error)' : 'var(--text)',
                  }}>
                    {fmtShort(g.earliestDue[tab])}
                  </div>
                  <span style={{ flexShrink: 0, color: 'var(--text-light)', fontSize: '1.125rem', lineHeight: 1 }}>›</span>
                </div>
              );
            })}

            {hiddenCount > 0 && (
              <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8, marginTop: 4 }}>
                <button className="btn btn-ghost" style={{ fontSize: '0.8125rem' }} onClick={() => setExpanded(true)}>
                  Show {hiddenCount} more
                </button>
              </div>
            )}
            {expanded && filtered.length > CAP && (
              <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8, marginTop: 4 }}>
                <button className="btn btn-ghost" style={{ fontSize: '0.8125rem' }} onClick={() => setExpanded(false)}>
                  Show less
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {editingBooking && (
        <BookingModal
          booking={editingBooking}
          properties={properties}
          defaultView="comms"
          onClose={async () => { setEditingBooking(null); await loadData(); }}
          onSave={async () => { setEditingBooking(null); await loadData(); }}
          supabase={supabase}
          user={user}
          partnerId={CT_RENTALS_PARTNER_ID}
        />
      )}
    </>
  );
}
