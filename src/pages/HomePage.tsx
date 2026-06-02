/**
 * HomePage — the landing page.
 *
 * Surfaces:
 *   - Quick actions for the most common things (new enquiry, booking,
 *     brochure share). Same set as the FAB so the entry point is
 *     consistent. Standalone "New proposal" is intentionally omitted —
 *     every proposal must be raised against an enquiry.
 *   - Today block: arrivals, departures, and guests currently in-house
 *     so Mom + Hayley can see the day's choreography at a glance
 *     without going to the bookings calendar.
 *
 * Uses only the shared design-system classes (.card, .btn variants,
 * .detail-modal-section-heading shape). No bespoke .home-* prefix.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { CT_RENTALS_PARTNER_ID } from './constants';
import SendBrochurePicker from '../components/SendBrochurePicker';
import BookingModal from './BookingModal';

interface TodayBookingRow {
  id: string;
  property_id: string;
  property_name: string | null;
  guest_name: string | null;
  check_in: string;
  check_out: string;
}

/** A deal sitting in the Responded column on the enquiries board
 *  that still has at least one proposal awaiting a final outcome.
 *  Rendered on the homepage so the team can see the open chase
 *  queue without leaving the dashboard. */
interface ToCloseRow {
  enquiry_id: string;
  ref_code: string | null;
  /** Direct deals: guest = recipient. Agent deals: agent name. The
   *  card label below the count uses this as the headline so the
   *  reader sees "who" at a glance — same convention as the kanban
   *  card. */
  display_name: string;
  is_agent: boolean;
  /** Agent deals optionally disclose the guest. Surface it as a
   *  sub-line so 5 enquiries from the same agent stay distinct. */
  agent_guest_name: string | null;
  /** Property name when the deal has exactly one open proposal —
   *  drops to a "{n} properties" rollup otherwise. */
  property_summary: string | null;
  to_close_count: number;
  days_since: number;
}

/** Proposal statuses that count as "closed" — the deal has a final
 *  outcome on this proposal and nothing's owed to the guest on it.
 *  Mirrors the same set used by the Responded card on the kanban
 *  (PipelinePage), so the two surfaces report the same number. */
const CLOSED_PROPOSAL_STATUSES = new Set([
  'declined', 'accepted', 'booked', 'cancelled', 'expired', 'archived',
]);

/** deal_status values that correspond to the Responded column on the
 *  enquiries board (columnForDeal in PipelinePage.tsx). */
const RESPONDED_DEAL_STATUSES = ['sent', 'stalled', 'interested'];

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

export default function HomePage() {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();
  const navigate = useNavigate();

  const [brochurePickerOpen, setBrochurePickerOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingProperties, setBookingProperties] = useState<any[]>([]);

  const [todayBookings, setTodayBookings] = useState<TodayBookingRow[]>([]);
  const [todayLoading, setTodayLoading] = useState(true);

  const [toClose, setToClose] = useState<ToCloseRow[]>([]);
  const [toCloseLoading, setToCloseLoading] = useState(true);

  const todayIso = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }, []);

  // Pull every booking touching today — arrivals (check_in === today),
  // departures (check_out === today), and in-stay (check_in < today <
  // check_out). One query covers all three with check_in <= today AND
  // check_out >= today, then we bucket client-side. Cancelled bookings
  // AND blocks (kind='block' — owner stays / maintenance / holds) are
  // filtered out; this tile shows real guest movement only.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setTodayLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, property_id, guest_name, check_in, check_out, status, partner_properties(property_name)')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .lte('check_in', todayIso)
        .gte('check_out', todayIso)
        .neq('status', 'cancelled')
        .neq('kind', 'block');
      if (cancelled) return;
      if (error) {
        console.error('HomePage today fetch failed:', error);
        setTodayBookings([]);
      } else {
        const rows = (data || []).map((b: any) => ({
          id: b.id,
          property_id: b.property_id,
          property_name: b.partner_properties?.property_name ?? null,
          guest_name: b.guest_name,
          check_in: b.check_in,
          check_out: b.check_out,
        })) as TodayBookingRow[];
        setTodayBookings(rows);
      }
      setTodayLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, todayIso]);

  // Pull every Responded-column deal + its proposals so we can
  // count how many proposals still need a final outcome. Filters
  // to deal_status in ('sent','stalled','interested') — the same
  // set columnForDeal() maps onto the Responded kanban column.
  // Archived enquiries are excluded; once nothing's "to close" on
  // a deal it drops out of this tile (still visible on the board).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setToCloseLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('enquiries')
        .select(`
          id, ref_code, client_name, guest_name, is_agent,
          deal_status, archived_at, created_at,
          proposals(id, status, partner_properties(property_name))
        `)
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .in('deal_status', RESPONDED_DEAL_STATUSES)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) {
        console.error('HomePage to-close fetch failed:', error);
        setToClose([]);
        setToCloseLoading(false);
        return;
      }
      const now = Date.now();
      const rows: ToCloseRow[] = (data || [])
        .map((e: any): ToCloseRow | null => {
          const props = (e.proposals || []) as Array<{
            id: string; status: string;
            partner_properties: { property_name: string } | null;
          }>;
          const open = props.filter(p => !CLOSED_PROPOSAL_STATUSES.has(p.status));
          if (open.length === 0) return null;
          const propertySummary = open.length === 1
            ? (open[0].partner_properties?.property_name || null)
            : `${open.length} properties`;
          const days = Math.max(0, Math.floor((now - new Date(e.created_at).getTime()) / (1000 * 60 * 60 * 24)));
          return {
            enquiry_id: e.id,
            ref_code: e.ref_code ?? null,
            display_name: e.client_name || '—',
            is_agent: !!e.is_agent,
            agent_guest_name: e.is_agent ? (e.guest_name ?? null) : null,
            property_summary: propertySummary,
            to_close_count: open.length,
            days_since: days,
          };
        })
        .filter((r): r is ToCloseRow => r !== null);
      setToClose(rows);
      setToCloseLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const { arrivals, departures, inStay } = useMemo(() => {
    const arrivals: TodayBookingRow[] = [];
    const departures: TodayBookingRow[] = [];
    const inStay: TodayBookingRow[] = [];
    for (const b of todayBookings) {
      if (b.check_in === todayIso) arrivals.push(b);
      else if (b.check_out === todayIso) departures.push(b);
      else inStay.push(b);
    }
    return { arrivals, departures, inStay };
  }, [todayBookings, todayIso]);

  // Pull a first name out of the email local-part — "hayley.harrod@x"
  // → Hayley. Falls back to "Welcome back" when there's no email.
  useEffect(() => {
    const local = (user?.email || '').split('@')[0].split('.')[0];
    const name = local ? local.charAt(0).toUpperCase() + local.slice(1) : '';
    setPageTitle(name ? `Welcome back, ${name}` : 'Welcome back');
  }, [setPageTitle, user?.email]);

  /** Lazy-load properties only when the user opens the booking flow. */
  async function openBooking() {
    const { data } = await supabase
      .from('partner_properties')
      .select('id, property_name, suburb, city, bedrooms, hero_image_url, is_published')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('property_name');
    setBookingProperties(data || []);
    setBookingOpen(true);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Quick actions — same set as the FAB so the entry point is
          consistent whether the user is on the dashboard or anywhere else. */}
      <div className="card" style={{ padding: 16 }}>
        <div className="detail-modal-section-heading" style={{ marginBottom: 12 }}>
          Quick actions
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate('/enquiry/new')}>
            💬 New enquiry
          </button>
          <button className="btn btn-outline" onClick={openBooking}>
            📅 New booking
          </button>
          <button className="btn btn-outline" onClick={() => setBrochurePickerOpen(true)}>
            📄 Send brochure
          </button>
          <button className="btn btn-outline" onClick={() => navigate('/price-list')}>
            💷 Price list
          </button>
        </div>
      </div>

      {/* Today block — three buckets driven off bookings touching
          today's date. Each tile is clickable to drill into the
          bookings list filtered to the matching window. */}
      <div className="card" style={{ padding: 20 }}>
        <div className="detail-modal-section-heading" style={{ marginBottom: 12 }}>
          Today
        </div>
        {todayLoading ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Loading…</div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}>
            <TodayTile
              icon="🛬"
              label="Arrivals"
              accent="#065F46"
              bg="#D1FAE5"
              bookings={arrivals}
              onOpen={() => navigate('/operations/bookings?view=list')}
            />
            <TodayTile
              icon="🛏"
              label="In house"
              accent="#1E40AF"
              bg="#DBEAFE"
              bookings={inStay}
              onOpen={() => navigate('/operations/bookings?view=list')}
            />
            <TodayTile
              icon="🛫"
              label="Departures"
              accent="#92400E"
              bg="#FEF3C7"
              bookings={departures}
              onOpen={() => navigate('/operations/bookings?view=list')}
            />
          </div>
        )}
      </div>

      {/* Proposals to close — open chase queue. Mirrors the Responded
          column on the enquiries board: deals with at least one
          proposal still awaiting a final outcome. Click a row to jump
          straight to the deal. */}
      <div className="card" style={{ padding: 20 }}>
        <div
          className="detail-modal-section-heading"
          style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <span>Proposals to close</span>
          {!toCloseLoading && toClose.length > 0 && (
            <span style={{
              display: 'inline-block', padding: '2px 10px', borderRadius: 12,
              fontSize: '0.75rem', fontWeight: 700,
              background: '#FEF3C7', color: '#92400E',
            }}>
              {toClose.reduce((sum, r) => sum + r.to_close_count, 0)}
            </span>
          )}
        </div>
        {toCloseLoading ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Loading…</div>
        ) : toClose.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Nothing open. Every responded proposal has a final outcome.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {toClose.slice(0, 8).map(r => (
              <li
                key={r.enquiry_id}
                onClick={() => navigate(`/operations/enquiries?deal=${encodeURIComponent(r.enquiry_id)}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/operations/enquiries?deal=${encodeURIComponent(r.enquiry_id)}`);
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  background: 'var(--surface)',
                }}
              >
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 28, height: 24, padding: '0 8px', borderRadius: 12,
                  fontSize: '0.75rem', fontWeight: 700,
                  background: '#FEF3C7', color: '#92400E',
                  flexShrink: 0,
                }} title={`${r.to_close_count} proposal${r.to_close_count === 1 ? '' : 's'} awaiting a final outcome`}>
                  {r.to_close_count}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text)', fontWeight: 500 }}>
                    {r.is_agent && '🤝 '}
                    {titleCase(r.display_name)}
                    {r.ref_code && (
                      <span style={{ color: 'var(--text-light)', fontWeight: 400, marginLeft: 6, fontSize: '0.75rem' }}>
                        · {r.ref_code}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {r.is_agent && r.agent_guest_name
                      ? <>Guest: {titleCase(r.agent_guest_name)}</>
                      : r.is_agent
                      ? <em>Guest not disclosed</em>
                      : null}
                    {r.is_agent && r.property_summary && ' · '}
                    {r.property_summary && titleCase(r.property_summary)}
                  </div>
                </div>
                <span style={{
                  fontSize: '0.75rem', color: 'var(--text-light)', flexShrink: 0,
                }}>
                  {r.days_since < 1 ? 'today' : r.days_since === 1 ? '1d' : `${r.days_since}d`}
                </span>
              </li>
            ))}
            {toClose.length > 8 && (
              <li
                style={{
                  fontSize: '0.8125rem', color: 'var(--text-secondary)',
                  fontStyle: 'italic', cursor: 'pointer', padding: '4px 10px',
                }}
                onClick={() => navigate('/operations/enquiries?stage=sent')}
              >
                + {toClose.length - 8} more in Responded →
              </li>
            )}
          </ul>
        )}
      </div>

      {brochurePickerOpen && (
        <SendBrochurePicker onClose={() => setBrochurePickerOpen(false)} />
      )}

      {bookingOpen && (
        <BookingModal
          booking={{}}
          properties={bookingProperties}
          supabase={supabase}
          user={user}
          partnerId={CT_RENTALS_PARTNER_ID}
          onClose={() => setBookingOpen(false)}
          onSave={() => setBookingOpen(false)}
        />
      )}
    </div>
  );
}

function TodayTile({
  icon, label, accent, bg, bookings, onOpen,
}: {
  icon: string;
  label: string;
  /** Pill foreground (count text + label tint). */
  accent: string;
  /** Pill background (matches the bookings-list "When" column pills
   *  so the homepage uses the same colour language). */
  bg: string;
  bookings: TodayBookingRow[];
  onOpen: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: 14,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <span style={{
          fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.04em',
          textTransform: 'uppercase', color: accent,
        }}>
          {icon} {label}
        </span>
        <span style={{
          display: 'inline-block', padding: '2px 10px', borderRadius: 12,
          fontSize: '0.875rem', fontWeight: 700, background: bg, color: accent,
        }}>
          {bookings.length}
        </span>
      </div>
      {bookings.length === 0 ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--text-light)' }}>—</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {bookings.slice(0, 5).map(b => (
            <li key={b.id} style={{ fontSize: '0.8125rem', color: 'var(--text)' }}>
              <strong>{titleCase(b.guest_name || '') || '—'}</strong>
              {b.property_name && (
                <span style={{ color: 'var(--text-secondary)' }}> · {titleCase(b.property_name)}</span>
              )}
            </li>
          ))}
          {bookings.length > 5 && (
            <li style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontStyle: 'italic' }}>
              + {bookings.length - 5} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
