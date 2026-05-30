/**
 * AgentPortalPage -- public agent portal at /q/:token
 *
 * Two-tab portal:
 *   - My Enquiries: portfolio reach count + every enquiry this agent
 *     has submitted, plus any proposals the team has published back.
 *     Empty state surfaces the "+ New enquiry" CTA.
 *   - About: Southern Escapes bio + contact cards for Nicki and Hayley.
 *
 * The catalogue grid is intentionally absent — agents used to enquire
 * about unavailable stock and flood the team's board. The form-first
 * flow (AgentPortalEnquiryFlow) shows only available matches scoped to
 * the agent's allow-list, anonymised to CTR codes until the team
 * publishes a proposal.
 *
 * Data comes from the agent-portal-read edge function (one round-trip
 * for agent + properties + enquiries + saved price tiers). Enquiry
 * submission goes through agent-portal-enquire. See agentPortal.ts.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getPortalBundle,
  statusLabel,
  type AgentInfo,
  type AgentProperty,
  type AgentEnquiry,
  type AgentEnquiryStatus,
  type AgentPriceTiers,
  type AgentTierKey,
} from '../lib/agentPortal';

const TIER_LABEL: Record<AgentTierKey, string> = {
  very_low:  'Very low',
  low:       'Low',
  medium:    'Medium',
  high:      'High',
  very_high: 'Very high',
};
import AgentPortalEnquiryFlow from '../components/AgentPortalEnquiryFlow';
import ActionModal from '../components/ActionModal';

type Tab = 'enquiries' | 'about';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

export default function AgentPortalPage() {
  const { token = '' } = useParams<{ token: string }>();

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [properties, setProperties] = useState<AgentProperty[]>([]);
  const [enquiries, setEnquiries] = useState<AgentEnquiry[]>([]);
  const [tierThresholds, setTierThresholds] = useState<AgentPriceTiers | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenError, setTokenError] = useState(false);
  const [tab, setTab] = useState<Tab>('enquiries');
  /** Form-first enquiry flow (filters → anonymised matches → submit).
   *  The only enquiry entry point — the old "browse catalogue → tick →
   *  enquire" path was retired because it let agents enquire about
   *  unavailable stock, flooding the team's board with noise. */
  const [enquiryFlowOpen, setEnquiryFlowOpen] = useState(false);

  async function reload() {
    const bundle = await getPortalBundle(token);
    if (!bundle) {
      setTokenError(true);
      return;
    }
    setAgent(bundle.agent);
    setProperties(bundle.properties);
    setEnquiries(bundle.enquiries);
    setTierThresholds(bundle.priceTiers);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const bundle = await getPortalBundle(token);
      if (cancelled) return;
      if (!bundle) {
        setTokenError(true);
        setLoading(false);
        return;
      }
      setAgent(bundle.agent);
      setProperties(bundle.properties);
      setEnquiries(bundle.enquiries);
      setTierThresholds(bundle.priceTiers);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return <FullScreenMessage message="Loading…" />;
  }

  if (tokenError || !agent) {
    return (
      <FullScreenMessage
        title="Link not valid"
        message="This portal link has either expired or never existed. Please get in touch with Southern Escapes for a fresh link."
      />
    );
  }

  // Headline stats shown under the page header — same visual idea as
  // the admin dashboard's KPI strip but pared down to what matters for
  // an agent (their reach, their activity, what's come back to them).
  const activeProposalCount = enquiries.reduce(
    (n, e) => n + (e.publishedProposals?.length || 0),
    0,
  );

  return (
    <div className="app-layout">
      <AgentSidebar tab={tab} setTab={setTab} enquiryCount={enquiries.length} />
      <main className="main-content">
        <div className="page-header page-header--slot">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s-3)', flexWrap: 'wrap', width: '100%' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, color: 'var(--text)' }}>
                Welcome back, {titleCase(agent.name.split(' ')[0])}
              </h1>
              {agent.agencyName && (
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  {titleCase(agent.agencyName)}
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setEnquiryFlowOpen(true)}
            >
              + New enquiry
            </button>
          </div>
        </div>
        <div className="page-content">
          {tab === 'enquiries' && (
            <EnquiriesTab
              enquiries={enquiries}
              portfolioCount={properties.length}
              activeProposalCount={activeProposalCount}
              onStartEnquiry={() => setEnquiryFlowOpen(true)}
            />
          )}
          {tab === 'about' && <AboutTab />}
          {enquiryFlowOpen && (
            <AgentPortalEnquiryFlow
              token={token}
              tierThresholds={tierThresholds}
              existingSubjects={enquiries
                .map(e => (e.agentReference || '').trim().toLowerCase())
                .filter(Boolean)}
              onClose={() => setEnquiryFlowOpen(false)}
              onSubmitted={async () => {
                setEnquiryFlowOpen(false);
                await reload();
                setTab('enquiries');
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────────
// Reuses the admin portal's `.sidebar` styling so the agent surface
// looks and feels like a real platform — not a one-page enquiry form.
// Active items toggle the in-page tab; the "soon" items are placeholder
// teasers for features on the roadmap (performance dashboard, earnings,
// notifications, marketing tools).

type SidebarItem =
  | { kind: 'tab';  to: Tab; label: string; icon: string; badge?: number }
  | { kind: 'soon'; label: string; icon: string };

function AgentSidebar({ tab, setTab, enquiryCount }: { tab: Tab; setTab: (t: Tab) => void; enquiryCount: number }) {
  const items: SidebarItem[] = [
    { kind: 'tab',  to: 'enquiries', label: 'My Enquiries', icon: '📩', badge: enquiryCount },
    { kind: 'soon',                  label: 'Performance',  icon: '📊' },
    { kind: 'soon',                  label: 'Earnings',     icon: '💰' },
    { kind: 'soon',                  label: 'Notifications',icon: '🔔' },
    { kind: 'soon',                  label: 'Marketing',    icon: '✨' },
    { kind: 'tab',  to: 'about',     label: 'About',        icon: 'ℹ️' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-link" aria-label="Southern Escapes" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <img
            src="/brochure-assets/se-logo-square.png"
            alt="Southern Escapes"
            className="sidebar-brand-logo"
            style={{ height: 32, borderRadius: 4 }}
          />
          <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#fff', letterSpacing: '0.01em' }}>
            Southern Escapes
          </span>
        </span>
      </div>

      <nav className="sidebar-nav">
        {items.map((item, idx) => {
          if (item.kind === 'tab') {
            const isActive = tab === item.to;
            return (
              <button
                key={item.to}
                type="button"
                className={`sidebar-link ${isActive ? 'is-active' : ''}`}
                onClick={() => setTab(item.to)}
              >
                <span className="sidebar-link-icon" aria-hidden>{item.icon}</span>
                <span className="sidebar-link-label">{item.label}</span>
                {item.badge && item.badge > 0 ? (
                  <span style={{
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    background: 'rgba(255,255,255,0.14)',
                    color: 'rgba(255,255,255,0.95)',
                    padding: '1px 6px',
                    borderRadius: 4,
                  }}>{item.badge}</span>
                ) : null}
              </button>
            );
          }
          return (
            <button
              key={`soon-${idx}`}
              type="button"
              className="sidebar-link is-soon"
              title="Coming soon — your roadmap for this portal"
              onClick={() => { /* placeholder */ }}
            >
              <span className="sidebar-link-icon" aria-hidden>{item.icon}</span>
              <span className="sidebar-link-label">{item.label}</span>
              <span className="sidebar-soon-tag">Soon</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user" title="Curated short-let homes, Cape Town">
          Curated short-let homes, Cape Town
        </div>
      </div>
    </aside>
  );
}

// ── About tab ───────────────────────────────────────────────────────

function AboutTab() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--s-5)' }}>
      <section className="card" style={aboutSectionStyle}>
        <h2 style={aboutHeadingStyle}>About Southern Escapes</h2>
        <p style={aboutBodyStyle}>
          A curated portfolio of premium short-let homes across Cape Town's southern suburbs and beyond. We work with a small number of agencies to bring trusted guests to a hand-picked collection of villas, cottages and family houses. Every property is personally vetted by the team and every booking is supported end-to-end.
        </p>
        <p style={aboutBodyStyle}>
          Website: <a href="https://southernescapes.co.za" target="_blank" rel="noopener noreferrer">southernescapes.co.za</a>
        </p>
      </section>

      <section className="card" style={aboutSectionStyle}>
        <h2 style={aboutHeadingStyle}>Get in touch</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--s-4)' }}>
          <ContactCard
            name="Nicki Trent"
            role="Sales and Bookings"
            whatsappE164="+27835954103"
            whatsappDisplay="083 595 4103"
            email="nicki@capetrentals.com"
          />
          <ContactCard
            name="Hayley Harrod"
            role="Operations & Property Management"
            whatsappE164="+27834157779"
            whatsappDisplay="083 415 7779"
            email="hayley@capetrentals.com"
          />
        </div>
      </section>
    </div>
  );
}

function ContactCard({ name, role, whatsappE164, whatsappDisplay, email }: {
  name: string;
  role: string;
  whatsappE164: string;       // for wa.me link (digits only, with country code)
  whatsappDisplay: string;    // formatted for reading
  email: string;
}) {
  // Strip the leading + and any non-digits for the wa.me URL.
  const waDigits = whatsappE164.replace(/[^0-9]/g, '');
  return (
    <div style={contactCardStyle}>
      <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
        {name}
      </div>
      <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 'var(--s-3)' }}>
        {role}
      </div>
      <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
        <a
          className="btn btn-whatsapp"
          style={{ flex: 1, textAlign: 'center' }}
          href={`https://wa.me/${waDigits}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`WhatsApp ${whatsappDisplay}`}
        >
          WhatsApp
        </a>
        <a
          className="btn btn-primary"
          style={{ flex: 1, textAlign: 'center' }}
          href={`mailto:${email}`}
          title={email}
        >
          Email
        </a>
      </div>
    </div>
  );
}

// ── Enquiries tab ───────────────────────────────────────────────────

function EnquiriesTab({
  enquiries,
  portfolioCount,
  activeProposalCount,
  onStartEnquiry,
}: {
  enquiries: AgentEnquiry[];
  /** How many houses the agent has been assigned. Surfaced as a
   *  small reach signal at the top of the tab — the agent never
   *  sees which houses, only how many are in their portfolio. */
  portfolioCount: number;
  /** Count of proposals Southern Escapes has published back to this
   *  agent across all of their enquiries. */
  activeProposalCount: number;
  onStartEnquiry: () => void;
}) {
  const stats = (
    <div style={statsRowStyle}>
      <StatTile label="Houses in portfolio" value={portfolioCount} />
      <StatTile label="Enquiries"           value={enquiries.length} />
      <StatTile label="Proposals received"  value={activeProposalCount} />
    </div>
  );

  if (enquiries.length === 0) {
    return (
      <>
        {stats}
        <div className="card" style={emptyStateStyle}>
          <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--s-2)' }}>
            No enquiries yet
          </div>
          <p style={{ marginBottom: 'var(--s-4)', fontSize: '0.875rem' }}>
            Tap <strong>+ New enquiry</strong> to brief us. We'll match it to your portfolio and come back with a proposal.
          </p>
          <button type="button" className="btn btn-primary" onClick={onStartEnquiry}>
            + New enquiry
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      {stats}
      <div style={sectionHeadingStyle}>
        <span>Recent enquiries</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontWeight: 500 }}>
          {enquiries.length} total
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
        {enquiries.map(e => <EnquiryRow key={e.id} enquiry={e} />)}
      </div>
    </>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={statTileStyle}>
      <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  );
}

/** Lifecycle states that mean "this proposal is no longer open for
 *  the agent to share" — accepted/booked locks the live URL because
 *  the booking is confirmed; declined/cancelled/expired locks it
 *  because the deal is closed. In any of those states the portal
 *  renders a read-only summary modal instead of a click-through link. */
const TERMINAL_PROPOSAL_STATUSES = new Set([
  'accepted', 'booked', 'declined', 'cancelled', 'expired', 'archived',
]);

type PublishedProposal = AgentEnquiry['publishedProposals'][number];

function EnquiryRow({ enquiry }: { enquiry: AgentEnquiry }) {
  // Click → modal. Same pattern as the admin deal modal: a long list
  // of enquiries stays scannable, and a single focused modal renders
  // the rich detail. Inline expansion was tried first but bloats the
  // list once an agent has any volume.
  const [detailOpen, setDetailOpen] = useState(false);
  const requestedProperties = enquiry.requestedProperties ?? [];
  const publishedProposals = enquiry.publishedProposals ?? [];
  const title = enquiry.agentReference?.trim()
    || titleCase(enquiry.guestName)
    || (requestedProperties[0] && titleCase(requestedProperties[0].name))
    || 'Untitled enquiry';
  const propCount = requestedProperties.length;
  const propSummary = propCount === 0
    ? '—'
    : propCount === 1
      ? titleCase(requestedProperties[0].name)
      : `${propCount} properties`;

  const adults = enquiry.guestsAdults ?? 0;
  const children = enquiry.guestsChildren ?? 0;
  const totalGuests = adults + children;
  const guestSummary = totalGuests > 0
    ? `${totalGuests} guest${totalGuests === 1 ? '' : 's'}`
    : '';
  const nights = (enquiry.checkIn && enquiry.checkOut)
    ? Math.max(0, Math.round((new Date(enquiry.checkOut).getTime() - new Date(enquiry.checkIn).getTime()) / 86_400_000))
    : 0;

  return (
    <>
      <div
        className="card"
        style={{ padding: 0, cursor: 'pointer' }}
        onClick={() => setDetailOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailOpen(true); } }}
      >
        <div style={enquiryRowStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
              {title}
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              {enquiry.checkIn} → {enquiry.checkOut}
              {nights > 0 ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}
              {guestSummary ? ` · ${guestSummary}` : ''}
              {propCount > 0 ? ` · ${propSummary}` : ''}
            </div>
          </div>
          <span className={`ops-status-pill ops-status-pill--${pillVariantFor(enquiry.status)}`}>
            <span className="ops-status-pill-dot" />
            {statusLabel(enquiry.status)}
          </span>
          {publishedProposals.length > 0 && (
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--color-primary)',
                background: 'var(--color-primary-bg)',
                padding: '2px 8px',
                borderRadius: 999,
              }}
              title={`${publishedProposals.length} proposal${publishedProposals.length === 1 ? '' : 's'} from Southern Escapes`}
            >
              {publishedProposals.length} proposal{publishedProposals.length === 1 ? '' : 's'}
            </span>
          )}
          <span style={{
            fontSize: '1rem',
            color: 'var(--text-light)',
            marginLeft: 4,
            width: 16,
            textAlign: 'center',
            display: 'inline-block',
          }} aria-hidden>
            ›
          </span>
        </div>
      </div>
      {detailOpen && (
        <EnquiryDetailModal
          enquiry={enquiry}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  );
}

/** Detail view for a single enquiry. Centralises everything the agent
 *  needs to see about their own submission: stay details, matched
 *  properties, guest contact, notes, published proposals (and their
 *  per-proposal earnings breakdown). Mirrors the admin deal modal
 *  pattern so the agent portal feels like part of the same product. */
function EnquiryDetailModal({ enquiry, onClose }: { enquiry: AgentEnquiry; onClose: () => void }) {
  const [summaryProposal, setSummaryProposal] = useState<PublishedProposal | null>(null);
  const requestedProperties = enquiry.requestedProperties ?? [];
  const publishedProposals = enquiry.publishedProposals ?? [];
  const title = enquiry.agentReference?.trim()
    || titleCase(enquiry.guestName)
    || (requestedProperties[0] && titleCase(requestedProperties[0].name))
    || 'Untitled enquiry';
  const adults = enquiry.guestsAdults ?? 0;
  const children = enquiry.guestsChildren ?? 0;
  const totalGuests = adults + children;
  const nights = (enquiry.checkIn && enquiry.checkOut)
    ? Math.max(0, Math.round((new Date(enquiry.checkOut).getTime() - new Date(enquiry.checkIn).getTime()) / 86_400_000))
    : 0;
  const propCount = requestedProperties.length;

  const subtitle = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
      <span className={`ops-status-pill ops-status-pill--${pillVariantFor(enquiry.status)}`}>
        <span className="ops-status-pill-dot" />
        {statusLabel(enquiry.status)}
      </span>
      <span style={{ color: 'var(--text-secondary)' }}>
        {enquiry.checkIn} → {enquiry.checkOut}
        {nights > 0 ? ` · ${nights}n` : ''}
      </span>
    </span>
  );

  return (
    <ActionModal
      title={title}
      subtitle={subtitle}
      width={720}
      onClose={onClose}
      hideFooter
    >
      {publishedProposals.length > 0 && (
        <div style={enquiryExpandedSectionStyle}>
          <div style={enquiryExpandedLabelStyle}>Proposals from Southern Escapes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {publishedProposals.map(p => (
              <PublishedProposalRow
                key={p.refCode}
                proposal={p}
                onSummary={() => setSummaryProposal(p)}
              />
            ))}
          </div>
        </div>
      )}

      <div style={enquiryExpandedSectionStyle}>
        <div style={enquiryExpandedLabelStyle}>Stay details</div>
        <div style={defGridStyle}>
          <DefRow
            label="Dates"
            value={
              <>
                {enquiry.checkIn} → {enquiry.checkOut}
                {nights > 0 ? <span style={{ color: 'var(--text-light)' }}> · {nights} night{nights === 1 ? '' : 's'}</span> : null}
              </>
            }
          />
          <DefRow
            label="Guests"
            value={
              totalGuests > 0
                ? <>{adults} adult{adults === 1 ? '' : 's'}{children > 0 ? ` · ${children} ${children === 1 ? 'child' : 'children'}` : ''}</>
                : '—'
            }
          />
          <DefRow
            label="Nationality"
            value={enquiry.guestNationality ? titleCase(enquiry.guestNationality) : '—'}
          />
          <DefRow
            label="Budget tiers"
            value={
              (enquiry.budgetTiers && enquiry.budgetTiers.length > 0)
                ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {enquiry.budgetTiers.map(t => (
                        <span key={t} style={tierChipStyle}>{TIER_LABEL[t] || t}</span>
                      ))}
                    </div>
                  )
                : '—'
            }
          />
        </div>
      </div>

      {propCount > 0 && (
        <div style={enquiryExpandedSectionStyle}>
          <div style={enquiryExpandedLabelStyle}>Properties matched to your brief</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {requestedProperties.map((p, i) => (
              <span key={p.slug || `${p.name}-${i}`} style={propertyChipStyle}>
                {titleCase(p.name)}
              </span>
            ))}
          </div>
        </div>
      )}

      {(enquiry.guestName || enquiry.guestEmail || enquiry.guestPhone) && (
        <div style={enquiryExpandedSectionStyle}>
          <div style={enquiryExpandedLabelStyle}>Guest contact</div>
          <div style={defGridStyle}>
            {enquiry.guestName  && <DefRow label="Name"  value={titleCase(enquiry.guestName)} />}
            {enquiry.guestEmail && <DefRow label="Email" value={enquiry.guestEmail} />}
            {enquiry.guestPhone && <DefRow label="Phone" value={enquiry.guestPhone} />}
          </div>
        </div>
      )}

      {enquiry.notes && (
        <div style={enquiryExpandedSectionStyle}>
          <div style={enquiryExpandedLabelStyle}>Notes</div>
          <div style={{
            fontSize: '0.875rem',
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
            padding: 'var(--s-3)',
            background: 'var(--bg)',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-sm)',
            lineHeight: 1.5,
          }}>
            {enquiry.notes}
          </div>
        </div>
      )}

      <div style={{
        marginTop: 'var(--s-3)',
        paddingTop: 'var(--s-2)',
        borderTop: '1px solid var(--border-light)',
        display: 'flex',
        justifyContent: 'space-between',
        gap: 'var(--s-3)',
        fontSize: '0.6875rem',
        color: 'var(--text-light)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontWeight: 600,
      }}>
        <span>Submitted {enquiry.submittedAt || '—'}</span>
        {enquiry.lastUpdated && <span>Updated {enquiry.lastUpdated}</span>}
      </div>

      {summaryProposal && (
        <ProposalSummaryModal
          proposal={summaryProposal}
          onClose={() => setSummaryProposal(null)}
        />
      )}
    </ActionModal>
  );
}

/** A single published-proposal row inside the expanded enquiry body.
 *  Splits the trailing action by the proposal's lifecycle:
 *    - terminal (accepted/booked/etc.) → "View summary" → modal
 *    - active   (sent/viewed)          → "View proposal →" → live link
 *  Same visual chrome either way; the difference is what clicking
 *  does. Locking the live URL once accepted/booked stops the agent
 *  from re-sharing a stale link after the booking has been confirmed.
 */
function PublishedProposalRow({ proposal, onSummary }: { proposal: PublishedProposal; onSummary: () => void }) {
  const isTerminal = TERMINAL_PROPOSAL_STATUSES.has(proposal.status);
  // Stop click bubbling so toggling the earnings details doesn't also
  // collapse the parent enquiry row.
  const stop = (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation();

  // Version list + selected index lifted from the earnings card so the
  // View proposal link can include a ?snapshot=<id> param when the
  // agent is viewing a historical version — proposal.html resolves the
  // snapshot id against this proposal's chain to render the historical
  // pricing instead of the current one.
  const versions = useMemo(() => {
    if (proposal.pricingVersions && proposal.pricingVersions.length > 0) return proposal.pricingVersions;
    if (proposal.guestPrice != null && proposal.agentEarningPerNight != null) {
      return [{
        snapshotId: '__live__',
        createdAt: '',
        isCurrent: true,
        guestPrice: proposal.guestPrice,
        ownerNet: proposal.ownerNet,
        southernEscapesPerNight: proposal.southernEscapesPerNight,
        agentEarningPerNight: proposal.agentEarningPerNight,
        agentPct: proposal.agentPct,
      }];
    }
    return [];
  }, [proposal]);
  const currentIdx = Math.max(0, versions.findIndex(v => v.isCurrent));
  const [selectedIdx, setSelectedIdx] = useState(currentIdx);
  useEffect(() => { setSelectedIdx(currentIdx); }, [currentIdx, versions.length]);
  const selected = versions[selectedIdx];

  // Build the View proposal URL — include the snapshot id only when the
  // agent is looking at a historical version, so the public link stays
  // clean for the live case.
  const proposalHref = (() => {
    const base = `/proposal.html?ref=${encodeURIComponent(proposal.refCode)}`;
    if (selected && !selected.isCurrent && selected.snapshotId && selected.snapshotId !== '__live__') {
      return base + `&snapshot=${encodeURIComponent(selected.snapshotId)}`;
    }
    return base;
  })();

  return (
    <div
      onClick={stop}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          gap: 'var(--s-3)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text)' }}>
            {titleCase(proposal.propertyName) || 'Proposal'}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)', fontFamily: 'monospace' }}>
            {proposal.refCode}
            {!isTerminal && proposal.expiresOn ? <> · expires {proposal.expiresOn}</> : null}
          </div>
        </div>
        {isTerminal ? (
          <button
            type="button"
            className="btn btn-outline"
            style={{ fontSize: '0.8125rem' }}
            onClick={(e) => { e.stopPropagation(); onSummary(); }}
            title="Booking is confirmed — open the read-only summary"
          >
            View summary
          </button>
        ) : (
          <a
            className="btn btn-primary"
            style={{ fontSize: '0.8125rem' }}
            href={proposalHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={selected && !selected.isCurrent
              ? 'Opens the proposal page rendered with this historical pricing'
              : undefined}
          >
            View proposal →
          </a>
        )}
      </div>
      <ProposalEarningsCard
        versions={versions}
        selectedIdx={selectedIdx}
        onSelectedIdxChange={setSelectedIdx}
        nights={(proposal.checkIn && proposal.checkOut)
          ? Math.max(0, Math.round((new Date(proposal.checkOut).getTime() - new Date(proposal.checkIn).getTime()) / 86_400_000))
          : 0}
      />
    </div>
  );
}

/** Agent-only earnings breakdown attached to each published proposal.
 *  Full transparency stack: Guest pays / Owner gets / Southern Escapes
 *  commission / Your commission. The proposal page (proposal.html)
 *  deliberately doesn't show this — agents routinely forward that
 *  page on to guests, and we don't want guest-facing pricing to leak
 *  the commission stack. The portal is the agent-only surface where
 *  it's safe.
 *
 *  Hidden entirely when we don't have a pricing snapshot to compute
 *  against — legacy proposals show no card rather than empty rows. */
function ProposalEarningsCard({
  versions,
  selectedIdx,
  onSelectedIdxChange,
  nights,
}: {
  versions: PublishedProposal['pricingVersions'];
  selectedIdx: number;
  onSelectedIdxChange: (idx: number) => void;
  nights: number;
}) {
  const selected = versions[selectedIdx];
  if (!selected || selected.guestPrice == null || selected.agentEarningPerNight == null) {
    return null;
  }

  const rows: Array<{ label: string; perNight: number; highlight?: boolean }> = [
    { label: 'Guest pays',         perNight: selected.guestPrice },
    { label: 'Your commission',    perNight: selected.agentEarningPerNight, highlight: true },
  ];

  return (
    <div style={{
      borderTop: '1px solid var(--border-light)',
      background: 'var(--bg)',
      padding: 'var(--s-3) var(--s-4) var(--s-4)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 'var(--s-2)',
      }}>
        <span style={earningsHeaderLabelStyle}>Pricing breakdown</span>
        {selected.agentPct != null && (
          <span style={commissionBadgeStyle}>
            {Number(selected.agentPct).toFixed(0)}% your commission
          </span>
        )}
      </div>

      {/* Version toggle — only when there's history to flip through.
          The current snapshot is always last in the list (newest at end);
          earlier saves are audit history. */}
      {versions.length > 1 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 'var(--s-2)',
          paddingBottom: 'var(--s-2)',
          borderBottom: '1px dashed var(--border-light)',
        }}>
          <span style={{
            fontSize: '0.625rem',
            fontWeight: 600,
            color: 'var(--text-light)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            alignSelf: 'center',
            marginRight: 4,
          }}>
            Version
          </span>
          {versions.map((v, i) => {
            const active = i === selectedIdx;
            return (
              <button
                key={v.snapshotId || `v${i}`}
                type="button"
                onClick={(e) => { e.stopPropagation(); onSelectedIdxChange(i); }}
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: active ? 'var(--color-primary)' : 'var(--border)',
                  background: active ? 'var(--color-primary)' : 'var(--surface)',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  fontFamily: 'inherit',
                  letterSpacing: '0.02em',
                }}
                title={v.createdAt ? `Saved ${v.createdAt.slice(0, 10)}` : undefined}
              >
                v{i + 1}{v.isCurrent ? ' · current' : ''}
              </button>
            );
          })}
        </div>
      )}

      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <thead>
          <tr>
            <th style={earningsThStyle}></th>
            <th style={{ ...earningsThStyle, textAlign: 'right' }}>Per night</th>
            <th style={{ ...earningsThStyle, textAlign: 'right' }}>
              {nights > 0 ? `Total (${nights}n)` : 'Total'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const total = nights > 0 ? r.perNight * nights : null;
            return (
              <tr key={r.label} style={r.highlight ? earningsHighlightRowStyle : undefined}>
                <td style={{ ...earningsTdStyle, fontWeight: r.highlight ? 700 : 500, color: r.highlight ? 'var(--color-primary)' : 'var(--text)' }}>
                  {r.label}
                </td>
                <td style={{ ...earningsTdStyle, textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  {fmtRand(r.perNight)}
                </td>
                <td style={{ ...earningsTdStyle, textAlign: 'right', fontWeight: r.highlight ? 700 : 600, color: r.highlight ? 'var(--color-primary)' : 'var(--text)' }}>
                  {total != null ? fmtRand(total) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{
        fontSize: '0.6875rem',
        color: 'var(--text-light)',
        marginTop: 'var(--s-3)',
        lineHeight: 1.4,
      }}>
        {selected.isCurrent
          ? 'This proposal is ready to send to your guest.'
          : 'View proposal will open the proposal rendered with this historical pricing.'}
      </div>
    </div>
  );
}

function fmtRand(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`;
}

// ── Earnings card style tokens ──────────────────────────────────────

const earningsHeaderLabelStyle: React.CSSProperties = {
  fontSize: '0.625rem',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const commissionBadgeStyle: React.CSSProperties = {
  fontSize: '0.625rem',
  fontWeight: 700,
  color: 'var(--color-primary)',
  background: 'var(--color-primary-bg)',
  padding: '3px 8px',
  borderRadius: 4,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const earningsThStyle: React.CSSProperties = {
  padding: '4px 0 6px',
  fontSize: '0.625rem',
  fontWeight: 600,
  color: 'var(--text-light)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  borderBottom: '1px solid var(--border-light)',
  textAlign: 'left',
};

const earningsTdStyle: React.CSSProperties = {
  padding: '8px 0',
  fontSize: '0.875rem',
  borderBottom: '1px solid var(--border-light)',
};

const earningsHighlightRowStyle: React.CSSProperties = {
  background: 'rgba(15, 76, 117, 0.05)',
};

/** Read-only summary modal for terminal-state proposals (booked /
 *  accepted / declined / cancelled / expired). Mirrors the level of
 *  detail the live proposal page would surface — property, ref,
 *  status, dates, per-night + per-stay totals — but with no edit
 *  affordances and no "open in new tab" hook out to the live page. */
function ProposalSummaryModal({ proposal, onClose }: { proposal: PublishedProposal; onClose: () => void }) {
  const nights = (proposal.checkIn && proposal.checkOut)
    ? Math.round((new Date(proposal.checkOut).getTime() - new Date(proposal.checkIn).getTime()) / 86_400_000)
    : null;
  const total = (proposal.guestPrice != null && nights != null && nights > 0)
    ? proposal.guestPrice * nights
    : null;
  const statusLabelText = (() => {
    switch (proposal.status) {
      case 'accepted':  return 'Accepted';
      case 'booked':    return 'Booked';
      case 'declined':  return 'Declined';
      case 'cancelled': return 'Cancelled';
      case 'expired':   return 'Expired';
      case 'archived':  return 'Archived';
      default:          return proposal.status || 'Closed';
    }
  })();
  const isWon = proposal.status === 'accepted' || proposal.status === 'booked';

  // Render a vanilla overlay rather than pulling in ActionModal so
  // the bundle stays tiny for the public portal. Click outside or
  // press Escape to close.
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--s-4)',
      }}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-lg, 0 20px 60px rgba(0,0,0,0.25))',
          maxWidth: 480, width: '100%',
          padding: 'var(--s-5) var(--s-5) var(--s-4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--s-3)' }}>
          <div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Proposal summary
            </div>
            <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text)' }}>
              {titleCase(proposal.propertyName) || 'Proposal'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontFamily: 'monospace', marginTop: 2 }}>
              {proposal.refCode}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '1.25rem', color: 'var(--text-secondary)', padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 'var(--s-3)', marginTop: 'var(--s-3)',
        }}>
          <div>
            <div style={enquiryExpandedLabelStyle}>Status</div>
            <div style={{
              display: 'inline-block', padding: '2px 10px', borderRadius: 999,
              fontSize: '0.75rem', fontWeight: 600,
              background: isWon ? 'var(--success-bg, #D1FAE5)' : 'var(--bg)',
              color: isWon ? 'var(--success, #065F46)' : 'var(--text-secondary)',
            }}>
              {statusLabelText}
            </div>
          </div>
          <div>
            <div style={enquiryExpandedLabelStyle}>Dates</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text)' }}>
              {proposal.checkIn || '—'} → {proposal.checkOut || '—'}
              {nights ? <span style={{ color: 'var(--text-light)' }}> · {nights}n</span> : null}
            </div>
          </div>
        </div>

        {proposal.guestPrice != null && (
          <div style={{ marginTop: 'var(--s-4)' }}>
            <div style={enquiryExpandedLabelStyle}>Pricing</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>
              ZAR {Math.round(proposal.guestPrice).toLocaleString('en-ZA')}
              <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontWeight: 400 }}> / night</span>
            </div>
            {total != null && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                Total: ZAR {Math.round(total).toLocaleString('en-ZA')} for {nights} night{nights === 1 ? '' : 's'}
              </div>
            )}
          </div>
        )}

        <div style={{
          marginTop: 'var(--s-4)',
          padding: 'var(--s-3)',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.8125rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}>
          {isWon
            ? <>This booking is confirmed. For any changes, please contact Southern Escapes directly.</>
            : <>This proposal is closed. The live link is no longer available — contact Southern Escapes if you'd like to revisit it.</>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--s-4)' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Definition-list row inside the expanded enquiry body — small
 *  label on top, value underneath. Used for stay details + guest
 *  contact blocks so they read like a clean form summary. */
function DefRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: '0.625rem',
        fontWeight: 700,
        color: 'var(--text-light)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{ fontSize: '0.875rem', color: 'var(--text)', lineHeight: 1.4 }}>
        {value}
      </div>
    </div>
  );
}

function pillVariantFor(status: AgentEnquiryStatus): string {
  switch (status) {
    case 'new':           return 'new';
    case 'proposal_sent': return 'sent';
    case 'booked':        return 'won';
    case 'declined':      return 'declined';
    case 'cancelled':     return 'cancelled';
  }
}

// ── Full-screen states (loading / invalid link) ─────────────────────

function FullScreenMessage({ title, message }: { title?: string; message: string }) {
  return (
    <div style={fullScreenStyle}>
      {title && (
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 var(--s-3)' }}>
          {title}
        </h1>
      )}
      <p style={{ color: 'var(--text-secondary)', margin: 0, maxWidth: 440 }}>
        {message}
      </p>
    </div>
  );
}

// ── Inline layout-only styles ───────────────────────────────────────
// Uses design tokens only. Layout / positioning / containers; no new
// CSS classes introduced.

const statsRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 'var(--s-3)',
  marginBottom: 'var(--s-5)',
};

const statTileStyle: React.CSSProperties = {
  padding: 'var(--s-3) var(--s-4)',
};

const sectionHeadingStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--s-3)',
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 'var(--s-3)',
  paddingBottom: 'var(--s-2)',
  borderBottom: '1px solid var(--border-light)',
};

const emptyStateStyle: React.CSSProperties = {
  padding: 'var(--s-8) var(--s-4)',
  textAlign: 'center',
  color: 'var(--text-secondary)',
};

const enquiryRowStyle: React.CSSProperties = {
  padding: 'var(--s-3) var(--s-4)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--s-4)',
};

const enquiryExpandedLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 'var(--s-2)',
};

const enquiryExpandedSectionStyle: React.CSSProperties = {
  marginBottom: 'var(--s-4)',
};

const defGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 'var(--s-3) var(--s-4)',
};

const tierChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  fontSize: '0.6875rem',
  fontWeight: 600,
  background: 'var(--color-primary-bg)',
  color: 'var(--color-primary)',
  border: '1px solid var(--color-primary-bg)',
  borderRadius: 4,
};

const propertyChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 10px',
  fontSize: '0.8125rem',
  fontWeight: 500,
  background: 'var(--surface)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
};

const fullScreenStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--s-8) var(--s-5)',
  textAlign: 'center',
  background: 'var(--bg)',
};

// ── About tab styles ────────────────────────────────────────────────

const aboutSectionStyle: React.CSSProperties = {
  padding: 'var(--s-5) var(--s-6)',
};

const aboutHeadingStyle: React.CSSProperties = {
  fontSize: '1.0625rem',
  fontWeight: 600,
  color: 'var(--text)',
  margin: '0 0 var(--s-3)',
};

const aboutBodyStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  color: 'var(--text)',
  margin: '0 0 var(--s-3)',
  lineHeight: 1.6,
};

const contactCardStyle: React.CSSProperties = {
  // Subtle blue-grey tint so the contact cards lift off the white
  // section background. Uses the existing brand-primary background
  // token so the colour stays in the design system palette.
  background: 'var(--color-primary-bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--s-4)',
};
