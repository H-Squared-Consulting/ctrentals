/**
 * BookingCalendarPage — Operations → Bookings
 *
 * Property-rows × time-columns Gantt board for at-a-glance availability,
 * plus a flat list view for booking-by-booking detail. One booking modal
 * for view / edit / status flips.
 *
 * Zoom levels: 12m, 6m, 3m, 1m, 1w. Selected zoom drives the visible
 * window in days and the pixel width per day. The "today" line gives
 * spatial reference inside the timeline.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import type { Booking } from '../types';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import MultiPicker from '../components/MultiPicker';
import BookingModal from './BookingModal';
import { CT_RENTALS_PARTNER_ID, BOOKING_STATUS_OPTIONS } from './constants';
import { nightsBetween } from '../lib/nights';

interface Property {
  id: string;
  slug: string | null;
  property_name: string;
  bedrooms: number | null;
  suburb: string | null;
}

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function toDateStr(d: Date): string { return d.toISOString().split('T')[0]; }
function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}
function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function fmtMonth(d: Date): string {
  return d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });
}
function fmtFull(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtShort(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}
// nightsBetween used to live here. Consolidated into src/lib/nights.ts.
// Call sites that previously expected `number` (not nullable) now use `?? 0`.

// Zoom levels. Each defines the visible window in days and the pixel
// width per day; total board width = days × cellWidth.
const ZOOM_LEVELS = [
  { key: 'year',    label: '12M', days: 365, cellWidth: 4 },
  { key: 'half',    label: '6M',  days: 180, cellWidth: 8 },
  { key: 'quarter', label: '3M',  days: 90,  cellWidth: 18 },
  { key: 'month',   label: '1M',  days: 30,  cellWidth: 50 },
  { key: 'week',    label: '1W',  days: 7,   cellWidth: 180 },
] as const;
type ZoomKey = typeof ZOOM_LEVELS[number]['key'];

export default function BookingCalendarPage() {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();
  const location = useLocation();

  const [properties, setProperties] = useState<Property[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<'board' | 'list'>('board');
  const [zoom, setZoom] = useState<ZoomKey>('quarter');
  /** Date the timeline window starts at. User shifts this left/right via
   *  prev/next buttons or jumps via the Today / date picker. */
  /** Forward-looking default: today lands ~14% in from the left at every zoom.
   *  Default zoom is 3M (90 days), so today appears ~12 days in. */
  const [anchorDate, setAnchorDate] = useState<Date>(() => {
    const t = startOfDay(new Date());
    return addDays(t, -Math.floor(90 / 7));
  });

  // Filters + search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSuburb, setFilterSuburb] = useState('');
  const [filterBedrooms, setFilterBedrooms] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<'live' | 'cancelled' | 'all'>('live');

  const [editingBooking, setEditingBooking] = useState<any | null>(null);

  useEffect(() => { setPageTitle('Bookings'); }, [setPageTitle]);

  // Allow opening a "Convert enquiry" flow via router state.
  useEffect(() => {
    const state = location.state as { fromEnquiry?: Record<string, unknown> } | null;
    if (state?.fromEnquiry) {
      const enq = state.fromEnquiry;
      setEditingBooking({
        _fromEnquiry: true, enquiry_id: enq.id,
        guest_name: enq.client_name || '',
        guest_email: enq.client_email || '',
        guest_phone: enq.client_phone || '',
        guest_nationality: enq.nationality || '',
        guests_total: enq.guests_total || 1,
        guests_adults: enq.guests_adults || null,
        guests_children: enq.guests_children || null,
        check_in: enq.check_in || '',
        check_out: enq.check_out || '',
        property_id: enq.assigned_property_id || '',
        notes: enq.notes || '',
      });
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  async function loadData() {
    setLoading(true);
    try {
      const [propRes, bookRes] = await Promise.all([
        supabase
          .from('partner_properties')
          .select('id, slug, property_name, bedrooms, suburb')
          .eq('partner_id', CT_RENTALS_PARTNER_ID)
          .eq('is_archived', false)
          .order('slug'),
        supabase
          .from('bookings')
          .select('*')
          .eq('partner_id', CT_RENTALS_PARTNER_ID),
      ]);
      if (propRes.data) setProperties(propRes.data as Property[]);
      if (bookRes.data) setBookings(bookRes.data as Booking[]);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }
  useEffect(() => { if (supabase) loadData(); /* eslint-disable-next-line */ }, [supabase]);

  const suburbs = useMemo(() => {
    const s = new Set<string>();
    properties.forEach(p => { if (p.suburb) s.add(p.suburb); });
    return Array.from(s).sort();
  }, [properties]);

  const bedroomOptions = useMemo(() => {
    const s = new Set<number>();
    properties.forEach(p => { if (p.bedrooms && p.bedrooms > 0) s.add(p.bedrooms); });
    return Array.from(s).sort((a, b) => b - a);
  }, [properties]);

  const filteredProperties = useMemo(() => {
    let result = properties;
    if (searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter(p =>
        terms.every(t => [p.property_name, p.suburb, p.slug].filter(Boolean).join(' ').toLowerCase().includes(t))
      );
    }
    if (filterSuburb) result = result.filter(p => p.suburb === filterSuburb);
    if (filterBedrooms.length > 0) result = result.filter(p => p.bedrooms != null && filterBedrooms.includes(p.bedrooms));
    return result;
  }, [properties, searchQuery, filterSuburb, filterBedrooms]);

  // Status filter applies to bookings (list view + board bars).
  const filteredBookings = useMemo(() => {
    let result = bookings;
    if (statusFilter === 'live') result = result.filter(b => b.status !== 'cancelled');
    if (statusFilter === 'cancelled') result = result.filter(b => b.status === 'cancelled');
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(b =>
        (b.guest_name || '').toLowerCase().includes(q) ||
        (b.guest_email || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [bookings, statusFilter, searchQuery]);

  const propertyById = useMemo(() => {
    const m = new Map<string, Property>();
    for (const p of properties) m.set(p.id, p);
    return m;
  }, [properties]);

  // Zoom-derived measurements.
  const zoomCfg = ZOOM_LEVELS.find(z => z.key === zoom) || ZOOM_LEVELS[2];
  const visibleDays = zoomCfg.days;
  const cellWidth = zoomCfg.cellWidth;
  const totalWidth = visibleDays * cellWidth;
  const windowEnd = addDays(anchorDate, visibleDays);

  /** Month-level ticks (top row of the axis). */
  const monthTicks = useMemo(() => {
    const ticks: Array<{ label: string; left: number; width: number }> = [];
    const start = anchorDate;
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor < windowEnd) {
      const offsetDays = daysBetween(start, cursor);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const widthDays = daysBetween(cursor, monthEnd > windowEnd ? windowEnd : monthEnd);
      const widthPx = widthDays * cellWidth;
      if (widthPx >= 30) {
        ticks.push({ label: fmtMonth(cursor), left: offsetDays * cellWidth, width: widthPx });
      }
      cursor = monthEnd;
    }
    return ticks;
  }, [anchorDate, windowEnd, cellWidth]);

  /** Bottom-row labels — clean dates, no day-of-week (weekends are shaded
   *  instead so the week rhythm is visible without label clutter).
   *    12M  → no labels (month strip is enough)
   *    6M   → "5 Jan" on alternating Mondays
   *    3M   → "5 Jan" on every Monday
   *    1M   → day-of-month on every day
   *    1W   → "5 Jan" on every day
   */
  const axisLabels = useMemo(() => {
    const labels: Array<{ text: string; left: number; key: string }> = [];
    if (zoom === 'year') return labels;
    const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (let d = 0; d < visibleDays; d++) {
      const date = addDays(anchorDate, d);
      const dayOfWeek = date.getDay();
      const isMonday = dayOfWeek === 1;
      let text = '';
      if (zoom === 'week') {
        text = `${date.getDate()} ${monthAbbr[date.getMonth()]}`;
      } else if (zoom === 'month') {
        text = String(date.getDate());
      } else if (zoom === 'quarter') {
        if (isMonday) text = `${date.getDate()} ${monthAbbr[date.getMonth()]}`;
      } else if (zoom === 'half') {
        if (isMonday) {
          const weeksSinceAnchor = Math.floor(d / 7);
          if (weeksSinceAnchor % 2 === 0) {
            text = `${date.getDate()} ${monthAbbr[date.getMonth()]}`;
          }
        }
      }
      if (text) labels.push({ text, left: d * cellWidth, key: `l${d}` });
    }
    return labels;
  }, [anchorDate, visibleDays, cellWidth, zoom]);

  /** Weekend shaded blocks (Saturday + Sunday pairs) so the week rhythm is
   *  visible at a glance. Rendered in both the axis and every track. */
  const weekendBlocks = useMemo(() => {
    const blocks: Array<{ left: number; width: number; key: string }> = [];
    for (let d = 0; d < visibleDays; d++) {
      const date = addDays(anchorDate, d);
      if (date.getDay() === 6) {
        // Saturday — the block covers Saturday + Sunday.
        blocks.push({ left: d * cellWidth, width: cellWidth * 2, key: `we${d}` });
      } else if (d === 0 && date.getDay() === 0) {
        // First day is a Sunday — shade just that single day.
        blocks.push({ left: 0, width: cellWidth, key: 'we0' });
      }
    }
    return blocks;
  }, [anchorDate, visibleDays, cellWidth]);

  /** Vertical grid lines for the track. Three weights:
   *    month   → solid 2px (always shown)
   *    week    → faint 1px on every Monday (all zooms except 12M)
   *    day     → very faint on every day (only at 1M and 1W)
   */
  const gridLines = useMemo(() => {
    const lines: Array<{ left: number; kind: 'month' | 'week' | 'day'; key: string }> = [];
    for (let d = 1; d < visibleDays; d++) {
      const date = addDays(anchorDate, d);
      const isFirstOfMonth = date.getDate() === 1;
      const isMonday = date.getDay() === 1;
      if (isFirstOfMonth) {
        lines.push({ left: d * cellWidth, kind: 'month', key: `g${d}` });
      } else if (isMonday && zoom !== 'year') {
        lines.push({ left: d * cellWidth, kind: 'week', key: `g${d}` });
      } else if ((zoom === 'week' || zoom === 'month')) {
        lines.push({ left: d * cellWidth, kind: 'day', key: `g${d}` });
      }
    }
    return lines;
  }, [anchorDate, visibleDays, cellWidth, zoom]);

  const todayLeft = useMemo(() => {
    const today = startOfDay(new Date());
    const offset = daysBetween(anchorDate, today);
    return offset >= 0 && offset <= visibleDays ? offset * cellWidth : null;
  }, [anchorDate, visibleDays, cellWidth]);

  function jumpToday() {
    setAnchorDate(addDays(startOfDay(new Date()), -Math.floor(visibleDays / 7)));
  }
  function shiftWindow(direction: -1 | 1) {
    setAnchorDate(addDays(anchorDate, Math.floor(visibleDays / 2) * direction));
  }

  /** Bookings for one property within the visible window. */
  function visibleBookingsFor(propertyId: string): Booking[] {
    return filteredBookings.filter(b => {
      if (b.property_id !== propertyId) return false;
      const bStart = new Date(b.check_in);
      const bEnd = new Date(b.check_out);
      return bEnd > anchorDate && bStart < windowEnd;
    });
  }

  /** Pixel offset + width for a booking bar within the timeline track. */
  function barPosition(b: Booking): { left: number; width: number } | null {
    const bStart = new Date(b.check_in);
    const bEnd = new Date(b.check_out);
    const startOffset = Math.max(0, daysBetween(anchorDate, bStart));
    const endOffset = Math.min(visibleDays, daysBetween(anchorDate, bEnd));
    const widthDays = endOffset - startOffset;
    if (widthDays <= 0) return null;
    return { left: startOffset * cellWidth, width: widthDays * cellWidth - 2 };
  }

  function openNewBooking() {
    setEditingBooking({});
  }

  if (loading && properties.length === 0) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  return (
    <div>
      {/* Toolbar — baseline order plus zoom + date nav for the board */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <div className="view-toggle">
              <button
                className={`view-toggle-btn ${view === 'board' ? 'active' : ''}`}
                onClick={() => setView('board')}
                title="Board view (property timeline)"
              >
                ▦ Board
              </button>
              <button
                className={`view-toggle-btn ${view === 'list' ? 'active' : ''}`}
                onClick={() => setView('list')}
                title="List view (one row per booking)"
              >
                ☰ List
              </button>
            </div>
            <select
              className="list-filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              title="Filter by status"
            >
              <option value="live">Live (not cancelled)</option>
              <option value="cancelled">Cancelled only</option>
              <option value="all">All</option>
            </select>
            <select
              className="list-filter-select"
              value={filterSuburb}
              onChange={(e) => setFilterSuburb(e.target.value)}
              title="Filter by suburb"
            >
              <option value="">All suburbs</option>
              {suburbs.map(s => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
            <MultiPicker
              label="Beds"
              options={bedroomOptions}
              selected={filterBedrooms}
              onChange={(next) => setFilterBedrooms(next.map(Number))}
              format={(v) => `${v} bed`}
            />
            <div className="list-search">
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search by guest, property, suburb…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && <button className="list-search-clear" onClick={() => setSearchQuery('')}>✕</button>}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {view === 'board'
                ? <>{filteredProperties.length} of {properties.length} properties</>
                : <>{filteredBookings.length} of {bookings.length} bookings</>}
            </span>
          </div>
          <div className="list-toolbar-right">
            {view === 'board' && (
              <>
                <div className="view-toggle" title="Zoom level">
                  {ZOOM_LEVELS.map(level => (
                    <button
                      key={level.key}
                      className={`view-toggle-btn ${zoom === level.key ? 'active' : ''}`}
                      onClick={() => setZoom(level.key)}
                      title={level.label}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
                <button className="btn btn-ghost" onClick={() => shiftWindow(-1)} title="Earlier">←</button>
                <button className="btn btn-ghost" onClick={jumpToday}>Today</button>
                <button className="btn btn-ghost" onClick={() => shiftWindow(1)} title="Later">→</button>
              </>
            )}
            <button className="btn btn-primary" onClick={openNewBooking}>
              + New Booking
            </button>
          </div>
        </div>
      </div>

      {view === 'board' ? (
        <BookingsBoard
          properties={filteredProperties}
          totalWidth={totalWidth}
          cellWidth={cellWidth}
          monthTicks={monthTicks}
          axisLabels={axisLabels}
          gridLines={gridLines}
          weekendBlocks={weekendBlocks}
          todayLeft={todayLeft}
          visibleBookingsFor={visibleBookingsFor}
          barPosition={barPosition}
          onBarClick={(b) => setEditingBooking(b)}
          onPropertyClick={(p) => {
            setEditingBooking({ property_id: p.id });
          }}
        />
      ) : (
        <BookingsList
          bookings={filteredBookings}
          propertyById={propertyById}
          onOpen={(b) => setEditingBooking(b)}
        />
      )}

      {editingBooking && (
        <BookingModal
          booking={editingBooking}
          properties={properties}
          onClose={() => setEditingBooking(null)}
          onSave={async (enquiryId?: string) => {
            setEditingBooking(null);
            if (enquiryId) {
              await supabase
                .from('enquiries')
                .update({ status: 'booked', updated_at: new Date().toISOString() })
                .eq('id', enquiryId);
            }
            await loadData();
          }}
          supabase={supabase}
          user={user}
          partnerId={CT_RENTALS_PARTNER_ID}
        />
      )}
    </div>
  );
}

// ─── Board view ────────────────────────────────────────────────────────

function BookingsBoard({
  properties, totalWidth, cellWidth, monthTicks, axisLabels, gridLines, weekendBlocks, todayLeft, visibleBookingsFor, barPosition, onBarClick, onPropertyClick,
}: {
  properties: Property[];
  totalWidth: number;
  cellWidth: number;
  monthTicks: Array<{ label: string; left: number; width: number }>;
  axisLabels: Array<{ text: string; left: number; key: string }>;
  gridLines: Array<{ left: number; kind: 'month' | 'week' | 'day'; key: string }>;
  weekendBlocks: Array<{ left: number; width: number; key: string }>;
  todayLeft: number | null;
  visibleBookingsFor: (id: string) => Booking[];
  barPosition: (b: Booking) => { left: number; width: number } | null;
  onBarClick: (b: Booking) => void;
  onPropertyClick: (p: Property) => void;
}) {
  if (properties.length === 0) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>
        No properties match the current filters.
      </div>
    );
  }

  // Two physical panes: left (property column, no horizontal scroll) and
  // right (timeline, scrolls horizontally). Vertical scroll lives on the
  // right pane; we mirror its scrollTop onto the left so rows stay aligned.
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  function handleRightScroll() {
    if (leftRef.current && rightRef.current) {
      leftRef.current.scrollTop = rightRef.current.scrollTop;
    }
  }

  return (
    <div className="bookings-board" style={{ ['--cell-width' as any]: `${cellWidth}px` }}>
      <div className="bookings-board-fixed" ref={leftRef}>
        <div className="bookings-board-corner">Property</div>
        {properties.map(prop => (
          <div
            key={prop.id}
            className="bookings-board-property"
            onClick={() => onPropertyClick(prop)}
            title={`${prop.slug || ''} · ${titleCase(prop.property_name)}${prop.bedrooms ? ` · ${prop.bedrooms} bed` : ''}${prop.suburb ? ` · ${titleCase(prop.suburb)}` : ''}`}
          >
            <span className="bookings-board-property-code">{prop.slug || '—'}</span>
            <span className="bookings-board-property-name">{titleCase(prop.property_name)}</span>
          </div>
        ))}
      </div>
      <div className="bookings-board-scroll" ref={rightRef} onScroll={handleRightScroll}>
        <div className="bookings-board-scroll-inner" style={{ width: totalWidth }}>
          {/* Backdrop — weekend tint + grid lines + today line, full board height */}
          {weekendBlocks.map(w => (
            <div key={w.key} className="bookings-board-weekend" style={{ left: w.left, width: w.width }} />
          ))}
          {gridLines.map(g => (
            <div
              key={g.key}
              className={`bookings-board-gridline bookings-board-gridline--${g.kind}`}
              style={{ left: g.left }}
            />
          ))}
          {todayLeft != null && (
            <div className="bookings-board-today" style={{ left: todayLeft }} title="Today" />
          )}
          {/* Axis — sticky to the top of the scroll pane so it stays visible */}
          <div className="bookings-board-axis" style={{ width: totalWidth }}>
            {monthTicks.map((t, i) => (
              <div key={`m${i}`} className="bookings-board-axis-tick" style={{ left: t.left, width: t.width }}>
                {t.label}
              </div>
            ))}
            {axisLabels.map(l => (
              <div
                key={l.key}
                className="bookings-board-axis-label"
                style={{ left: l.left + cellWidth / 2 }}
              >
                {l.text}
              </div>
            ))}
          </div>
          {/* Track rows — just the bars; the backdrop spans these vertically */}
          {properties.map(prop => (
            <div key={prop.id} className="bookings-board-track">
              {visibleBookingsFor(prop.id).map(b => {
                const pos = barPosition(b);
                if (!pos) return null;
                return (
                  <div
                    key={b.id}
                    className={`booking-bar booking-bar--${b.status}`}
                    style={{ left: pos.left, width: pos.width }}
                    onClick={(e) => { e.stopPropagation(); onBarClick(b); }}
                    title={`${b.guest_name || 'Guest'} · ${fmtFull(b.check_in)} to ${fmtFull(b.check_out)}`}
                  >
                    {pos.width > 60 ? titleCase(b.guest_name) || 'Booking' : ''}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── List view ─────────────────────────────────────────────────────────

interface BookingRow extends DataRow {
  id: string;
  code: string;
  property: string;
  guest: string;
  email: string;
  check_in: string;
  check_out: string;
  nights: number;
  total: number;
  status: string;
  ref: string;
  booking: Booking;
}

function BookingsList({
  bookings, propertyById, onOpen,
}: {
  bookings: Booking[];
  propertyById: Map<string, Property>;
  onOpen: (b: Booking) => void;
}) {
  const rows: BookingRow[] = bookings.map(b => {
    const prop = propertyById.get(b.property_id);
    return {
      id: b.id,
      code: prop?.slug || '',
      property: titleCase(prop?.property_name || ''),
      guest: titleCase(b.guest_name || ''),
      email: b.guest_email ? b.guest_email.toLowerCase() : '',
      check_in: b.check_in,
      check_out: b.check_out,
      nights: nightsBetween(b.check_in, b.check_out) ?? 0,
      total: Number(b.total_amount) || 0,
      status: b.status,
      ref: (b.id || '').slice(0, 8),
      booking: b,
    };
  });

  const statusLabel = (s: string) =>
    BOOKING_STATUS_OPTIONS.find((o: any) => o.value === s)?.label || titleCase(s);

  const columns = [
    {
      key: 'code', label: 'Code', sortable: true, width: '100px',
      render: (row: DataRow) => (
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 700 }}>
          {(row as BookingRow).code || '—'}
        </span>
      ),
    },
    {
      key: 'property', label: 'Property', sortable: true,
      render: (row: DataRow) => <strong>{(row as BookingRow).property || <span className="text-light">-</span>}</strong>,
    },
    {
      key: 'guest', label: 'Guest', sortable: true,
      render: (row: DataRow) => {
        const r = row as BookingRow;
        return (
          <div className="list-client-text">
            <span className="list-client-name">{r.guest || '—'}</span>
            {r.email && <span className="list-client-meta">{r.email}</span>}
          </div>
        );
      },
    },
    {
      key: 'check_in', label: 'Dates', sortable: true,
      render: (row: DataRow) => {
        const r = row as BookingRow;
        if (!r.check_in || !r.check_out) return <span className="list-dates-empty">No dates</span>;
        return (
          <span className="list-dates">
            {fmtShort(r.check_in)}<span className="list-dates-arrow">→</span>{fmtShort(r.check_out)}
          </span>
        );
      },
    },
    {
      key: 'nights', label: 'Nights', sortable: true, align: 'center' as const, width: '80px',
      render: (row: DataRow) => (row as BookingRow).nights || <span className="list-dates-empty">—</span>,
    },
    {
      key: 'total', label: 'Total', sortable: true, align: 'right' as const, width: '110px',
      render: (row: DataRow) => {
        const v = (row as BookingRow).total;
        return v > 0
          ? <span style={{ fontWeight: 600 }}>R {v.toLocaleString('en-US')}</span>
          : <span className="text-light">—</span>;
      },
    },
    {
      key: 'status', label: 'Status', sortable: true, align: 'center' as const,
      render: (row: DataRow) => {
        const r = row as BookingRow;
        return (
          <span className={`ops-status-pill ops-status-pill--${r.status}`}>
            <span className="ops-status-pill-dot" />
            {statusLabel(r.status)}
          </span>
        );
      },
    },
    {
      key: 'ref', label: 'Ref', sortable: true, hideOnMobile: true, width: '100px',
      render: (row: DataRow) => (
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.6875rem', color: 'var(--text-light)' }}>
          {(row as BookingRow).ref}
        </span>
      ),
    },
    {
      key: 'actions', label: '', align: 'right' as const, width: '90px',
      render: (row: DataRow) => (
        <div className="list-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="list-action-icon" title="View booking" onClick={() => onOpen((row as BookingRow).booking)}>👁</button>
          <button type="button" className="list-action-icon" title="Edit booking" onClick={() => onOpen((row as BookingRow).booking)}>✏️</button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={false}
      searchable={false}
      resultsBarContent={null}
      defaultSort={{ key: 'check_in', direction: 'asc' }}
      onRowClick={(row: DataRow) => onOpen((row as BookingRow).booking)}
      emptyMessage="No bookings yet. Click + New Booking to add one."
    />
  );
}
