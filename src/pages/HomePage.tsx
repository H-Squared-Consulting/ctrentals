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

  const todayIso = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }, []);

  // Pull every booking touching today — arrivals (check_in === today),
  // departures (check_out === today), and in-stay (check_in < today <
  // check_out). One query covers all three with check_in <= today AND
  // check_out >= today, then we bucket client-side. Cancelled
  // bookings + blocks are filtered out (the calendar's "what's
  // happening today" view shouldn't surface either).
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
        .neq('status', 'cancelled');
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
