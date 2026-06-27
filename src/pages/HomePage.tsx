/**
 * HomePage — the command-center dashboard.
 *
 * One screen to understand the day and act on it:
 *   - Quick actions: the most common entry points (new enquiry / booking /
 *     brochure / price list).
 *   - KPI strip: live counts (overdue, due today, arrivals, departures,
 *     proposals to close). Each chip jumps to the relevant section.
 *   - Two columns:
 *       LEFT  — Actions due: the management-email queue you work from
 *               (tabbed by urgency, filterable by audience). See
 *               <ActionsDueSection>.
 *       RIGHT — Today (arrivals / in-house / departures) + Proposals to
 *               close, as compact context.
 *
 * Uses only shared design-system classes (.card, .btn variants,
 * .detail-modal-section-heading, .list-filter-select) and design tokens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { CT_RENTALS_PARTNER_ID } from './constants';
import SendBrochurePicker from '../components/SendBrochurePicker';
import BookingModal from './BookingModal';
import ActionsDueSection, { type ActionsBucket, type ActionsCounts } from '../components/ActionsDueSection';

interface TodayBookingRow {
  id: string;
  property_id: string;
  property_name: string | null;
  guest_name: string | null;
  check_in: string;
  check_out: string;
}

/** A deal sitting in the Responded column on the enquiries board that still
 *  has at least one proposal awaiting a final outcome. Surfaced on the
 *  dashboard so the chase queue is visible without leaving the page. */
interface ToCloseRow {
  enquiry_id: string;
  ref_code: string | null;
  display_name: string;
  is_agent: boolean;
  agent_guest_name: string | null;
  property_summary: string | null;
  to_close_count: number;
  days_since: number;
}

const CLOSED_PROPOSAL_STATUSES = new Set([
  'declined', 'accepted', 'booked', 'cancelled', 'expired', 'archived',
]);
const OPEN_SENT_STATUSES = new Set(['sent', 'viewed', 'interested']);
const WON_PROPOSAL_STATUSES = new Set(['accepted', 'booked']);

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

/** Responsive helper — true under the breakpoint, so the two-column command
 *  center collapses to a single column on laptops / tablets. Kept in JS so we
 *  don't add a page-specific CSS class. */
function useIsNarrow(maxWidth = 1024): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width:${maxWidth}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${maxWidth}px)`);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [maxWidth]);
  return narrow;
}

export default function HomePage() {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();
  const navigate = useNavigate();
  const narrow = useIsNarrow(1024);

  const [brochurePickerOpen, setBrochurePickerOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingProperties, setBookingProperties] = useState<any[]>([]);

  const [todayBookings, setTodayBookings] = useState<TodayBookingRow[]>([]);
  const [todayLoading, setTodayLoading] = useState(true);

  const [toClose, setToClose] = useState<ToCloseRow[]>([]);
  const [toCloseLoading, setToCloseLoading] = useState(true);

  // Actions-due bucket tab + counts are lifted here so the KPI chips can both
  // display the counts and switch the active tab.
  const [actionsTab, setActionsTab] = useState<ActionsBucket>('overdue');
  const [actionsCounts, setActionsCounts] = useState<ActionsCounts>({ overdue: 0, today: 0, this_week: 0, total: 0 });
  const didInitTab = useRef(false);
  const handleActionsCounts = useCallback((c: ActionsCounts) => {
    setActionsCounts(c);
    // On the first non-empty load, land on the most urgent non-empty bucket
    // (overdue → today → this week) so the user opens on real work.
    if (!didInitTab.current && c.total > 0) {
      didInitTab.current = true;
      setActionsTab(c.overdue > 0 ? 'overdue' : c.today > 0 ? 'today' : 'this_week');
    }
  }, []);

  const todayRef = useRef<HTMLDivElement | null>(null);
  const proposalsRef = useRef<HTMLDivElement | null>(null);
  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const todayIso = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }, []);

  // Bookings touching today — arrivals (check_in === today), departures
  // (check_out === today), in-stay (between). One query, bucketed client-side.
  // Cancelled bookings + blocks are excluded; this is real guest movement.
  // try/finally guarantees the loading flag always clears, even if the query
  // rejects (the previous version could hang on "Loading…" forever).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setTodayLoading(true);
    (async () => {
      try {
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
      } catch (err) {
        if (!cancelled) {
          console.error('HomePage today fetch threw:', err);
          setTodayBookings([]);
        }
      } finally {
        if (!cancelled) setTodayLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, todayIso]);

  // Responded deals with ≥1 proposal still out with the guest and none won.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setToCloseLoading(true);
    (async () => {
      try {
        const lookbackIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from('enquiries')
          .select(`
            id, ref_code, client_name, guest_name, is_agent,
            check_out, deal_status, archived_at, created_at,
            proposals(id, status, partner_properties(property_name))
          `)
          .eq('partner_id', CT_RENTALS_PARTNER_ID)
          .is('archived_at', null)
          .or('deal_status.is.null,deal_status.not.in.(won,lost)')
          .gte('created_at', lookbackIso)
          .order('created_at', { ascending: false })
          .limit(400);
        if (cancelled) return;
        if (error) {
          console.error('HomePage to-close fetch failed:', error);
          setToClose([]);
          return;
        }
        const now = Date.now();
        const rows: ToCloseRow[] = (data || [])
          .map((e: any): ToCloseRow | null => {
            if (e.check_out && e.check_out < todayIso) return null;
            const props = (e.proposals || []) as Array<{
              id: string; status: string;
              partner_properties: { property_name: string } | null;
            }>;
            if (props.some(p => WON_PROPOSAL_STATUSES.has(p.status))) return null;
            const open = props.filter(p => !CLOSED_PROPOSAL_STATUSES.has(p.status));
            if (open.length === 0) return null;
            if (!props.some(p => OPEN_SENT_STATUSES.has(p.status))) return null;
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
      } catch (err) {
        if (!cancelled) {
          console.error('HomePage to-close fetch threw:', err);
          setToClose([]);
        }
      } finally {
        if (!cancelled) setToCloseLoading(false);
      }
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

  const toCloseTotal = useMemo(() => toClose.reduce((sum, r) => sum + r.to_close_count, 0), [toClose]);

  // Greeting in the page chrome.
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Quick actions — slim row of the common entry points. */}
      <div className="card" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="detail-modal-section-heading" style={{ margin: 0 }}>Quick actions</span>
          <button className="btn btn-primary" onClick={() => navigate('/enquiry/new')}>💬 New enquiry</button>
          <button className="btn btn-outline" onClick={openBooking}>📅 New booking</button>
          <button className="btn btn-outline" onClick={() => setBrochurePickerOpen(true)}>📄 Send brochure</button>
          <button className="btn btn-outline" onClick={() => navigate('/price-list')}>💷 Price list</button>
        </div>
      </div>

      {/* KPI strip — live, clickable counts. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 10 }}>
        <KpiChip label="Overdue" value={actionsCounts.overdue} tone="error"
          onClick={() => setActionsTab('overdue')} />
        <KpiChip label="Due today" value={actionsCounts.today} tone="warning"
          onClick={() => setActionsTab('today')} />
        <KpiChip label="Arrivals" value={arrivals.length} tone="success"
          loading={todayLoading} onClick={() => scrollTo(todayRef)} />
        <KpiChip label="Departures" value={departures.length} tone="info"
          loading={todayLoading} onClick={() => scrollTo(todayRef)} />
        <KpiChip label="To close" value={toCloseTotal} tone="neutral"
          loading={toCloseLoading} onClick={() => scrollTo(proposalsRef)} />
      </div>

      {/* Command center: work column (left) + context column (right). */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1.7fr) minmax(0, 1fr)',
        gap: 16,
        alignItems: 'start',
      }}>
        {/* LEFT — the queue you act from. */}
        <ActionsDueSection tab={actionsTab} onTabChange={setActionsTab} onCounts={handleActionsCounts} />

        {/* RIGHT — today's movement + proposals chase queue. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* Today */}
          <div ref={todayRef} className="card" style={{ padding: 18 }}>
            <div className="detail-modal-section-heading" style={{ marginBottom: 12 }}>Today</div>
            {todayLoading ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Loading…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <TodayRow icon="🛬" label="Arrivals" fg="var(--success)" bg="var(--success-bg)"
                  bookings={arrivals} onOpen={() => navigate('/operations/bookings?view=list')} />
                <TodayRow icon="🛏" label="In house" fg="var(--info)" bg="var(--info-bg)"
                  bookings={inStay} onOpen={() => navigate('/operations/bookings?view=list')} />
                <TodayRow icon="🛫" label="Departures" fg="var(--warning)" bg="var(--warning-bg)"
                  bookings={departures} onOpen={() => navigate('/operations/bookings?view=list')} />
              </div>
            )}
          </div>

          {/* Proposals to close */}
          <div ref={proposalsRef} className="card" style={{ padding: 18 }}>
            <div className="detail-modal-section-heading" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Proposals to close</span>
              {!toCloseLoading && toCloseTotal > 0 && (
                <span style={{
                  display: 'inline-block', padding: '2px 10px', borderRadius: 12,
                  fontSize: '0.75rem', fontWeight: 700,
                  background: 'var(--warning-bg)', color: 'var(--warning)',
                }}>
                  {toCloseTotal}
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
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {toClose.slice(0, 6).map(r => (
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
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      background: 'var(--surface)',
                    }}
                  >
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 26, height: 22, padding: '0 7px', borderRadius: 12,
                      fontSize: '0.75rem', fontWeight: 700,
                      background: 'var(--warning-bg)', color: 'var(--warning)',
                      flexShrink: 0,
                    }} title={`${r.to_close_count} proposal${r.to_close_count === 1 ? '' : 's'} awaiting a final outcome`}>
                      {r.to_close_count}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.875rem', color: 'var(--text)', fontWeight: 600,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {r.is_agent && '🤝 '}
                        {titleCase(r.display_name)}
                        {r.ref_code && (
                          <span style={{ color: 'var(--text-light)', fontWeight: 400, marginLeft: 6, fontSize: '0.75rem' }}>
                            · {r.ref_code}
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: '0.75rem', color: 'var(--text-secondary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {r.is_agent && r.agent_guest_name
                          ? <>Guest: {titleCase(r.agent_guest_name)}</>
                          : r.is_agent
                          ? <em>Guest not disclosed</em>
                          : null}
                        {r.is_agent && r.property_summary && ' · '}
                        {r.property_summary && titleCase(r.property_summary)}
                      </div>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', flexShrink: 0 }}>
                      {r.days_since < 1 ? 'today' : r.days_since === 1 ? '1d' : `${r.days_since}d`}
                    </span>
                  </li>
                ))}
                {toClose.length > 6 && (
                  <li
                    style={{
                      fontSize: '0.8125rem', color: 'var(--color-primary)', fontWeight: 600,
                      cursor: 'pointer', padding: '6px 10px',
                    }}
                    onClick={() => navigate('/operations/enquiries?stage=sent')}
                  >
                    View all {toClose.length} →
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
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

const KPI_TONE: Record<string, string> = {
  error: 'var(--error)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  info: 'var(--info)',
  neutral: 'var(--color-primary)',
};

function KpiChip({
  label, value, tone, onClick, loading,
}: {
  label: string;
  value: number;
  tone: keyof typeof KPI_TONE | string;
  onClick: () => void;
  loading?: boolean;
}) {
  const fg = KPI_TONE[tone] || 'var(--color-primary)';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        textAlign: 'left', cursor: 'pointer',
        padding: '12px 14px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <span style={{
        fontSize: '1.5rem', fontWeight: 800, lineHeight: 1,
        color: !loading && value > 0 ? fg : 'var(--text)',
      }}>
        {loading ? '—' : value}
      </span>
      <span style={{
        fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05em',
        textTransform: 'uppercase', color: 'var(--text-secondary)',
      }}>
        {label}
      </span>
    </button>
  );
}

function TodayRow({
  icon, label, fg, bg, bookings, onOpen,
}: {
  icon: string;
  label: string;
  fg: string;
  bg: string;
  bookings: TodayBookingRow[];
  onOpen: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{ cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.04em',
          textTransform: 'uppercase', color: fg,
        }}>
          {icon} {label}
        </span>
        <span style={{
          display: 'inline-block', padding: '2px 10px', borderRadius: 12,
          fontSize: '0.875rem', fontWeight: 700, background: bg, color: fg,
        }}>
          {bookings.length}
        </span>
      </div>
      {bookings.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {bookings.slice(0, 3).map(b => (
            <li key={b.id} style={{
              fontSize: '0.8125rem', color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              <strong>{titleCase(b.guest_name || '') || '—'}</strong>
              {b.property_name && (
                <span style={{ color: 'var(--text-secondary)' }}> · {titleCase(b.property_name)}</span>
              )}
            </li>
          ))}
          {bookings.length > 3 && (
            <li style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontStyle: 'italic' }}>
              + {bookings.length - 3} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
