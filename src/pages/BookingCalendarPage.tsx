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
  is_published: boolean;
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

// Continuous-scroll timeline: one fixed range (today ± months below),
// zoom controls cell width only (px per day = density). Three tiers.
const RANGE_PAST_DAYS = 365;     // 1 year back
const RANGE_FUTURE_DAYS = 730;   // 2 years forward
const RANGE_DAYS = RANGE_PAST_DAYS + RANGE_FUTURE_DAYS;

const ZOOM_LEVELS = [
  { key: 'overview', label: '⊞ Overview', cellWidth: 6  },
  { key: 'standard', label: '▦ Standard', cellWidth: 14 },
  { key: 'detail',   label: '☷ Detail',   cellWidth: 28 },
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
  const [zoom, setZoom] = useState<ZoomKey>('standard');
  /** Token incremented when the user clicks Today; BookingsBoard watches it
   *  and scrolls the viewport to today's offset. Avoids lifting the scroll
   *  ref into this component. */
  const [jumpToken, setJumpToken] = useState(0);

  // Filters + search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSuburb, setFilterSuburb] = useState<string[]>([]);
  const [filterBedrooms, setFilterBedrooms] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'booked' | 'blocked'>('all');
  const [propertyStatusFilter, setPropertyStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [boardMode, setBoardMode] = useState<'occupancy' | 'availability'>('occupancy');

  // "Find availability" — narrows property list to those free for an enquiry
  // window. Flex extends the test window symmetrically on both sides.
  const [searchCheckIn, setSearchCheckIn] = useState('');
  const [searchCheckOut, setSearchCheckOut] = useState('');
  const [searchFlex, setSearchFlex] = useState<0 | 1 | 3 | 7>(0);

  // Local-only Block state until Jordon ships the bookings.kind column.
  // Keyed by booking id; survives reload, lives in this browser only.
  const BLOCK_STORAGE_KEY = 'ctr.bookings.blocked.v1';
  const [blockedIds, setBlockedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(BLOCK_STORAGE_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });
  function persistBlocked(next: Set<string>) {
    setBlockedIds(next);
    try { localStorage.setItem(BLOCK_STORAGE_KEY, JSON.stringify(Array.from(next))); } catch { /* noop */ }
  }
  function isBlocked(id: string): boolean { return blockedIds.has(id); }
  function toggleBlocked(id: string) {
    const next = new Set(blockedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    persistBlocked(next);
  }

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
          .select('id, slug, property_name, bedrooms, suburb, is_published')
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

  // Single source of truth for "does this property pass the property-side
  // filters in the toolbar?" — used by both the Board view (filters the
  // property list directly) and the List view (filters bookings via their
  // property_id). Without this, the List view silently ignored every
  // property filter — status, suburb, beds, search — because the
  // filter-bar state was only wired into filteredProperties.
  const propertyMatchesFilters = useMemo(() => {
    const terms = searchQuery.trim()
      ? searchQuery.toLowerCase().split(/\s+/).filter(Boolean)
      : [];
    return (p: Property): boolean => {
      if (propertyStatusFilter === 'active'   && !p.is_published) return false;
      if (propertyStatusFilter === 'inactive' &&  p.is_published) return false;
      if (filterSuburb.length > 0 && (p.suburb == null || !filterSuburb.includes(p.suburb))) return false;
      if (filterBedrooms.length > 0 && (p.bedrooms == null || !filterBedrooms.includes(p.bedrooms))) return false;
      if (terms.length > 0) {
        const hay = [p.property_name, p.suburb, p.slug].filter(Boolean).join(' ').toLowerCase();
        if (!terms.every(t => hay.includes(t))) return false;
      }
      return true;
    };
  }, [propertyStatusFilter, filterSuburb, filterBedrooms, searchQuery]);

  const filteredProperties = useMemo(() => {
    let result = properties.filter(propertyMatchesFilters);
    // Date range filter, mode-aware:
    //   Occupancy   → show only properties booked/blocked in the window
    //   Availability → show only properties free in the window
    // Window extended by ±flex days on each side; cancelled bookings ignored.
    if (searchCheckIn && searchCheckOut) {
      const winStart = addDays(new Date(searchCheckIn), -searchFlex);
      const winEnd = addDays(new Date(searchCheckOut), searchFlex);
      if (winEnd > winStart) {
        result = result.filter(p => {
          const conflicts = bookings.some(b => {
            if (b.property_id !== p.id) return false;
            if (b.status === 'cancelled') return false;
            const bStart = new Date(b.check_in);
            const bEnd = new Date(b.check_out);
            return bEnd > winStart && bStart < winEnd;
          });
          return boardMode === 'occupancy' ? conflicts : !conflicts;
        });
      }
    }
    return result;
  }, [properties, propertyMatchesFilters, searchCheckIn, searchCheckOut, searchFlex, bookings, boardMode]);

  const propertyById = useMemo(() => {
    const m = new Map<string, Property>();
    for (const p of properties) m.set(p.id, p);
    return m;
  }, [properties]);

  // Cancelled bookings are dropped entirely (if it was cancelled it never
  // happened — those dates are Available again). Remaining bookings are
  // partitioned by the localStorage-backed Blocked flag into Booked vs Blocked.
  // Property-side filters (status, suburb, beds, search) are applied via
  // each booking's property — keeps the toolbar honest in List view, not
  // just Board view. Date range narrows to bookings overlapping the
  // window (mode-agnostic — the Board's Occupancy/Availability toggle
  // only makes sense for the property list, not for individual bookings).
  const filteredBookings = useMemo(() => {
    let result = bookings.filter(b => b.status !== 'cancelled');
    if (statusFilter === 'booked')  result = result.filter(b => !isBlocked(b.id));
    if (statusFilter === 'blocked') result = result.filter(b => isBlocked(b.id));

    result = result.filter(b => {
      const prop = propertyById.get(b.property_id);
      return prop ? propertyMatchesFilters(prop) : false;
    });

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(b =>
        (b.guest_name || '').toLowerCase().includes(q) ||
        (b.guest_email || '').toLowerCase().includes(q)
      );
    }

    if (searchCheckIn && searchCheckOut) {
      const winStart = addDays(new Date(searchCheckIn), -searchFlex);
      const winEnd = addDays(new Date(searchCheckOut), searchFlex);
      if (winEnd > winStart) {
        result = result.filter(b => {
          const bStart = new Date(b.check_in);
          const bEnd = new Date(b.check_out);
          return bEnd > winStart && bStart < winEnd;
        });
      }
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, statusFilter, searchQuery, blockedIds, propertyMatchesFilters, propertyById, searchCheckIn, searchCheckOut, searchFlex]);

  // Continuous timeline: one fixed range, zoom controls density only.
  // rangeStart sits 1 year before today; rangeEnd 2 years after. The user
  // scrolls freely across the whole span; Today scrolls the viewport.
  const zoomCfg = ZOOM_LEVELS.find(z => z.key === zoom) || ZOOM_LEVELS[1];
  const cellWidth = zoomCfg.cellWidth;
  const rangeStart = useMemo(() => addDays(startOfDay(new Date()), -RANGE_PAST_DAYS), []);
  const rangeEnd = useMemo(() => addDays(rangeStart, RANGE_DAYS), [rangeStart]);
  const totalWidth = RANGE_DAYS * cellWidth;

  /** Month-level ticks (top row of the axis). */
  const monthTicks = useMemo(() => {
    const ticks: Array<{ label: string; left: number; width: number }> = [];
    let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    while (cursor < rangeEnd) {
      const offsetDays = daysBetween(rangeStart, cursor);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const widthDays = daysBetween(cursor, monthEnd > rangeEnd ? rangeEnd : monthEnd);
      const widthPx = widthDays * cellWidth;
      if (widthPx >= 30) {
        ticks.push({ label: fmtMonth(cursor), left: offsetDays * cellWidth, width: widthPx });
      }
      cursor = monthEnd;
    }
    return ticks;
  }, [rangeStart, rangeEnd, cellWidth]);

  /** Bottom-row labels — clean dates, no day-of-week (weekends are shaded
   *  instead so the week rhythm is visible without label clutter).
   *    12M  → no labels (month strip is enough)
   *    6M   → "5 Jan" on alternating Mondays
   *    3M   → "5 Jan" on every Monday
   *    1M   → day-of-month on every day
   *    1W   → "5 Jan" on every day
   */
  /** Bottom-row labels. Density adapts to zoom tier so they stay readable:
   *    overview → "5 Jan" every other Monday (~biweekly)
   *    standard → "5 Jan" every Monday
   *    detail   → day-of-month on every day
   */
  const axisLabels = useMemo(() => {
    const labels: Array<{ text: string; left: number; key: string }> = [];
    const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (let d = 0; d < RANGE_DAYS; d++) {
      const date = addDays(rangeStart, d);
      const isMonday = date.getDay() === 1;
      let text = '';
      if (zoom === 'detail') {
        text = String(date.getDate());
      } else if (zoom === 'standard') {
        if (isMonday) text = `${date.getDate()} ${monthAbbr[date.getMonth()]}`;
      } else if (zoom === 'overview') {
        if (isMonday) {
          const weeksSinceStart = Math.floor(d / 7);
          if (weeksSinceStart % 2 === 0) {
            text = `${date.getDate()} ${monthAbbr[date.getMonth()]}`;
          }
        }
      }
      if (text) labels.push({ text, left: d * cellWidth, key: `l${d}` });
    }
    return labels;
  }, [rangeStart, cellWidth, zoom]);

  /** Weekend shaded blocks (Saturday + Sunday pairs) so the week rhythm is
   *  visible at a glance. Rendered in both the axis and every track. */
  const weekendBlocks = useMemo(() => {
    const blocks: Array<{ left: number; width: number; key: string }> = [];
    for (let d = 0; d < RANGE_DAYS; d++) {
      const date = addDays(rangeStart, d);
      if (date.getDay() === 6) {
        blocks.push({ left: d * cellWidth, width: cellWidth * 2, key: `we${d}` });
      } else if (d === 0 && date.getDay() === 0) {
        blocks.push({ left: 0, width: cellWidth, key: 'we0' });
      }
    }
    return blocks;
  }, [rangeStart, cellWidth]);

  /** Vertical grid lines for the track. Three weights:
   *    month   → solid 2px (always shown)
   *    week    → faint 1px on every Monday (all zooms except 12M)
   *    day     → very faint on every day (only at 1M and 1W)
   */
  const gridLines = useMemo(() => {
    const lines: Array<{ left: number; kind: 'month' | 'week' | 'day'; key: string }> = [];
    for (let d = 1; d < RANGE_DAYS; d++) {
      const date = addDays(rangeStart, d);
      const isFirstOfMonth = date.getDate() === 1;
      const isMonday = date.getDay() === 1;
      if (isFirstOfMonth) {
        lines.push({ left: d * cellWidth, kind: 'month', key: `g${d}` });
      } else if (isMonday && zoom !== 'overview') {
        lines.push({ left: d * cellWidth, kind: 'week', key: `g${d}` });
      } else if (zoom === 'detail') {
        lines.push({ left: d * cellWidth, kind: 'day', key: `g${d}` });
      }
    }
    return lines;
  }, [rangeStart, cellWidth, zoom]);

  const todayLeft = useMemo(() => {
    const today = startOfDay(new Date());
    const offset = daysBetween(rangeStart, today);
    return offset >= 0 && offset <= RANGE_DAYS ? offset * cellWidth : null;
  }, [rangeStart, cellWidth]);

  function jumpToday() {
    setJumpToken(t => t + 1);
  }

  /** Bookings for one property within the timeline range. */
  function visibleBookingsFor(propertyId: string): Booking[] {
    return filteredBookings.filter(b => {
      if (b.property_id !== propertyId) return false;
      const bStart = new Date(b.check_in);
      const bEnd = new Date(b.check_out);
      return bEnd > rangeStart && bStart < rangeEnd;
    });
  }

  /** Pixel offset + width for a booking bar within the timeline track. */
  function barPosition(b: Booking): { left: number; width: number } | null {
    const bStart = new Date(b.check_in);
    const bEnd = new Date(b.check_out);
    const startOffset = Math.max(0, daysBetween(rangeStart, bStart));
    const endOffset = Math.min(RANGE_DAYS, daysBetween(rangeStart, bEnd));
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
      {/* Toolbar split: view + actions on top, filters + search on the bottom. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="list-toolbar" style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 12, marginBottom: 12 }}>
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
            {view === 'board' && (
              <div className="view-toggle" title="What the bars show">
                <button
                  className={`view-toggle-btn ${boardMode === 'occupancy' ? 'active' : ''}`}
                  onClick={() => setBoardMode('occupancy')}
                  title="Show booked and blocked dates"
                >
                  ▣ Occupancy
                </button>
                <button
                  className={`view-toggle-btn ${boardMode === 'availability' ? 'active' : ''}`}
                  onClick={() => setBoardMode('availability')}
                  title="Show only dates available to book"
                >
                  ☐ Availability
                </button>
              </div>
            )}
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
                <button className="btn btn-ghost" onClick={jumpToday} title="Scroll to today">Today</button>
              </>
            )}
            <button className="btn btn-primary" onClick={openNewBooking}>
              + New Booking
            </button>
          </div>
        </div>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <select
              className="list-filter-select"
              value={propertyStatusFilter}
              onChange={(e) => setPropertyStatusFilter(e.target.value as 'active' | 'inactive' | 'all')}
              title="Filter by property status"
            >
              <option value="active">Active properties</option>
              <option value="inactive">Inactive properties</option>
              <option value="all">All properties</option>
            </select>
            <select
              className="list-filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'booked' | 'blocked')}
              title="Filter by booking type"
            >
              <option value="all">All</option>
              <option value="booked">Booked only</option>
              <option value="blocked">Blocked only</option>
            </select>
            <MultiPicker
              label="Suburbs"
              options={suburbs}
              selected={filterSuburb}
              onChange={(next) => setFilterSuburb(next.map(String))}
              format={(v) => titleCase(String(v))}
            />
            <MultiPicker
              label="Beds"
              options={bedroomOptions}
              selected={filterBedrooms}
              onChange={(next) => setFilterBedrooms(next.map(Number))}
              format={(v) => `${v} bed`}
            />
            <div className="bookings-availability-find" title="Show properties free for these dates">
              <span className="bookings-availability-find-label">Date range</span>
              <input
                type="date"
                className="bookings-availability-date-input"
                value={searchCheckIn}
                onChange={(e) => setSearchCheckIn(e.target.value)}
                title="Check in"
              />
              <span className="bookings-availability-find-arrow">→</span>
              <input
                type="date"
                className="bookings-availability-date-input"
                value={searchCheckOut}
                min={searchCheckIn || undefined}
                onChange={(e) => setSearchCheckOut(e.target.value)}
                title="Check out"
              />
              <select
                className="list-filter-select"
                value={searchFlex}
                onChange={(e) => setSearchFlex(Number(e.target.value) as 0 | 1 | 3 | 7)}
                title="Date flexibility"
              >
                <option value={0}>Exact</option>
                <option value={1}>±1 day</option>
                <option value={3}>±3 days</option>
                <option value={7}>±7 days</option>
              </select>
              {(searchCheckIn || searchCheckOut) && (
                <button
                  className="list-search-clear"
                  onClick={() => { setSearchCheckIn(''); setSearchCheckOut(''); setSearchFlex(0); }}
                  title="Clear date search"
                >✕</button>
              )}
            </div>
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
          </div>
          <div className="list-toolbar-right">
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {view === 'board'
                ? <>{filteredProperties.length} of {properties.length} properties</>
                : <>{filteredBookings.length} of {bookings.length} bookings</>}
            </span>
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
          isBlocked={isBlocked}
          boardMode={boardMode}
          rangeStart={rangeStart}
          todayLeftPx={todayLeft}
          jumpToken={jumpToken}
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
          isBlocked={editingBooking.id ? isBlocked(editingBooking.id) : false}
          onToggleBlocked={editingBooking.id ? () => toggleBlocked(editingBooking.id) : undefined}
        />
      )}
    </div>
  );
}

// ─── Board view ────────────────────────────────────────────────────────

function BookingsBoard({
  properties, totalWidth, cellWidth, monthTicks, axisLabels, gridLines, weekendBlocks, todayLeft, visibleBookingsFor, barPosition, isBlocked, boardMode, rangeStart, todayLeftPx, jumpToken, onBarClick, onPropertyClick,
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
  isBlocked: (id: string) => boolean;
  boardMode: 'occupancy' | 'availability';
  rangeStart: Date;
  todayLeftPx: number | null;
  jumpToken: number;
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

  // Scroll viewport to today on mount, zoom change, and any Today click.
  // Today lands ~12% in from the left so the user can see a few past days
  // for context plus a wide future-looking window.
  useEffect(() => {
    if (rightRef.current && todayLeftPx != null) {
      const offset = rightRef.current.clientWidth * 0.12;
      rightRef.current.scrollLeft = Math.max(0, todayLeftPx - offset);
    }
  }, [todayLeftPx, jumpToken, cellWidth]);

  return (
    <div className="bookings-board" style={{ ['--cell-width' as any]: `${cellWidth}px` }}>
      <div className="bookings-board-fixed" ref={leftRef}>
        <div className="bookings-board-corner">Property</div>
        {properties.map((prop, idx) => (
          <div
            key={prop.id}
            className={`bookings-board-property${idx % 2 === 1 ? ' bookings-board-property--alt' : ''}`}
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
          {properties.map((prop, idx) => {
            // For Availability mode, compute gap segments between bookings
            // within the visible window. Cancelled bookings are already
            // filtered out upstream so they free their dates as expected.
            const winStart = rangeStart;
            const winEnd = addDays(rangeStart, RANGE_DAYS);
            const sorted = visibleBookingsFor(prop.id)
              .map(b => ({ b, start: new Date(b.check_in), end: new Date(b.check_out) }))
              .sort((a, z) => a.start.getTime() - z.start.getTime());
            const gaps: Array<{ left: number; width: number; nights: number; from: Date; to: Date }> = [];
            let cursor = winStart;
            for (const { start, end } of sorted) {
              const segEnd = start > winEnd ? winEnd : start;
              if (segEnd > cursor) {
                const nights = daysBetween(cursor, segEnd);
                if (nights >= 1) {
                  gaps.push({
                    left: daysBetween(winStart, cursor) * cellWidth,
                    width: nights * cellWidth,
                    nights, from: cursor, to: segEnd,
                  });
                }
              }
              if (end > cursor) cursor = end > winEnd ? winEnd : end;
              if (cursor >= winEnd) break;
            }
            if (cursor < winEnd) {
              const nights = daysBetween(cursor, winEnd);
              if (nights >= 1) {
                gaps.push({
                  left: daysBetween(winStart, cursor) * cellWidth,
                  width: nights * cellWidth,
                  nights, from: cursor, to: winEnd,
                });
              }
            }
            return (
            <div key={prop.id} className={`bookings-board-track${idx % 2 === 1 ? ' bookings-board-track--alt' : ''}`}>
              {boardMode === 'occupancy' && visibleBookingsFor(prop.id).map(b => {
                const pos = barPosition(b);
                if (!pos) return null;
                return (
                  <div
                    key={b.id}
                    className={`booking-bar booking-bar--${isBlocked(b.id) ? 'blocked' : 'booked'}`}
                    style={{ left: pos.left, width: pos.width }}
                    onClick={(e) => { e.stopPropagation(); onBarClick(b); }}
                    title={`${isBlocked(b.id) ? 'Block' : (b.guest_name || 'Guest')} · ${fmtFull(b.check_in)} to ${fmtFull(b.check_out)}`}
                  >
                    {pos.width > 60 ? (isBlocked(b.id) ? 'Block' : (titleCase(b.guest_name) || 'Booking')) : ''}
                  </div>
                );
              })}
              {boardMode === 'availability' && gaps.map((g, i) => (
                <div
                  key={`gap-${prop.id}-${i}`}
                  className="availability-bar"
                  style={{ left: g.left, width: g.width }}
                  title={`${g.nights} night${g.nights === 1 ? '' : 's'} available · ${fmtFull(g.from)} → ${fmtFull(g.to)}`}
                >
                  {g.width > 90 ? `${g.nights} nights free` : g.width > 40 ? `${g.nights}n` : ''}
                </div>
              ))}
            </div>
            );
          })}
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
