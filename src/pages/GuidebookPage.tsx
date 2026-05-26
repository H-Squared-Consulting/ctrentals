/**
 * GuidebookPage -- public per-property guidebook at /g/:slug.
 *
 * Magazine-style premium layout matching the brochure visual language:
 *   - Cinematic full-bleed hero with SE wordmark + property title
 *   - Centered canvas (840px) with drop shadow on desktop
 *   - Section pattern: eyebrow + heading + gold rule + content
 *   - Sticky in-page nav that smooth-scrolls between Arrival / Stay /
 *     Explore — each "tab" is a section rendered in full, magazine
 *     style, instead of swapping content panes
 *   - Recommendations rendered with large imagery + category grouping
 *
 * Public, no auth, no admin chrome. RLS gates anon reads on
 * is_published (see migrations 20260526200000+).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Icon,
  Emoji,
  MapEmbed,
  RecMap,
  HAS_MAPBOX_TOKEN,
  GuidebookChrome,
  GuidebookSearchPill,
  fullAddress,
  telHref,
  waHref,
  formatCheckoutTime,
  type Guidebook,
  type Manual,
  type RecPin,
  type RecMapHandle,
  type ChecklistItem,
} from '../lib/guidebookShared';
import { groupByCategory, type GuidebookCategory } from '../lib/guidebookTaxonomy';

type Recommendation = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  address: string | null;
  website: string | null;
  image_url: string | null;
  lat: number | null;
  lng: number | null;
  position: number;
};

export default function GuidebookPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [guidebook, setGuidebook] = useState<Guidebook | null>(null);
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [activeSection, setActiveSection] = useState<'home' | 'arrival' | 'stay' | 'departure' | 'explore'>('home');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }

  // Brochure-style document title (Hostfully tab read "9 Montrose Terrace - Arrival").
  useEffect(() => {
    if (guidebook) document.title = `${guidebook.property_name} · Guidebook`;
  }, [guidebook]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      const { data: gb, error } = await supabase
        .from('guidebooks').select('*').eq('slug', slug).maybeSingle();
      if (cancelled) return;
      if (error || !gb) { setNotFound(true); setLoading(false); return; }
      setGuidebook(gb as Guidebook);

      const [manualsRes, recsRes] = await Promise.all([
        supabase.from('guidebook_manual_assignments')
          .select('position, override_body_html, guidebook_house_manuals(id, slug, title, category, body_html, icon, image_url, emergency_tag)')
          .eq('guidebook_id', gb.id).order('position'),
        supabase.from('guidebook_recommendation_assignments')
          .select('position, guidebook_recommendations(id, slug, name, category, description, address, website, image_url, lat, lng)')
          .eq('guidebook_id', gb.id).order('position'),
      ]);
      if (cancelled) return;

      setManuals((manualsRes.data || []).map((row: any) => ({
        id: row.guidebook_house_manuals.id,
        slug: row.guidebook_house_manuals.slug,
        title: row.guidebook_house_manuals.title,
        category: row.guidebook_house_manuals.category,
        body_html: row.override_body_html ?? row.guidebook_house_manuals.body_html,
        icon: row.guidebook_house_manuals.icon,
        image_url: row.guidebook_house_manuals.image_url ?? null,
        emergency_tag: row.guidebook_house_manuals.emergency_tag ?? null,
        position: row.position,
      })));
      setRecommendations((recsRes.data || []).map((row: any) => ({
        id: row.guidebook_recommendations.id,
        slug: row.guidebook_recommendations.slug,
        name: row.guidebook_recommendations.name,
        category: row.guidebook_recommendations.category,
        description: row.guidebook_recommendations.description,
        address: row.guidebook_recommendations.address,
        website: row.guidebook_recommendations.website,
        image_url: row.guidebook_recommendations.image_url,
        lat: row.guidebook_recommendations.lat,
        lng: row.guidebook_recommendations.lng,
        position: row.position,
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Sticky nav scrollspy — highlight the section the user is currently
  // reading. Uses IntersectionObserver against the four top-level
  // <section> wrappers in the canvas (Home, Arrival, Stay, Explore).
  useEffect(() => {
    if (loading || notFound) return;
    const ids = ['home', 'arrival', 'stay', 'departure', 'explore'] as const;
    const observer = new IntersectionObserver((entries) => {
      // Pick the section closest to the top that's still intersecting.
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length > 0) {
        const id = visible[0].target.id as typeof ids[number];
        setActiveSection(id);
      }
    }, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [loading, notFound]);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 64;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  if (loading) {
    return (
      <div className="gb-page gb-loading-wrap">
        <div className="gb-loading-spinner" />
        <div className="gb-loading-text">Loading guidebook</div>
      </div>
    );
  }
  if (notFound || !guidebook) {
    return (
      <div className="gb-page gb-loading-wrap">
        <div className="gb-loading-text">Guidebook not found.</div>
      </div>
    );
  }

  return (
    <div className="gb-page">
      {/* Cinematic hero */}
      <header
        className="gb-hero"
        style={guidebook.hero_image_url
          ? { backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.35) 100%), url(${guidebook.hero_image_url})` }
          : undefined}
      >
        <div className="gb-hero-inner">
          <div className="gb-hero-brand" aria-label="Southern Escapes">
            <span className="gb-hero-brand-script">Southern</span>
            <span className="gb-hero-brand-sans">ESCAPES</span>
          </div>
          <div className="gb-hero-eyebrow">Your Guidebook</div>
          <h1 className="gb-hero-title">{guidebook.property_name}</h1>
          <div className="gb-hero-meta">
            {fullAddress(guidebook) && <span>{fullAddress(guidebook)}</span>}
          </div>
        </div>
        <div className="gb-hero-scroll-cue" aria-hidden>
          <span className="gb-hero-scroll-line" />
          <span className="gb-hero-scroll-label">Scroll</span>
        </div>
      </header>

      {/* Quick-actions strip — sits between the hero and the nav, with a
          negative top margin so it visually overlaps the hero's bottom
          edge (mirrors the brochure canvas treatment). Mobile horizontal
          scroll; desktop centred row. */}
      <QuickActionsStrip
        guidebook={guidebook}
        scrollTo={scrollTo}
        showToast={showToast}
      />

      {/* Sticky in-page nav */}
      <nav className="gb-nav" role="navigation" aria-label="Guidebook sections">
        <div className="gb-nav-inner">
          <div className="gb-nav-tabs">
            {([
              { id: 'home',      label: 'Home' },
              { id: 'arrival',   label: 'Arrival' },
              { id: 'stay',      label: 'Your Stay' },
              { id: 'departure', label: 'Departure' },
              { id: 'explore',   label: 'Explore' },
            ] as const).map(s => (
              <button
                key={s.id}
                type="button"
                className={`gb-nav-link ${activeSection === s.id ? 'is-active' : ''}`}
                onClick={() => scrollTo(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <GuidebookSearchPill />
        </div>
      </nav>

      <div className="gb-canvas">
        {/* ── Home ────────────────────────────────────────────────── */}
        <section id="home" className="gb-section gb-section--white gb-section--home">
          <HostCard guidebook={guidebook} />
        </section>

        {/* ── Arrival ─────────────────────────────────────────────── */}
        <section id="arrival" className="gb-section gb-section--cream">
          <div className="gb-section-head">
            <div className="gb-eyebrow">Section One</div>
            <h2 className="gb-section-title">Arrival</h2>
            <div className="gb-rule" />
            <p className="gb-section-lede">Everything you need for a smooth landing — check-in, directions, parking, WiFi and check-out.</p>
          </div>

          <div className="gb-arrival-grid">
            {/* Two-column row first: Check-in + Parking. */}
            <ArrivalCard icon="clock" title="Check-in" body={guidebook.checkin_text} />
            <ArrivalCard icon="car"   title="Parking"  body={guidebook.parking_text} />
            {/* Full-width rows: Directions (map + CTAs), WiFi. Check-out
                lives in the Departure section below. */}
            <DirectionsCard guidebook={guidebook} showToast={showToast} />
            <WifiCard
              ssid={guidebook.wifi_ssid}
              password={guidebook.wifi_password}
              notes={guidebook.wifi_notes}
              showToast={showToast}
            />
          </div>
        </section>

        {/* ── Your Stay (House manual) ────────────────────────────── */}
        <section id="stay" className="gb-section gb-section--white">
          <div className="gb-section-head">
            <div className="gb-eyebrow">Section Two</div>
            <h2 className="gb-section-title">Your Stay</h2>
            <div className="gb-rule" />
            <p className="gb-section-lede">House notes, local quirks and the small things that make a long stay feel easy.</p>
          </div>

          {manuals.length === 0 && <p className="gb-empty">No house-manual entries yet.</p>}

          <ManualGroups manuals={manuals} />
        </section>

        {/* ── Departure (checkout + checklist) ────────────────────── */}
        <DepartureSection guidebook={guidebook} />

        {/* ── Explore (recommendations) ───────────────────────────── */}
        <ExploreSection
          guidebook={guidebook}
          recommendations={recommendations}
        />


        {/* Footer — matches the Logo_Pack/footer.png reference: actual
            brand mark (mountain silhouette + script + bold sans) on a
            soft cream wash, with the copyright caption beneath. */}
        <footer className="gb-footer">
          <img
            src="/brochure-assets/se-logo.png"
            alt="Southern Escapes"
            className="gb-footer-logo"
          />
          <div className="gb-footer-copy">© {new Date().getFullYear()} Southern Escapes. All rights reserved.</div>
        </footer>
      </div>

      {/* Persistent chrome — Emergency FAB + Host-contact chip +
          ⌘K search modal. Mounted at the page root so they survive
          scroll on every section. */}
      <GuidebookChrome
        guidebook={guidebook}
        searchData={{ guidebook, manuals, recommendations }}
      />

      {/* Live toast region — used by copy buttons + quick-action chips.
          aria-live polite so screen readers announce without interrupting. */}
      <div
        className={`gb-toast ${toast ? 'is-visible' : ''}`}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>
    </div>
  );
}

function ArrivalCard({
  icon, title, body, fullWidth,
}: { icon: string; title: string; body: string | null; fullWidth?: boolean }) {
  if (!body) return null;
  return (
    <article className={`gb-arrival-card ${fullWidth ? 'gb-arrival-card--full' : ''}`}>
      <div className="gb-arrival-icon" aria-hidden><Emoji name={icon} /></div>
      <h3 className="gb-arrival-title">{title}</h3>
      <div className="gb-prose" dangerouslySetInnerHTML={{ __html: body }} />
    </article>
  );
}

function WifiCard({
  ssid, password, notes, showToast,
}: {
  ssid: string | null; password: string | null; notes: string | null;
  showToast: (msg: string) => void;
}) {
  if (!ssid && !password && !notes) return null;
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label} copied`);
    } catch {
      showToast(`Couldn't copy — long-press to select`);
    }
  }
  return (
    <article className="gb-arrival-card gb-arrival-card--full gb-arrival-card--wifi">
      <div className="gb-arrival-icon" aria-hidden><Emoji name="wifi" /></div>
      <h3 className="gb-arrival-title">WiFi</h3>
      <div className="gb-wifi-rows">
        {ssid && (
          <div className="gb-wifi-row">
            <div className="gb-wifi-row-label">Network</div>
            <div className="gb-wifi-row-value">{ssid}</div>
            <button
              type="button"
              className="gb-qa-copy"
              onClick={() => copy(ssid, 'WiFi network')}
              aria-label="Copy WiFi network name"
            >
              <Icon name="copy" /> Copy
            </button>
          </div>
        )}
        {password && (
          <div className="gb-wifi-row">
            <div className="gb-wifi-row-label">Password</div>
            <div className="gb-wifi-row-value gb-wifi-mono">{password}</div>
            <button
              type="button"
              className="gb-qa-copy gb-qa-copy--primary"
              onClick={() => copy(password, 'WiFi password')}
              aria-label="Copy WiFi password"
            >
              <Icon name="copy" /> Copy
            </button>
          </div>
        )}
      </div>
      {notes && <p className="gb-prose gb-wifi-notes">{notes}</p>}
    </article>
  );
}

/* DirectionsCard — replaces the "wall of prose" with a map embed,
 * Open-in-Maps + Share-address CTAs, and a collapsible <details>
 * holding the original directions_text prose. Mobile-first; the map
 * renders below the title on every viewport. */
function DirectionsCard({
  guidebook, showToast,
}: { guidebook: Guidebook; showToast: (msg: string) => void }) {
  const address = fullAddress(guidebook);
  const hasMap = guidebook.lat != null && guidebook.lng != null;
  if (!address && !hasMap && !guidebook.directions_text) return null;
  const mapsHref = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : (hasMap ? `https://www.google.com/maps/search/?api=1&query=${guidebook.lat},${guidebook.lng}` : null);

  async function handleShare() {
    if (!address) return;
    if ((navigator as any).share) {
      try {
        await (navigator as any).share({
          title: guidebook.property_name,
          text: `${guidebook.property_name} — ${address}`,
          url: mapsHref || undefined,
        });
        return;
      } catch { /* user cancelled — fall through to copy */ }
    }
    try {
      await navigator.clipboard.writeText(address);
      showToast('Address copied');
    } catch {
      showToast(`Couldn't copy — long-press to select`);
    }
  }

  return (
    <article className="gb-arrival-card gb-arrival-card--full gb-arrival-card--directions">
      <div className="gb-arrival-icon" aria-hidden><Emoji name="map" /></div>
      <h3 className="gb-arrival-title">Directions</h3>
      {address && <p className="gb-prose gb-directions-address">{address}</p>}

      {hasMap && (
        <div className="gb-directions-map">
          <MapEmbed lat={guidebook.lat!} lng={guidebook.lng!} label={guidebook.property_name} />
        </div>
      )}

      <div className="gb-directions-actions">
        {mapsHref && (
          <a
            className="btn btn-tel"
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open property location in Maps"
          >
            <Icon name="map" /> <span>Open in Maps</span>
          </a>
        )}
        {address && (
          <button
            type="button"
            className="btn btn-outline-primary"
            onClick={handleShare}
            aria-label="Share or copy the property address"
          >
            <Icon name="copy" /> <span>Share address</span>
          </button>
        )}
      </div>

      {guidebook.directions_text && (
        <details className="gb-directions-details">
          <summary>Written directions</summary>
          <div className="gb-prose" dangerouslySetInnerHTML={{ __html: guidebook.directions_text }} />
        </details>
      )}
    </article>
  );
}

/* ───────────────────── Quick-actions strip ────────────────────────
 * Sits between hero and sticky nav (overlapping the hero's bottom
 * edge for a magazine "tab strip" effect). Mobile: horizontal scroll.
 * Desktop: centered row. Each chip is ≥44×44px (Apple HIG).
 *
 * Chip behaviours (§4.1):
 *   WiFi      → expands inline; reveals SSID/password with copy + toast
 *   Check-out → smooth-scrolls to the Check-out card in Arrival
 *               (Departure section arrives in PR #8)
 *   Call host → real <a href="tel:"> link
 *   Emergency → routes to /g/:slug/emergency (built in PR #4)
 *   Address   → copies the full address + opens Google Maps in a tab
 */
function QuickActionsStrip({
  guidebook, scrollTo, showToast,
}: {
  guidebook: Guidebook;
  scrollTo: (id: string) => void;
  showToast: (msg: string) => void;
}) {
  const [wifiExpanded, setWifiExpanded] = useState(false);

  const checkoutLabel = useMemo(() => {
    const t = formatCheckoutTime(guidebook.checkout_time);
    return t ? `Check-out ${t}` : 'Check-out';
  }, [guidebook.checkout_time]);

  const address = fullAddress(guidebook);
  const mapsHref = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;
  const tel = telHref(guidebook.host_phone);
  const hostFirstName = (guidebook.host_name || '').split(' ')[0] || 'host';

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label} copied`);
    } catch {
      showToast(`Couldn't copy — long-press to select`);
    }
  }

  return (
    <div className="gb-qa-wrap">
      <div className="gb-qa-strip" role="toolbar" aria-label="Quick actions">
        {/* WiFi — toggle reveal */}
        <button
          type="button"
          className={`gb-qa-chip gb-qa-chip--wifi ${wifiExpanded ? 'is-expanded' : ''}`}
          onClick={() => setWifiExpanded(v => !v)}
          aria-expanded={wifiExpanded}
        >
          <Icon name="wifi" />
          <span className="gb-qa-chip-label">WiFi</span>
        </button>

        {/* Check-out — jumps to the Departure section. */}
        <button
          type="button"
          className="gb-qa-chip"
          onClick={() => scrollTo('departure')}
          aria-label={checkoutLabel}
        >
          <Icon name="clock" />
          <span className="gb-qa-chip-label">{checkoutLabel}</span>
        </button>

        {/* Call host */}
        {tel ? (
          <a
            className="gb-qa-chip"
            href={tel}
            aria-label={`Call ${hostFirstName}`}
          >
            <Icon name="phone" />
            <span className="gb-qa-chip-label">{hostFirstName}</span>
          </a>
        ) : (
          <span
            className="gb-qa-chip gb-qa-chip--disabled"
            aria-label="Host phone not yet set"
            title="Your host hasn't set a phone number yet"
          >
            <Icon name="phone" />
            <span className="gb-qa-chip-label">Host</span>
          </span>
        )}

        {/* Emergency */}
        <a
          className="gb-qa-chip gb-qa-chip--emergency"
          href={`/g/${guidebook.slug}/emergency`}
          aria-label="Emergency contacts and shut-offs"
        >
          <Icon name="alert" />
          <span className="gb-qa-chip-label">Emergency</span>
        </a>

        {/* Address — copy + open Maps */}
        {address && mapsHref && (
          <button
            type="button"
            className="gb-qa-chip"
            onClick={() => {
              copy(address, 'Address');
              window.open(mapsHref, '_blank', 'noopener,noreferrer');
            }}
            aria-label="Copy address and open in Maps"
          >
            <Icon name="map" />
            <span className="gb-qa-chip-label">Address</span>
          </button>
        )}
      </div>

      {/* Expanded WiFi panel — slides open beneath the strip. */}
      {wifiExpanded && (guidebook.wifi_ssid || guidebook.wifi_password) && (
        <div className="gb-qa-wifi-panel" role="region" aria-label="WiFi details">
          {guidebook.wifi_ssid && (
            <div className="gb-qa-wifi-row">
              <div className="gb-qa-wifi-label">Network</div>
              <div className="gb-qa-wifi-value">{guidebook.wifi_ssid}</div>
              <button
                type="button"
                className="gb-qa-copy"
                onClick={() => copy(guidebook.wifi_ssid!, 'WiFi network')}
                aria-label="Copy WiFi network name"
              >
                <Icon name="copy" />
              </button>
            </div>
          )}
          {guidebook.wifi_password && (
            <div className="gb-qa-wifi-row">
              <div className="gb-qa-wifi-label">Password</div>
              <div className="gb-qa-wifi-value gb-qa-wifi-mono">{guidebook.wifi_password}</div>
              <button
                type="button"
                className="gb-qa-copy gb-qa-copy--primary"
                onClick={() => copy(guidebook.wifi_password!, 'WiFi password')}
                aria-label="Copy WiFi password"
              >
                <Icon name="copy" /> Copy
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Host card ─────────────────────────────
 * Centred under the Home eyebrow. Round host photo (96px), name,
 * one-paragraph welcome (Playfair italic), Call + WhatsApp buttons.
 * Per §10.8, no backup-host fields in v1 — Nicki is mentioned inside
 * the welcome prose, not as a structured contact.
 */
function HostCard({ guidebook }: { guidebook: Guidebook }) {
  if (!guidebook.host_name && !guidebook.welcome_html) return null;
  const firstName = (guidebook.host_name || '').split(' ')[0];
  const tel = telHref(guidebook.host_phone);
  const wa  = waHref(guidebook.host_phone);
  return (
    <div className="gb-host-card">
      <div className="gb-host-card-photo" aria-hidden>
        {guidebook.host_photo_url ? (
          <img src={guidebook.host_photo_url} alt="" />
        ) : (
          <span className="gb-host-card-initials">
            {(guidebook.host_name || 'SE').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      {guidebook.host_name && (
        <div className="gb-host-card-name">A note from {firstName || guidebook.host_name}</div>
      )}
      {guidebook.welcome_html && (
        <div
          className="gb-host-card-welcome"
          dangerouslySetInnerHTML={{ __html: guidebook.welcome_html }}
        />
      )}
      {(tel || wa) && (
        <div className="gb-host-card-actions">
          {tel && (
            <a className="btn btn-tel" href={tel} aria-label={`Call ${firstName || guidebook.host_name}`}>
              <Icon name="phone" /> <span>Call {firstName || guidebook.host_name}</span>
            </a>
          )}
          {wa && (
            <a
              className="btn btn-whatsapp"
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Message ${firstName || guidebook.host_name} on WhatsApp`}
            >
              <Icon name="message" /> <span>WhatsApp {firstName || guidebook.host_name}</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Your Stay — grouped manuals ─────────────────
 * Groups manual cards by the canonical 8-category enum from §2.2.
 * Each group: numbered eyebrow ("01 — Safety") + gold rule + cards.
 * Empty groups don't render. Each card is a <details> on mobile so
 * a long manual collapses by default — desktop forces them open
 * via CSS (no scroll-tax for power readers on a big screen).
 */
function ManualGroups({ manuals }: { manuals: Manual[] }) {
  const groups = useMemo(() => groupByCategory(manuals), [manuals]);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Desktop ≥769px: force every <details> open so the body shows
  // unconditionally. Mobile: leave the user's open/closed state alone.
  // Re-syncs on resize when the user crosses the breakpoint.
  useEffect(() => {
    if (!wrapRef.current) return;
    const mq = window.matchMedia('(min-width: 769px)');
    function syncOpen() {
      const isDesktop = mq.matches;
      const els = wrapRef.current?.querySelectorAll<HTMLDetailsElement>('.gb-manual-details');
      if (!els) return;
      els.forEach(d => {
        if (isDesktop) d.setAttribute('open', '');
        // Don't auto-close on mobile — respect whatever the user did.
      });
    }
    syncOpen();
    mq.addEventListener('change', syncOpen);
    return () => mq.removeEventListener('change', syncOpen);
  }, [groups]);

  if (groups.length === 0) return null;
  return (
    <div ref={wrapRef} className="gb-manual-groups">
      {groups.map((group, i) => (
        <div key={group.category} className="gb-manual-group">
          <div className="gb-manual-group-head">
            <div className="gb-manual-group-eyebrow">
              <span className="gb-manual-group-num">{String(i + 1).padStart(2, '0')}</span>
              <span>{group.category}</span>
            </div>
            <div className="gb-manual-group-rule" />
          </div>
          <div className="gb-manual-list">
            {group.items.map(m => (
              <ManualCard key={m.id} manual={m} category={group.category} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ManualCard({ manual, category }: { manual: Manual; category: GuidebookCategory }) {
  const hasPhoto = !!manual.image_url;
  return (
    <article className={`gb-manual-card gb-manual-card--v2 ${hasPhoto ? 'gb-manual-card--photo' : ''}`}>
      {hasPhoto && (
        <div
          className="gb-manual-photo"
          style={{ backgroundImage: `url(${manual.image_url})` }}
          aria-hidden
        />
      )}
      <details className="gb-manual-details">
        <summary className="gb-manual-summary">
          <div className="gb-manual-summary-icon" aria-hidden>
            <Emoji name={manual.icon || 'home'} />
          </div>
          <div className="gb-manual-summary-text">
            <div className="gb-manual-category">{category}</div>
            <h3 className="gb-manual-title">{manual.title}</h3>
          </div>
          <span className="gb-manual-summary-chevron" aria-hidden>›</span>
        </summary>
        {manual.body_html && (
          <div
            className="gb-prose gb-manual-body"
            dangerouslySetInnerHTML={{ __html: manual.body_html }}
          />
        )}
      </details>
    </article>
  );
}

/* ─────────────────── Explore (recommendations) ──────────────────
 * Category filter chips + List/Map view toggle + the rec grid.
 * Map view only enables when VITE_MAPBOX_TOKEN is configured (the
 * toggle hides otherwise).
 */
type ExploreView = 'list' | 'map';

function ExploreSection({
  guidebook, recommendations,
}: { guidebook: Guidebook; recommendations: Recommendation[] }) {
  const [activeCat, setActiveCat] = useState<string>('All');
  // Default view per §5.2: list on mobile, map on ≥1024px desktop.
  const [view, setView] = useState<ExploreView>(() => {
    if (typeof window === 'undefined') return 'list';
    if (!HAS_MAPBOX_TOKEN) return 'list';
    return window.matchMedia('(min-width: 1024px)').matches ? 'map' : 'list';
  });
  const mapRef = useRef<RecMapHandle | null>(null);

  // Categories present in this guidebook's recs, in original (curated)
  // appearance order — the host's pick of "important first".
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of recommendations) {
      const c = r.category || 'Other';
      if (!seen.has(c)) { seen.add(c); out.push(c); }
    }
    return out;
  }, [recommendations]);

  const filtered = useMemo(
    () => activeCat === 'All' ? recommendations : recommendations.filter(r => (r.category || 'Other') === activeCat),
    [recommendations, activeCat],
  );

  // Group filtered into categories for the list view. Single-category
  // filter shows one group header; "All" shows the full taxonomy.
  const grouped = useMemo(() => {
    const m = new Map<string, Recommendation[]>();
    for (const r of filtered) {
      const c = r.category || 'Other';
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(r);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const pins: RecPin[] = useMemo(
    () => filtered
      .filter(r => r.lat != null && r.lng != null)
      .map(r => ({
        id: r.id, slug: r.slug, name: r.name,
        category: r.category, description: r.description, address: r.address,
        website: r.website, lat: r.lat!, lng: r.lng!,
      })),
    [filtered],
  );

  const center = useMemo(() => {
    if (guidebook.lat != null && guidebook.lng != null) {
      return { lat: guidebook.lat, lng: guidebook.lng };
    }
    // Fallback: average of the rec coordinates, or Cape Town centre.
    if (pins.length > 0) {
      const lat = pins.reduce((s, p) => s + p.lat, 0) / pins.length;
      const lng = pins.reduce((s, p) => s + p.lng, 0) / pins.length;
      return { lat, lng };
    }
    return { lat: -33.9249, lng: 18.4241 };
  }, [guidebook.lat, guidebook.lng, pins]);

  const [selectedPin, setSelectedPin] = useState<RecPin | null>(null);

  function focusOnMap(slug: string) {
    setView('map');
    // Defer until the map mounts on first switch.
    setTimeout(() => mapRef.current?.focusPin(slug), 80);
  }

  return (
    <section id="explore" className="gb-section gb-section--linen">
      <div className="gb-section-head">
        <div className="gb-eyebrow">Section Three</div>
        <h2 className="gb-section-title">Explore</h2>
        <div className="gb-rule" />
        <p className="gb-section-lede">
          Our handpicked Cape Town list — vetted restaurants, wine farms, attractions and quiet local favourites within easy reach of {guidebook.property_name.replace(/^\d+\s+/, '')}.
        </p>
      </div>

      {recommendations.length === 0 ? (
        <p className="gb-empty">No recommendations yet.</p>
      ) : (
        <>
          <div className="gb-explore-controls">
            <div className="gb-chip-row" role="tablist" aria-label="Filter by category">
              <button
                type="button"
                role="tab"
                aria-selected={activeCat === 'All'}
                className={`gb-chip ${activeCat === 'All' ? 'is-active' : ''}`}
                onClick={() => setActiveCat('All')}
              >
                All
                <span className="gb-chip-count">{recommendations.length}</span>
              </button>
              {categories.map(c => {
                const count = recommendations.filter(r => (r.category || 'Other') === c).length;
                const active = activeCat === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`gb-chip ${active ? 'is-active' : ''}`}
                    onClick={() => setActiveCat(c)}
                  >
                    {c}
                    <span className="gb-chip-count">{count}</span>
                  </button>
                );
              })}
            </div>

            {HAS_MAPBOX_TOKEN && (
              <div className="gb-view-toggle" role="tablist" aria-label="View">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'list'}
                  className={`gb-view-toggle-btn ${view === 'list' ? 'is-active' : ''}`}
                  onClick={() => setView('list')}
                >
                  List
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'map'}
                  className={`gb-view-toggle-btn ${view === 'map' ? 'is-active' : ''}`}
                  onClick={() => setView('map')}
                >
                  Map
                </button>
              </div>
            )}
          </div>

          {view === 'map' ? (
            <div className="gb-explore-map-wrap">
              <RecMap
                center={center}
                pins={pins}
                mapRef={mapRef}
                onPinSelect={setSelectedPin}
                height={520}
              />
              {selectedPin && (
                <div className="gb-recmap-popover" role="dialog" aria-label={selectedPin.name}>
                  <button
                    type="button"
                    className="gb-recmap-popover-close"
                    onClick={() => setSelectedPin(null)}
                    aria-label="Close"
                  >✕</button>
                  {selectedPin.category && (
                    <div className="gb-rec-cat-pill">{selectedPin.category}</div>
                  )}
                  <h4 className="gb-rec-name">{selectedPin.name}</h4>
                  {selectedPin.description && (
                    <p className="gb-rec-description" dangerouslySetInnerHTML={{ __html: selectedPin.description }} />
                  )}
                  <div className="gb-rec-meta">
                    {selectedPin.address && (
                      <a
                        className="gb-rec-link"
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedPin.address)}`}
                        target="_blank" rel="noopener noreferrer"
                      >
                        Open in Maps ↗
                      </a>
                    )}
                    {selectedPin.website && (
                      <a className="gb-rec-link" href={selectedPin.website} target="_blank" rel="noopener noreferrer">
                        Visit website ↗
                      </a>
                    )}
                  </div>
                </div>
              )}
              {pins.length === 0 && (
                <div className="gb-recmap-overlay">
                  These places aren't pinned on the map yet — switch to List to see them.
                </div>
              )}
            </div>
          ) : (
            grouped.length === 0 ? (
              <p className="gb-empty">No places in this category.</p>
            ) : (
              grouped.map(([cat, items]) => (
                <div key={cat} className="gb-rec-group">
                  <div className="gb-rec-group-head">
                    <h3 className="gb-rec-group-title">{cat}</h3>
                    <div className="gb-rec-group-rule" />
                  </div>
                  <div className="gb-rec-grid">
                    {items.map((r, idx) => (
                      <RecCard
                        key={r.id}
                        rec={r}
                        featured={idx === 0}
                        canMap={HAS_MAPBOX_TOKEN && r.lat != null && r.lng != null}
                        onShowOnMap={() => focusOnMap(r.slug)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )
          )}
        </>
      )}
    </section>
  );
}

function RecCard({
  rec, featured, canMap, onShowOnMap,
}: {
  rec: Recommendation;
  featured: boolean;
  canMap: boolean;
  onShowOnMap: () => void;
}) {
  const mapsHref = rec.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rec.address)}`
    : (rec.lat != null && rec.lng != null
        ? `https://www.google.com/maps/search/?api=1&query=${rec.lat},${rec.lng}`
        : null);
  return (
    <article className={`gb-rec-card ${featured ? 'gb-rec-card--featured' : ''}`}>
      {rec.image_url ? (
        <div className="gb-rec-image" style={{ backgroundImage: `url(${rec.image_url})` }} aria-hidden />
      ) : (
        <div className="gb-rec-image gb-rec-image--placeholder" aria-hidden>
          <Emoji name="map" />
        </div>
      )}
      <div className="gb-rec-body">
        {rec.category && <div className="gb-rec-cat-pill">{rec.category}</div>}
        <h4 className="gb-rec-name">{rec.name}</h4>
        {rec.description && (
          <p className="gb-rec-description" dangerouslySetInnerHTML={{ __html: rec.description }} />
        )}
        <div className="gb-rec-meta">
          {rec.address && (
            <div className="gb-rec-address">
              <Emoji name="map" /> <span>{rec.address}</span>
            </div>
          )}
          <div className="gb-rec-card-actions">
            {mapsHref && (
              <a
                className="gb-rec-link"
                href={mapsHref}
                target="_blank" rel="noopener noreferrer"
              >
                Open in Maps ↗
              </a>
            )}
            {rec.website && (
              <a className="gb-rec-link" href={rec.website} target="_blank" rel="noopener noreferrer">
                Website ↗
              </a>
            )}
            {canMap && (
              <button
                type="button"
                className="gb-rec-pin-btn"
                onClick={onShowOnMap}
                aria-label={`Show ${rec.name} on the map`}
              >
                Show on map
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/* ─────────────────── Departure (checklist) ──────────────────────
 * Per §4.4 — a real, checkable, per-device persistent checklist
 * with progress bar. Default closed/unchecked; state lives in
 * localStorage keyed by guidebook slug so it survives reload.
 */
function DepartureSection({ guidebook }: { guidebook: Guidebook }) {
  const checklist: ChecklistItem[] = useMemo(() => {
    const raw = guidebook.checkout_checklist;
    return Array.isArray(raw) ? raw.filter(i => i && i.id && i.label) : [];
  }, [guidebook.checkout_checklist]);

  const storageKey = `gb-${guidebook.slug}-checklist`;
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch { return {}; }
  });

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(checked)); } catch {}
  }, [checked, storageKey]);

  const total = checklist.length;
  const done = checklist.filter(i => checked[i.id]).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const allDone = total > 0 && done === total;

  function toggle(id: string) {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  }
  function reset() {
    setChecked({});
  }

  const formatted = formatCheckoutTime(guidebook.checkout_time);

  // Empty-state: hide the whole section if the host hasn't set up
  // a time, prose or a checklist. Don't render an empty placeholder.
  if (!formatted && !guidebook.checkout_text && checklist.length === 0) {
    return (
      <section id="departure" className="gb-section gb-section--cream" aria-hidden />
    );
  }

  return (
    <section id="departure" className="gb-section gb-section--cream">
      <div className="gb-section-head">
        <div className="gb-eyebrow">Section Four</div>
        <h2 className="gb-section-title">Departure</h2>
        <div className="gb-rule" />
        <p className="gb-section-lede">A short list to leave the home as you found it. Your ticks stay on this device.</p>
      </div>

      {formatted && (
        <div className="gb-departure-time">
          <div className="gb-departure-time-eyebrow">Check-out by</div>
          <div className="gb-departure-time-value">{formatted}</div>
        </div>
      )}

      {guidebook.checkout_text && (
        <article className="gb-arrival-card gb-arrival-card--full">
          <div className="gb-arrival-icon" aria-hidden><Emoji name="key" /></div>
          <h3 className="gb-arrival-title">Check-out instructions</h3>
          <div className="gb-prose" dangerouslySetInnerHTML={{ __html: guidebook.checkout_text }} />
        </article>
      )}

      {checklist.length > 0 && (
        <article className="gb-arrival-card gb-arrival-card--full gb-checklist-card">
          <header className="gb-checklist-head">
            <div>
              <h3 className="gb-arrival-title">Departure checklist</h3>
              <p className="gb-checklist-sub">{done} of {total} done</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost gb-checklist-reset"
              onClick={reset}
              disabled={done === 0}
            >
              Reset
            </button>
          </header>

          <div
            className="gb-checklist-progress"
            role="progressbar"
            aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
            aria-label={`Departure checklist progress: ${pct}%`}
          >
            <div className="gb-checklist-progress-fill" style={{ width: `${pct}%` }} />
          </div>

          <ul className="gb-checklist">
            {checklist.map(item => {
              const isOn = !!checked[item.id];
              const inputId = `gb-check-${item.id}`;
              return (
                <li key={item.id} className={`gb-checklist-item ${isOn ? 'is-done' : ''}`}>
                  <label htmlFor={inputId} className="gb-checklist-label">
                    <input
                      id={inputId}
                      type="checkbox"
                      className="gb-checklist-input"
                      checked={isOn}
                      onChange={() => toggle(item.id)}
                    />
                    <span className="gb-checklist-box" aria-hidden>
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8l3 3 7-7" />
                      </svg>
                    </span>
                    {item.icon && (
                      <span className="gb-checklist-emoji" aria-hidden><Emoji name={item.icon} /></span>
                    )}
                    <span className="gb-checklist-text">{item.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>

          {allDone && (
            <div className="gb-checklist-done">
              <span className="gb-checklist-done-emoji" aria-hidden>🌅</span>
              <span>Safe travels — thank you for staying with us.</span>
            </div>
          )}
        </article>
      )}
    </section>
  );
}
