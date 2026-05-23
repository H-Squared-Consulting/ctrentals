/**
 * AgentPortalPage -- public agent portal at /q/:token
 *
 * Two-tab portal. Properties tab shows the curated list of houses
 * this agent can sell, each with photo, key info, baseline pricing,
 * a "View brochure" link and a "Submit enquiry" button. My Enquiries
 * tab shows the agent's submitted enquiries with status updates.
 *
 * Uses the existing admin design system as-is (see
 * docs/DESIGN-SYSTEM.md): .property-card and .property-grid for the
 * property list, .view-toggle for the tab switcher, .card for the
 * enquiry rows, .ops-status-pill for status badges, .btn-* for
 * buttons. No new CSS classes are introduced.
 *
 * For now the data comes from a mock service module
 * (src/lib/agentPortal.ts) returning fixture data so the UX can be
 * reviewed by Hayley before any backend is built. When she signs off,
 * the three service functions get swapped for real Supabase edge
 * function calls and this component does not need to change.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getAgentByToken,
  getAgentProperties,
  getAgentEnquiries,
  statusLabel,
  type AgentInfo,
  type AgentProperty,
  type AgentEnquiry,
  type AgentEnquiryStatus,
} from '../lib/agentPortal';

type Tab = 'properties' | 'enquiries' | 'about';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

export default function AgentPortalPage() {
  const { token = '' } = useParams<{ token: string }>();

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [properties, setProperties] = useState<AgentProperty[]>([]);
  const [enquiries, setEnquiries] = useState<AgentEnquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tokenError, setTokenError] = useState(false);
  const [tab, setTab] = useState<Tab>('properties');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const a = await getAgentByToken(token);
      if (cancelled) return;
      if (!a) {
        setTokenError(true);
        setLoading(false);
        return;
      }
      const [props, enqs] = await Promise.all([
        getAgentProperties(token),
        getAgentEnquiries(token),
      ]);
      if (cancelled) return;
      setAgent(a);
      setProperties(props);
      setEnquiries(enqs);
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

  return (
    <div style={pageOuterStyle}>
     <div style={canvasStyle}>
      {/* Brand bar: Southern Escapes wordmark on the left, primary
          nav on the right. Uses .subnav + .subnav-link from the
          shared design system so the active underline matches the
          rest of the app. */}
      <BrandBar tab={tab} setTab={setTab} enquiryCount={enquiries.length} />

      {/* Personal intro line — small, above the tab content. */}
      <div style={greetingLineStyle}>
        Welcome back, <strong>{titleCase(agent.name.split(' ')[0])}</strong>
        {agent.agencyName && <span style={{ color: 'var(--text-secondary)' }}> · {titleCase(agent.agencyName)}</span>}
      </div>

      {tab === 'properties' && <PropertiesTab properties={properties} />}
      {tab === 'enquiries' && <EnquiriesTab enquiries={enquiries} />}
      {tab === 'about' && <AboutTab />}
     </div>
    </div>
  );
}

// ── Brand bar ───────────────────────────────────────────────────────

function BrandBar({ tab, setTab, enquiryCount }: { tab: Tab; setTab: (t: Tab) => void; enquiryCount: number }) {
  return (
    <div style={brandBarStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
        <div style={logoPlaceholderStyle} aria-label="Southern Escapes logo placeholder">SE</div>
        <div>
          <div style={brandWordmarkStyle}>Southern Escapes</div>
          <div style={brandTaglineStyle}>Curated short-let homes, Cape Town</div>
        </div>
      </div>
      <nav className="subnav" style={{ marginBottom: 0 }}>
        <button
          type="button"
          className={`subnav-link ${tab === 'properties' ? 'active' : ''}`}
          onClick={() => setTab('properties')}
        >
          Properties
        </button>
        <button
          type="button"
          className={`subnav-link ${tab === 'enquiries' ? 'active' : ''}`}
          onClick={() => setTab('enquiries')}
        >
          My Enquiries{enquiryCount > 0 ? ` (${enquiryCount})` : ''}
        </button>
        <button
          type="button"
          className={`subnav-link ${tab === 'about' ? 'active' : ''}`}
          onClick={() => setTab('about')}
        >
          About
        </button>
      </nav>
    </div>
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
            whatsappE164="+27825550100"
            whatsappDisplay="+27 82 555 0100"
            email="nicki@southernescapes.co.za"
          />
          <ContactCard
            name="Hayley Harrod"
            role="Operations & Property Management"
            whatsappE164="+27835550100"
            whatsappDisplay="+27 83 555 0100"
            email="hayley@southernescapes.co.za"
          />
        </div>
        <p style={{ ...aboutBodyStyle, fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 'var(--s-4)' }}>
          Contact details above are placeholders until Hayley and Nicki confirm the real numbers.
        </p>
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

// ── Properties tab ──────────────────────────────────────────────────

function PropertiesTab({ properties }: { properties: AgentProperty[] }) {
  if (properties.length === 0) {
    return (
      <div className="card" style={emptyStateStyle}>
        No properties enabled for you yet. Get in touch with CT Rentals if this looks wrong.
      </div>
    );
  }
  return (
    <div className="property-grid">
      {properties.map(p => <PropertyCard key={p.id} property={p} />)}
    </div>
  );
}

function PropertyCard({ property }: { property: AgentProperty }) {
  return (
    <article className="property-card" style={{ cursor: 'default' }}>
      <div className="property-card__image">
        {property.photoUrl
          ? <img src={property.photoUrl} alt={titleCase(property.name)} loading="lazy" />
          : <div className="property-card__no-image">🏠</div>}
      </div>
      <div className="property-card__body">
        <div className="property-card__name-row">
          <h3 className="property-card__name">{titleCase(property.name)}</h3>
          <span className="property-card__uid" title="Unique ID">{property.slug}</span>
        </div>
        <p className="property-card__location">{titleCase(property.suburb)}</p>
        <div className="property-card__stats">
          <span className="property-card__stat">🛏 {property.bedrooms} bed{property.bedrooms !== 1 ? 's' : ''}</span>
          <span className="property-card__stat">👤 {property.sleeps} guests</span>
        </div>
        <div className="property-card__price">
          ZAR {property.baselineRate.toLocaleString('en-ZA')}
          <span className="property-card__price-label"> / night</span>
        </div>
      </div>
      <div className="property-card__footer" style={{ gap: 8 }}>
        <a
          className="btn btn-ghost"
          href={`/brochures/${encodeURIComponent(property.slug)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View brochure
        </a>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => alert(`Enquire flow coming next session for ${titleCase(property.name)}`)}
        >
          + Enquire
        </button>
      </div>
    </article>
  );
}

// ── Enquiries tab ───────────────────────────────────────────────────

function EnquiriesTab({ enquiries }: { enquiries: AgentEnquiry[] }) {
  if (enquiries.length === 0) {
    return (
      <div className="card" style={emptyStateStyle}>
        You have not submitted any enquiries yet. Pick a property and tap <strong>+ Enquire</strong> to get started.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      {enquiries.map(e => <EnquiryRow key={e.id} enquiry={e} />)}
    </div>
  );
}

function EnquiryRow({ enquiry }: { enquiry: AgentEnquiry }) {
  return (
    <div className="card" style={enquiryRowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
          {titleCase(enquiry.guestName)}
        </div>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          {titleCase(enquiry.propertyName)} · {enquiry.checkIn} to {enquiry.checkOut}
        </div>
      </div>
      <span className={`ops-status-pill ops-status-pill--${pillVariantFor(enquiry.status)}`}>
        <span className="ops-status-pill-dot" />
        {statusLabel(enquiry.status)}
      </span>
      {enquiry.proposalShareUrl && (
        <a
          className="btn btn-ghost"
          href={enquiry.proposalShareUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          View proposal
        </a>
      )}
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

const pageOuterStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg)',
  padding: 'var(--s-6) var(--s-4)',
};

const canvasStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-lg)',
  padding: 'var(--s-6) var(--s-6) var(--s-8)',
};

const greetingLineStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  color: 'var(--text)',
  marginBottom: 'var(--s-5)',
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

// ── Brand bar styles ────────────────────────────────────────────────

const brandBarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-end',
  gap: 'var(--s-4)',
  marginBottom: 'var(--s-5)',
  borderBottom: '1px solid var(--border-light)',
  flexWrap: 'wrap',
};

const logoPlaceholderStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-primary)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.9375rem',
  fontWeight: 700,
  letterSpacing: '0.05em',
  flexShrink: 0,
};

const brandWordmarkStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 700,
  color: 'var(--text)',
  letterSpacing: '0.02em',
  lineHeight: 1.2,
};

const brandTaglineStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  color: 'var(--text-secondary)',
  marginTop: 2,
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
