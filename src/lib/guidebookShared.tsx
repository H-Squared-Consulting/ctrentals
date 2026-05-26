/**
 * guidebookShared -- shared types, helpers and small components
 * used across the public guidebook surface (GuidebookPage,
 * GuidebookEmergencyPage, etc).
 *
 * Kept colocated rather than split into separate files because the
 * pieces are tightly coupled (Icon names, phone helpers, map embed
 * all power the same handful of components).
 */

import { useEffect, useRef, useState } from 'react';

/* ───────────────────────── Types ─────────────────────────────── */

/** Single departure-checklist item. `id` is stable per item so the
 *  per-device localStorage state survives label edits. */
export type ChecklistItem = {
  id:    string;
  label: string;
  icon?: string;
};

export type Guidebook = {
  id: string;
  slug: string;
  property_name: string;
  host_name: string | null;
  host_phone: string | null;
  host_photo_url: string | null;
  welcome_html: string | null;
  street_name: string | null;
  street_number: string | null;
  city: string | null;
  country_code: string | null;
  postal_code: string | null;
  hero_image_url: string | null;
  checkin_text: string | null;
  directions_text: string | null;
  parking_text: string | null;
  wifi_ssid: string | null;
  wifi_password: string | null;
  wifi_notes: string | null;
  checkout_text: string | null;
  checkout_time: string | null;
  /** Ordered array of departure checklist items: { id, label, icon? }. */
  checkout_checklist: ChecklistItem[] | null;
  lat: number | null;
  lng: number | null;
  // Emergency fields (PR #1).
  armed_response_company: string | null;
  armed_response_phone: string | null;
  nearest_hospital_name: string | null;
  nearest_hospital_phone: string | null;
  nearest_hospital_address: string | null;
  nearest_hospital_lat: number | null;
  nearest_hospital_lng: number | null;
};

export type Manual = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  body_html: string | null;
  icon: string | null;
  image_url: string | null;
  emergency_tag: string | null;
  position: number;
};

/* ─────────────────── Address + phone helpers ──────────────────── */

export function fullAddress(g: Pick<Guidebook, 'street_number' | 'street_name' | 'city' | 'postal_code'>): string {
  const parts = [
    [g.street_number, g.street_name].filter(Boolean).join(' '),
    g.city,
    g.postal_code,
  ].filter(Boolean);
  return parts.join(', ');
}

/** Returns just the digits in a phone string, or empty if the input
 *  looks like a placeholder (contains letters). */
export function phoneDigits(raw: string | null | undefined): string {
  if (!raw) return '';
  if (/[A-Za-z]/.test(raw)) return '';
  return raw.replace(/\D/g, '');
}
export function telHref(raw: string | null | undefined): string | null {
  const d = phoneDigits(raw);
  return d ? `tel:+${d}` : null;
}
export function waHref(raw: string | null | undefined): string | null {
  const d = phoneDigits(raw);
  return d ? `https://wa.me/${d}` : null;
}

export function formatCheckoutTime(t: string | null): string {
  if (!t) return '';
  const [hStr, mStr] = t.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  if (isNaN(h)) return '';
  const period = h >= 12 ? 'pm' : 'am';
  const display = h % 12 === 0 ? 12 : h % 12;
  return m ? `${display}:${String(m).padStart(2, '0')}${period}` : `${display}${period}`;
}

/* ───────────────────────── Emoji ─────────────────────────────── *
 * Decorative emoji used in category badges, card icons, placeholders
 * — keeps the look consistent with the rest of the admin platform
 * (sidebar 🏠 📩 🏘 etc). Functional UI (FAB, button icons, copy)
 * still uses the inline-SVG <Icon> below because emoji don't tint to
 * currentColor and can't go white-on-coloured-button reliably.
 */
const EMOJI: Record<string, string> = {
  'key':              '🔑',
  'map':              '📍',
  'car':              '🚗',
  'wifi':             '📶',
  'clock':            '🕘',
  'home':             '🏠',
  'bolt':             '⚡️',
  'shopping-cart':    '🛒',
  'washing-machine':  '🧺',
  'alert':            '⚠️',
  'sun':              '☀️',
  'pool':             '🏊',
  'phone':            '📞',
  'message':          '💬',
  'hospital':         '🏥',
  'shield':           '🛡️',
  'gas':              '🔥',
  'water':            '💧',
};

export function Emoji({ name, label }: { name: string; label?: string }) {
  const glyph = EMOJI[name] || '•';
  return (
    <span className="gb-emoji" role="img" aria-label={label || name}>
      {glyph}
    </span>
  );
}

/* ───────────────────────── Icon ──────────────────────────────── */

export function Icon({ name }: { name: string }) {
  const common = {
    width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.6,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'key':            return <svg {...common}><circle cx="9" cy="14" r="4"/><path d="M13 13l8-8"/><path d="M19 7l2 2"/></svg>;
    case 'map':            return <svg {...common}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
    case 'car':            return <svg {...common}><path d="M3 13l2-6h14l2 6"/><path d="M3 13v5h2v-2h14v2h2v-5"/><circle cx="7" cy="15" r="1.5"/><circle cx="17" cy="15" r="1.5"/></svg>;
    case 'wifi':           return <svg {...common}><path d="M5 12a10 10 0 0114 0"/><path d="M8.5 15.5a5 5 0 017 0"/><circle cx="12" cy="19" r="1"/></svg>;
    case 'clock':          return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case 'home':           return <svg {...common}><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1z"/></svg>;
    case 'bolt':           return <svg {...common}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>;
    case 'shopping-cart':  return <svg {...common}><path d="M3 4h2l2 12h11l2-8H7"/><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/></svg>;
    case 'washing-machine':return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><circle cx="8" cy="6.5" r="0.6" fill="currentColor"/><circle cx="11" cy="6.5" r="0.6" fill="currentColor"/></svg>;
    case 'alert':          return <svg {...common}><path d="M12 3l10 17H2L12 3z"/><path d="M12 10v5"/><circle cx="12" cy="18" r="0.6" fill="currentColor"/></svg>;
    case 'sun':            return <svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>;
    case 'pool':           return <svg {...common}><path d="M2 18c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1"/><path d="M2 14c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1"/><path d="M7 12V6a3 3 0 016 0v6"/></svg>;
    case 'phone':          return <svg {...common}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z"/></svg>;
    case 'message':        return <svg {...common}><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>;
    case 'copy':           return <svg {...common}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>;
    case 'hospital':       return <svg {...common}><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M9 3h6v3H9z"/><path d="M12 11v6M9 14h6"/></svg>;
    case 'shield':         return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    case 'gas':            return <svg {...common}><path d="M8 14a4 4 0 008 0c0-3-4-6-4-12 0 4-4 9-4 12z"/></svg>;
    case 'water':          return <svg {...common}><path d="M12 2.5C8 8 5 12 5 15a7 7 0 0014 0c0-3-3-7-7-12.5z"/></svg>;
    case 'arrow-left':     return <svg {...common}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>;
    default:               return <svg {...common}><circle cx="12" cy="12" r="9"/></svg>;
  }
}

/* ───────────────────── Map embed ─────────────────────────────── *
 * Uses Mapbox GL JS when VITE_MAPBOX_TOKEN is configured (the
 * canonical choice per §10.1). Otherwise falls back to a Google Maps
 * iframe embed so the demo still renders without a token. Either way
 * the navigate CTAs deep-link to Google Maps (also per §10.1). */

const MAPBOX_TOKEN = (import.meta as any).env?.VITE_MAPBOX_TOKEN as string | undefined;

export function MapEmbed({
  lat, lng, label, height = 260,
}: { lat: number; lng: number; label: string; height?: number }) {
  if (MAPBOX_TOKEN) {
    return <MapboxMap lat={lat} lng={lng} label={label} height={height} token={MAPBOX_TOKEN} />;
  }
  // Fallback — Google Maps embed iframe. Works without an API key for
  // basic q=<lat>,<lng> queries; renders the standard Google map UI.
  return (
    <iframe
      title={`Map showing ${label}`}
      src={`https://maps.google.com/maps?q=${lat},${lng}&z=15&hl=en&output=embed`}
      width="100%"
      height={height}
      style={{ border: 0, borderRadius: 10, display: 'block' }}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

function MapboxMap({
  lat, lng, label, height, token,
}: { lat: number; lng: number; label: string; height: number; token: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    let map: any;
    let cancelled = false;
    (async () => {
      // Dynamic import so non-guidebook routes don't pay the bundle cost.
      const mod = await import('mapbox-gl');
      await import('mapbox-gl/dist/mapbox-gl.css' as any).catch(() => {});
      if (cancelled || !containerRef.current) return;
      (mod as any).default.accessToken = token;
      map = new (mod as any).default.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [lng, lat],
        zoom: 14,
        attributionControl: true,
      });
      new (mod as any).default.Marker({ color: '#0F4C75' })
        .setLngLat([lng, lat])
        .addTo(map);
    })();
    return () => {
      cancelled = true;
      if (map) try { map.remove(); } catch {}
    };
  }, [lat, lng, token]);

  return (
    <div
      ref={containerRef}
      aria-label={`Map showing ${label}`}
      style={{ width: '100%', height, borderRadius: 10, overflow: 'hidden' }}
    />
  );
}

/** True when the runtime has a Mapbox access token configured. The
 *  Recommendations Map view hides itself when this is false (List
 *  view is still fine without a token). */
export const HAS_MAPBOX_TOKEN = !!MAPBOX_TOKEN;

/* ── Multi-pin map for the Recommendations section ─────────────── *
 * Renders a Mapbox GL JS map centred on the property with one pin
 * per recommendation. Tapping a pin opens a small popover (mobile
 * bottom-sheet, desktop floating). A "Show on map" deep-link on each
 * list card calls focusPin(slug) via the imperative ref.
 */
export type RecPin = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  address: string | null;
  website: string | null;
  lat: number;
  lng: number;
};

export type RecMapHandle = {
  focusPin: (slug: string) => void;
};

export function RecMap({
  center, pins, onPinSelect, mapRef, height = 480,
}: {
  center: { lat: number; lng: number };
  pins: RecPin[];
  onPinSelect?: (rec: RecPin) => void;
  mapRef?: React.MutableRefObject<RecMapHandle | null>;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return;
    let cancelled = false;
    (async () => {
      const mod = await import('mapbox-gl');
      await import('mapbox-gl/dist/mapbox-gl.css' as any).catch(() => {});
      if (cancelled || !containerRef.current) return;
      const mb = (mod as any).default;
      mb.accessToken = MAPBOX_TOKEN;
      const map = new mb.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [center.lng, center.lat],
        zoom: 11,
        attributionControl: true,
      });
      map.addControl(new mb.NavigationControl({ showCompass: false }), 'top-right');
      mapInstanceRef.current = map;

      // Property marker — different colour so it reads as "home".
      new mb.Marker({ color: '#0F4C75' })
        .setLngLat([center.lng, center.lat])
        .addTo(map);

      // Rec pins — gold so they stand out against the streets style.
      for (const pin of pins) {
        const m = new mb.Marker({ color: '#D97706' })
          .setLngLat([pin.lng, pin.lat])
          .addTo(map);
        m.getElement().addEventListener('click', () => {
          onPinSelect?.(pin);
        });
        m.getElement().setAttribute('aria-label', pin.name);
        m.getElement().style.cursor = 'pointer';
        markersRef.current[pin.slug] = m;
      }

      if (mapRef) {
        mapRef.current = {
          focusPin(slug: string) {
            const m = markersRef.current[slug];
            if (!m) return;
            const lngLat = m.getLngLat();
            map.flyTo({ center: lngLat, zoom: 13, duration: 700 });
            const pin = pins.find(p => p.slug === slug);
            if (pin) onPinSelect?.(pin);
          },
        };
      }
    })();
    return () => {
      cancelled = true;
      try { mapInstanceRef.current?.remove(); } catch {}
      mapInstanceRef.current = null;
      markersRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, pins.length]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="gb-recmap-empty">
        Map view requires a Mapbox token. Set <code>VITE_MAPBOX_TOKEN</code> in your env to enable it.
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="gb-recmap"
      style={{ width: '100%', height }}
      role="region"
      aria-label="Recommendations map"
    />
  );
}

/* ─────────────────── Persistent guest-page chrome ─────────────── *
 * Two pieces, both fixed-position so they survive scroll + route
 * change inside the guidebook surface:
 *   - Emergency FAB (bottom-right on mobile, top-right corner chip on
 *     desktop). Always visible. Red. Single tap to /g/:slug/emergency.
 *   - Host-contact chip (bottom-left on mobile after user scrolls past
 *     hero; small top-right chip on desktop). Avatar + Call + WhatsApp.
 */

export function GuidebookChrome({
  guidebook, hideEmergencyOnEmergencyPage = false, searchData,
}: {
  guidebook: Pick<Guidebook, 'slug' | 'host_name' | 'host_phone' | 'host_photo_url'>;
  hideEmergencyOnEmergencyPage?: boolean;
  /** When provided, mounts the ⌘K search modal at the page root and
   *  listens for the global `gb-search:open` event + keyboard shortcuts. */
  searchData?: import('../components/GuidebookSearchModal').GuidebookSearchData | null;
}) {
  // Dynamic import keeps the modal out of the JS bundle until needed.
  const [SearchModal, setSearchModal] = useState<React.ComponentType<{ data: any }> | null>(null);
  useEffect(() => {
    if (!searchData) return;
    import('../components/GuidebookSearchModal').then(mod => setSearchModal(() => mod.default));
  }, [!!searchData]);

  return (
    <>
      {!hideEmergencyOnEmergencyPage && <EmergencyFab slug={guidebook.slug} />}
      <HostContactChip guidebook={guidebook} />
      {SearchModal && <SearchModal data={searchData} />}
    </>
  );
}

/** Small pill placed in the sticky nav. Tap fires the global open
 *  event so the modal (mounted by GuidebookChrome) handles state. */
export function GuidebookSearchPill() {
  function open() {
    window.dispatchEvent(new CustomEvent('gb-search:open'));
  }
  return (
    <button
      type="button"
      className="gb-search-pill"
      onClick={open}
      aria-label="Search the guidebook"
    >
      <span aria-hidden>🔍</span>
      <span className="gb-search-pill-label">Search</span>
      <span className="gb-search-pill-kbd" aria-hidden>⌘K</span>
    </button>
  );
}

function EmergencyFab({ slug }: { slug: string }) {
  return (
    <a
      className="gb-fab gb-fab--emergency"
      href={`/g/${slug}/emergency`}
      aria-label="Emergency contacts and shut-offs"
    >
      <Icon name="alert" />
      <span className="gb-fab-label">Emergency</span>
    </a>
  );
}

function HostContactChip({
  guidebook,
}: {
  guidebook: Pick<Guidebook, 'host_name' | 'host_phone' | 'host_photo_url'>;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 480);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const tel = telHref(guidebook.host_phone);
  const wa  = waHref(guidebook.host_phone);
  if (!tel && !wa) return null;
  const firstName = (guidebook.host_name || '').split(' ')[0] || 'host';
  const initials = (guidebook.host_name || 'SE').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className={`gb-host-chip ${visible ? 'is-visible' : ''}`} role="region" aria-label="Contact host">
      <div className="gb-host-chip-avatar" aria-hidden>
        {guidebook.host_photo_url
          ? <img src={guidebook.host_photo_url} alt="" />
          : <span>{initials}</span>}
      </div>
      <span className="gb-host-chip-name">{firstName}</span>
      {tel && (
        <a className="gb-host-chip-action" href={tel} aria-label={`Call ${firstName}`}>
          <Icon name="phone" />
        </a>
      )}
      {wa && (
        <a className="gb-host-chip-action gb-host-chip-action--wa" href={wa} target="_blank" rel="noopener noreferrer" aria-label={`Message ${firstName} on WhatsApp`}>
          <Icon name="message" />
        </a>
      )}
    </div>
  );
}
