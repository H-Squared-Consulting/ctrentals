import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import type { Booking } from '../types';
import DateInput from '../components/DateInput';
import BookingModal from './BookingModal';
import { CT_RENTALS_PARTNER_ID, BOOKING_STATUS_CONFIG } from './constants';

interface Property {
  id: string;
  property_name: string;
  bedrooms: number | null;
  suburb: string | null;
}

// ── Helpers ──
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function toDateStr(d: Date): string { return d.toISOString().split('T')[0]; }
function isSameDay(a: Date, b: Date): boolean { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function daysBetween(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / 86400000); }
function isWeekend(d: Date): boolean { const day = d.getDay(); return day === 0 || day === 6; }
function fmtShort(d: Date): string { return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }); }
function fmtFull(d: Date): string { return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }); }

const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS_MINI = ['M','T','W','T','F','S','S'];

const STATUS_COLORS: Record<string, string> = {
  tentative: '#F59E0B', confirmed: '#3B82F6', checked_in: '#10B981', checked_out: '#9CA3AF', cancelled: '#EF4444',
};

type CalView = 'timeline' | 'property';

function getSuburbs(props: Property[]): string[] {
  const s = new Set<string>(); props.forEach(p => { if (p.suburb) s.add(p.suburb); }); return Array.from(s).sort();
}
function getBedroomOptions(props: Property[]): number[] {
  const s = new Set<number>(); props.forEach(p => { if (p.bedrooms && p.bedrooms > 0) s.add(p.bedrooms); }); return Array.from(s).sort((a, b) => b - a);
}

export default function BookingCalendarPage() {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();
  const location = useLocation();

  const [properties, setProperties] = useState<Property[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CalView>('timeline');
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSuburb, setFilterSuburb] = useState('');
  const [filterBedrooms, setFilterBedrooms] = useState('');
  const [filterAvailFrom, setFilterAvailFrom] = useState('');
  const [filterAvailTo, setFilterAvailTo] = useState('');

  // Property view
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingBooking, setEditingBooking] = useState<any | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  useEffect(() => { setPageTitle('Calendar'); }, [setPageTitle]);

  // Enquiry conversion
  useEffect(() => {
    const state = location.state as { fromEnquiry?: Record<string, unknown> } | null;
    if (state?.fromEnquiry) {
      const enq = state.fromEnquiry;
      setEditingBooking({
        _fromEnquiry: true, enquiry_id: enq.id,
        guest_name: enq.client_name || '', guest_email: enq.client_email || '',
        guest_phone: enq.client_phone || '', guest_nationality: enq.nationality || '',
        guests_total: enq.guests_total || 1, guests_adults: enq.guests_adults || null,
        guests_children: enq.guests_children || null,
        check_in: enq.check_in || '', check_out: enq.check_out || '',
        property_id: enq.assigned_property_id || '', notes: enq.notes || '',
      });
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  async function loadData() {
    setLoading(true);
    try {
      const rangeStart = toDateStr(addDays(startOfMonth(currentMonth), -14));
      const rangeEnd = toDateStr(addDays(endOfMonth(currentMonth), 400));
      const [propRes, bookRes] = await Promise.all([
        supabase.from('partner_properties').select('id, property_name, bedrooms, suburb').eq('partner_id', CT_RENTALS_PARTNER_ID).order('bedrooms', { ascending: false }),
        supabase.from('bookings').select('*').eq('partner_id', CT_RENTALS_PARTNER_ID).gte('check_out', rangeStart).lte('check_in', rangeEnd),
      ]);
      if (propRes.data) setProperties(propRes.data as Property[]);
      if (bookRes.data) setBookings(bookRes.data as Booking[]);
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  useEffect(() => { if (supabase) loadData(); }, [supabase, currentMonth]);

  const suburbs = useMemo(() => getSuburbs(properties), [properties]);
  const bedroomOptions = useMemo(() => getBedroomOptions(properties), [properties]);
  const today = new Date();

  const hasDateFilter = !!(filterAvailFrom && filterAvailTo && filterAvailTo > filterAvailFrom);

  function isPropertyAvailable(pid: string, from: string, to: string): boolean {
    return !bookings.some(b => b.property_id === pid && b.status !== 'cancelled' && b.check_in < to && b.check_out > from);
  }

  function getBookingsForProperty(pid: string): Booking[] {
    return bookings.filter(b => b.property_id === pid && b.status !== 'cancelled');
  }

  const filteredProperties = useMemo(() => {
    let result = properties;
    if (searchQuery) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter(p => terms.every(t => [p.property_name, p.suburb].filter(Boolean).join(' ').toLowerCase().includes(t)));
    }
    if (filterSuburb) result = result.filter(p => p.suburb === filterSuburb);
    if (filterBedrooms) result = result.filter(p => p.bedrooms === Number(filterBedrooms));
    if (hasDateFilter) result = result.filter(p => isPropertyAvailable(p.id, filterAvailFrom, filterAvailTo));
    return result;
  }, [properties, searchQuery, filterSuburb, filterBedrooms, filterAvailFrom, filterAvailTo, bookings, hasDateFilter]);

  // Month timeline data
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = daysBetween(monthStart, monthEnd) + 1;

  function prevMonth() { setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)); }
  function nextMonth() { setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)); }
  function goToday() { const n = new Date(); setCurrentMonth(new Date(n.getFullYear(), n.getMonth(), 1)); }

  const hasActiveFilters = !!(searchQuery || filterSuburb || filterBedrooms || hasDateFilter);
  function clearFilters() { setSearchQuery(''); setFilterSuburb(''); setFilterBedrooms(''); setFilterAvailFrom(''); setFilterAvailTo(''); }

  // Property view helpers
  const selectedProperty = properties.find(p => p.id === selectedPropertyId);
  const propertyMonths = useMemo(() => {
    const m: Date[] = [];
    for (let i = 0; i < 12; i++) m.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + i, 1));
    return m;
  }, [currentMonth]);

  function isDateBooked(pid: string, date: Date): Booking | null {
    const ds = toDateStr(date);
    for (const b of bookings) { if (b.property_id === pid && b.status !== 'cancelled' && ds >= b.check_in && ds < b.check_out) return b; }
    return null;
  }

  if (loading && properties.length === 0) return <div className="page-loader"><div className="spinner" /></div>;

  // ── Render a booking bar for the month timeline ──
  function renderMonthBar(booking: Booking) {
    const bStart = new Date(booking.check_in);
    const bEnd = new Date(booking.check_out);
    const visStart = bStart < monthStart ? monthStart : bStart;
    const visEnd = bEnd > addDays(monthEnd, 1) ? addDays(monthEnd, 1) : bEnd;
    const startPct = ((daysBetween(monthStart, visStart)) / daysInMonth) * 100;
    const widthPct = ((daysBetween(visStart, visEnd)) / daysInMonth) * 100;
    if (widthPct <= 0) return null;

    return (
      <div
        key={booking.id}
        className="tl-bar"
        style={{ left: `${startPct}%`, width: `${widthPct}%`, backgroundColor: STATUS_COLORS[booking.status] }}
        onClick={(e) => { e.stopPropagation(); setSelectedBooking(booking); }}
        title={`${booking.guest_name}\n${fmtShort(bStart)} → ${fmtShort(bEnd)}`}
      >
        <span className="tl-bar-text">{booking.guest_name}</span>
        <span className="tl-bar-dates">{fmtShort(bStart)} – {fmtShort(bEnd)}</span>
      </div>
    );
  }

  // ── Render a booking bar for the availability results view ──
  function renderAvailBar(booking: Booking, rangeStart: Date, rangeDays: number) {
    const bStart = new Date(booking.check_in);
    const bEnd = new Date(booking.check_out);
    const visStart = bStart < rangeStart ? rangeStart : bStart;
    const rangeEnd = addDays(rangeStart, rangeDays);
    const visEnd = bEnd > rangeEnd ? rangeEnd : bEnd;
    const startPct = (daysBetween(rangeStart, visStart) / rangeDays) * 100;
    const widthPct = (daysBetween(visStart, visEnd) / rangeDays) * 100;
    if (widthPct <= 0) return null;

    return (
      <div
        key={booking.id}
        className="tl-bar"
        style={{ left: `${startPct}%`, width: `${widthPct}%`, backgroundColor: STATUS_COLORS[booking.status] }}
        onClick={(e) => { e.stopPropagation(); setSelectedBooking(booking); }}
      >
        <span className="tl-bar-text">{booking.guest_name}</span>
        <span className="tl-bar-dates">{fmtShort(bStart)} – {fmtShort(bEnd)}</span>
      </div>
    );
  }

  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="card" style={{ marginBottom: '12px' }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            {!hasDateFilter && (
              <>
                <button className="btn btn-ghost" onClick={prevMonth}>←</button>
                <button className="btn btn-ghost" onClick={goToday}>Today</button>
                <button className="btn btn-ghost" onClick={nextMonth}>→</button>
                <span style={{ fontWeight: 600, fontSize: '1.05rem', marginLeft: '4px' }}>
                  {MONTH_NAMES_FULL[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                </span>
              </>
            )}
            {hasDateFilter && (
              <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>
                Availability: {fmtFull(new Date(filterAvailFrom))} — {fmtFull(new Date(filterAvailTo))}
              </span>
            )}
          </div>
          <div className="list-toolbar-right">
            <div className="view-toggle">
              <button className={`view-toggle-btn ${view === 'timeline' ? 'active' : ''}`} onClick={() => setView('timeline')}>Timeline</button>
              <button className={`view-toggle-btn ${view === 'property' ? 'active' : ''}`} onClick={() => setView('property')}>Property</button>
            </div>
            <button className="btn btn-primary" onClick={() => setEditingBooking({})}>+ New Booking</button>
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="card" style={{ marginBottom: '12px' }}>
        <div className="cal-filters">
          <div className="cal-filters-row">
            <div className="list-search" style={{ maxWidth: '220px' }}>
              <span className="list-search-icon">🔍</span>
              <input type="text" placeholder="Search properties..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              {searchQuery && <button className="list-search-clear" onClick={() => setSearchQuery('')}>✕</button>}
            </div>
            <select className="list-filter" value={filterSuburb} onChange={(e) => setFilterSuburb(e.target.value)}>
              <option value="">All Suburbs</option>
              {suburbs.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="list-filter" value={filterBedrooms} onChange={(e) => setFilterBedrooms(e.target.value)}>
              <option value="">All Bedrooms</option>
              {bedroomOptions.map(n => <option key={n} value={String(n)}>{n} bed{n !== 1 ? 's' : ''}</option>)}
            </select>
            <div className="cal-avail-filter">
              <span className="cal-avail-label">Available:</span>
              <DateInput className="cal-avail-input" value={filterAvailFrom} onChange={setFilterAvailFrom} placeholder="e.g. 27 Mar 2026" />
              <span className="cal-avail-label">to</span>
              <DateInput className="cal-avail-input" value={filterAvailTo} onChange={setFilterAvailTo} placeholder="e.g. 27 May 2026" />
            </div>
            {hasActiveFilters && (
              <button className="btn btn-ghost" onClick={clearFilters} style={{ fontSize: '0.75rem', color: 'var(--error)' }}>✕ Clear</button>
            )}
          </div>
          <div className="cal-filters-meta">
            <span>{filteredProperties.length} of {properties.length} properties</span>
            {hasDateFilter && <span style={{ color: 'var(--success)', fontWeight: 600 }}> — available for your dates</span>}
            <div className="cal-legend" style={{ marginLeft: 'auto' }}>
              {Object.entries(BOOKING_STATUS_CONFIG).filter(([k]) => k !== 'cancelled').map(([key, cfg]) => (
                <span key={key} className="cal-legend-item"><span className="cal-legend-dot" style={{ background: STATUS_COLORS[key] }} />{cfg.label}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════
          TIMELINE VIEW
         ════════════════════════════════════════════ */}
      {view === 'timeline' && !hasDateFilter && (
        <div className="card">
          {/* Month scale bar */}
          <div className="tl-scale">
            <div className="tl-scale-property">Property</div>
            <div className="tl-scale-dates">
              {Array.from({ length: daysInMonth }, (_, i) => {
                const d = addDays(monthStart, i);
                const t = isSameDay(d, today);
                const we = isWeekend(d);
                return (
                  <div key={i} className={`tl-scale-day ${t ? 'tl-scale-today' : ''} ${we ? 'tl-scale-weekend' : ''}`}>
                    {d.getDate()}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Property rows */}
          {filteredProperties.length === 0 ? (
            <div className="empty-state"><p className="empty-state-message">{hasActiveFilters ? 'No properties match your filters.' : 'No properties.'}</p></div>
          ) : (
            filteredProperties.map(property => {
              const propBookings = getBookingsForProperty(property.id);
              return (
                <div key={property.id} className="tl-row" onClick={() => { setView('property'); setSelectedPropertyId(property.id); }}>
                  <div className="tl-row-property">
                    <span className="tl-row-name">{property.property_name}</span>
                    <span className="tl-row-meta">{property.bedrooms ? `${property.bedrooms} bed` : ''}{property.suburb ? ` · ${property.suburb}` : ''}</span>
                  </div>
                  <div className="tl-row-bars">
                    {propBookings.length === 0 && <span className="tl-row-free">Available all month</span>}
                    {propBookings.map(b => renderMonthBar(b))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════
          DATE RANGE RESULTS (when filter is active)
         ════════════════════════════════════════════ */}
      {view === 'timeline' && hasDateFilter && (
        <div>
          {filteredProperties.length === 0 ? (
            <div className="card"><div className="empty-state" style={{ padding: '40px' }}>
              <p style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '4px' }}>No properties available</p>
              <p className="empty-state-message">All properties are booked for {fmtShort(new Date(filterAvailFrom))} – {fmtShort(new Date(filterAvailTo))}. Try different dates or fewer bedrooms.</p>
            </div></div>
          ) : (
            filteredProperties.map(property => {
              // Show bookings in a window around the filtered range for context
              const windowStart = addDays(new Date(filterAvailFrom), -14);
              const windowEnd = addDays(new Date(filterAvailTo), 14);
              const windowDays = daysBetween(windowStart, windowEnd);
              const nearbyBookings = bookings.filter(b =>
                b.property_id === property.id && b.status !== 'cancelled' &&
                b.check_in < toDateStr(windowEnd) && b.check_out > toDateStr(windowStart)
              ).sort((a, b) => a.check_in.localeCompare(b.check_in));

              const requestedStartPct = (daysBetween(windowStart, new Date(filterAvailFrom)) / windowDays) * 100;
              const requestedWidthPct = (daysBetween(new Date(filterAvailFrom), new Date(filterAvailTo)) / windowDays) * 100;

              return (
                <div key={property.id} className="card avail-card" onClick={() => { setView('property'); setSelectedPropertyId(property.id); }}>
                  <div className="avail-card-header">
                    <div>
                      <span className="avail-card-name">{property.property_name}</span>
                      <span className="avail-card-meta">{property.bedrooms ? `${property.bedrooms} bedrooms` : ''}{property.suburb ? ` · ${property.suburb}` : ''}</span>
                    </div>
                    <div className="avail-card-actions">
                      <span className="avail-badge">Available</span>
                      <button className="btn btn-primary" style={{ fontSize: '0.75rem' }} onClick={(e) => {
                        e.stopPropagation();
                        setEditingBooking({ property_id: property.id, check_in: filterAvailFrom, check_out: filterAvailTo });
                      }}>Book Now</button>
                    </div>
                  </div>
                  <div className="avail-card-bar-container">
                    {/* Date labels */}
                    <div className="avail-card-dates">
                      <span>{fmtShort(windowStart)}</span>
                      <span>{fmtShort(windowEnd)}</span>
                    </div>
                    {/* Bar track */}
                    <div className="avail-card-track">
                      {/* Requested range highlight */}
                      <div className="avail-card-requested" style={{ left: `${requestedStartPct}%`, width: `${requestedWidthPct}%` }} />
                      {/* Booking bars */}
                      {nearbyBookings.map(b => renderAvailBar(b, windowStart, windowDays))}
                    </div>
                    {/* Requested range label */}
                    <div className="avail-card-range-label" style={{ left: `${requestedStartPct}%`, width: `${requestedWidthPct}%` }}>
                      Your dates
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════
          PROPERTY VIEW
         ════════════════════════════════════════════ */}
      {view === 'property' && (
        <div>
          {!selectedPropertyId && (
            <div className="card">
              <div className="pv-property-list">
                {filteredProperties.map(p => {
                  const ct = getBookingsForProperty(p.id).length;
                  return (
                    <div key={p.id} className="pv-property-item" onClick={() => setSelectedPropertyId(p.id)}>
                      <div className="pv-property-item-left">
                        <span className="pv-property-name">{p.property_name}</span>
                        <span className="pv-property-meta">{p.bedrooms ? `${p.bedrooms} bed` : ''}{p.suburb ? ` · ${p.suburb}` : ''}</span>
                      </div>
                      <div className="pv-property-item-right">
                        {ct > 0 ? <span className="pv-booking-count">{ct} booking{ct !== 1 ? 's' : ''}</span> : <span className="pv-available-tag">Available</span>}
                      </div>
                    </div>
                  );
                })}
                {filteredProperties.length === 0 && <div className="empty-state"><p className="empty-state-message">No properties match your filters.</p></div>}
              </div>
            </div>
          )}

          {selectedProperty && (
            <div className="card">
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button className="btn btn-ghost" onClick={() => setSelectedPropertyId(null)}>← Back</button>
                  <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{selectedProperty.property_name}</h3>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                      {selectedProperty.bedrooms ? `${selectedProperty.bedrooms} bedrooms` : ''}{selectedProperty.suburb ? ` · ${selectedProperty.suburb}` : ''}
                    </p>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={() => setEditingBooking({ property_id: selectedProperty.id })}>+ Book This Property</button>
              </div>
              <div className="pv-months-grid">
                {propertyMonths.map(month => {
                  const mFirst = startOfMonth(month);
                  let dow = mFirst.getDay(); dow = dow === 0 ? 6 : dow - 1;
                  const gridStart = addDays(mFirst, -dow);
                  const miniWeeks: Date[][] = [];
                  let cur = new Date(gridStart);
                  for (let w = 0; w < 6; w++) {
                    const wk: Date[] = [];
                    for (let d = 0; d < 7; d++) { wk.push(new Date(cur)); cur = addDays(cur, 1); }
                    if (wk[0].getMonth() === month.getMonth() || wk[6].getMonth() === month.getMonth()) miniWeeks.push(wk);
                  }
                  return (
                    <div key={month.toISOString()} className="pv-mini-month">
                      <div className="pv-mini-month-title">{MONTH_NAMES_FULL[month.getMonth()]} {month.getFullYear()}</div>
                      <div className="pv-mini-header">{DAY_LABELS_MINI.map((d, i) => <div key={i} className="pv-mini-header-cell">{d}</div>)}</div>
                      {miniWeeks.map((wk, wi) => (
                        <div key={wi} className="pv-mini-week">
                          {wk.map((day, di) => {
                            const inMonth = day.getMonth() === month.getMonth();
                            const isT = isSameDay(day, today);
                            const bk = inMonth ? isDateBooked(selectedProperty.id, day) : null;
                            return (
                              <div key={di}
                                className={`pv-mini-cell ${!inMonth ? 'pv-mini-cell--other' : ''} ${isT ? 'pv-mini-cell--today' : ''} ${bk ? 'pv-mini-cell--booked' : inMonth ? 'pv-mini-cell--free' : ''}`}
                                style={bk ? { backgroundColor: STATUS_COLORS[bk.status] + '25', borderColor: STATUS_COLORS[bk.status] } : undefined}
                                title={bk ? `${bk.guest_name} (${BOOKING_STATUS_CONFIG[bk.status]?.label})` : inMonth ? 'Available' : ''}
                                onClick={() => { if (!inMonth) return; if (bk) setSelectedBooking(bk); else setEditingBooking({ property_id: selectedProperty.id, check_in: toDateStr(day), check_out: toDateStr(addDays(day, 7)) }); }}
                              >
                                <span className={isT ? 'pv-today-dot' : ''}>{day.getDate()}</span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              {(() => {
                const upcoming = getBookingsForProperty(selectedProperty.id).filter(b => new Date(b.check_out) >= today).sort((a, b) => a.check_in.localeCompare(b.check_in));
                if (!upcoming.length) return <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-light)', fontSize: '0.8125rem', borderTop: '1px solid var(--border)' }}>No upcoming bookings.</div>;
                return (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    <div style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Upcoming Bookings</div>
                    {upcoming.map(b => (
                      <div key={b.id} className="pv-booking-row" onClick={() => setSelectedBooking(b)}>
                        <div className="pv-booking-color" style={{ backgroundColor: STATUS_COLORS[b.status] }} />
                        <div className="pv-booking-info">
                          <span className="pv-booking-guest">{b.guest_name}</span>
                          <span className="pv-booking-dates">{fmtShort(new Date(b.check_in))} — {fmtFull(new Date(b.check_out))}</span>
                        </div>
                        <span className="status-badge" style={{ background: BOOKING_STATUS_CONFIG[b.status]?.bg, color: BOOKING_STATUS_CONFIG[b.status]?.color }}>{BOOKING_STATUS_CONFIG[b.status]?.label}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── Booking Detail Modal ── */}
      {selectedBooking && (
        <div className="modal-overlay" onClick={() => setSelectedBooking(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{selectedBooking.guest_name}</h2>
              <button className="modal-close" onClick={() => setSelectedBooking(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div><strong>Property:</strong> {properties.find(p => p.id === selectedBooking.property_id)?.property_name || '-'}</div>
                <div><strong>Status:</strong>{' '}<span className="status-badge" style={{ background: BOOKING_STATUS_CONFIG[selectedBooking.status]?.bg, color: BOOKING_STATUS_CONFIG[selectedBooking.status]?.color }}>{BOOKING_STATUS_CONFIG[selectedBooking.status]?.label}</span></div>
                <div><strong>Check In:</strong> {fmtFull(new Date(selectedBooking.check_in))}</div>
                <div><strong>Check Out:</strong> {fmtFull(new Date(selectedBooking.check_out))}</div>
                <div><strong>Guests:</strong> {selectedBooking.guests_total}</div>
                <div><strong>Platform:</strong> {selectedBooking.platform || '-'}</div>
                <div><strong>Email:</strong> {selectedBooking.guest_email || '-'}</div>
                <div><strong>Phone:</strong> {selectedBooking.guest_phone || '-'}</div>
                {selectedBooking.total_amount && <div><strong>Total:</strong> {selectedBooking.currency} {Number(selectedBooking.total_amount).toLocaleString()}</div>}
                {selectedBooking.balance_due && <div><strong>Balance:</strong> {selectedBooking.currency} {Number(selectedBooking.balance_due).toLocaleString()}</div>}
                {selectedBooking.manager && <div><strong>Manager:</strong> {selectedBooking.manager}</div>}
              </div>
              {selectedBooking.notes && <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '6px', marginBottom: '1rem' }}><strong>Notes:</strong><p style={{ margin: '0.25rem 0 0' }}>{selectedBooking.notes}</p></div>}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                <strong>Change Status:</strong>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  {Object.entries(BOOKING_STATUS_CONFIG).map(([key, cfg]) => (
                    <button key={key} className={`btn ${selectedBooking.status === key ? 'btn-primary' : 'btn-outline'}`} style={{ fontSize: '0.75rem' }}
                      onClick={async () => { await supabase.from('bookings').update({ status: key, updated_at: new Date().toISOString() }).eq('id', selectedBooking.id); setSelectedBooking({ ...selectedBooking, status: key as Booking['status'] }); loadData(); }}>{cfg.label}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setSelectedBooking(null); setEditingBooking(selectedBooking); }}>✏️ Edit</button>
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={() => setSelectedBooking(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Booking Modal ── */}
      {editingBooking && (
        <BookingModal booking={editingBooking} properties={properties}
          onClose={() => setEditingBooking(null)}
          onSave={async (enquiryId?: string) => {
            setEditingBooking(null);
            if (enquiryId) await supabase.from('enquiries').update({ status: 'booked', updated_at: new Date().toISOString() }).eq('id', enquiryId);
            await loadData();
          }}
          supabase={supabase} user={user} partnerId={CT_RENTALS_PARTNER_ID}
        />
      )}
    </div>
  );
}
