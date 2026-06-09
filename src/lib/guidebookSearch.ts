/**
 * guidebookSearch -- build + query a Fuse.js index over the
 * guidebook's content surface. Powers the ⌘K modal from PR #7.
 *
 * One doc per WiFi credential, address, host contact, manual card,
 * recommendation, and emergency contact (hospital + armed-response).
 *
 * No analytics — per §10.4 we DO NOT log queries in v1.
 */

import Fuse from 'fuse.js';
import type { Guidebook, Manual } from './guidebookShared';
import { toCanonicalCategory } from './guidebookTaxonomy';

export type SearchDoc = {
  id: string;
  kind: 'wifi' | 'address' | 'host' | 'manual' | 'recommendation' | 'emergency' | 'checkin';
  title: string;
  body: string;          // stripped of HTML
  category?: string;     // for source attribution (e.g. "House Manual → Safety")
  source: string;        // human-friendly source label
  /** In-page hash on the main guidebook (`#anchor`) or a full path to a
   *  different route (e.g. `/g/:slug/emergency`). The modal navigates
   *  accordingly and scrolls/highlights the anchor on the same page. */
  href: string;
  /** Glyph hint for the result row — name maps to <Icon> + <Emoji>. */
  icon: string;
};

type Recommendation = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  address: string | null;
};

function strip(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildSearchIndex(
  guidebook: Guidebook,
  manuals: Manual[],
  recommendations: Recommendation[],
): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const slug = guidebook.slug;

  // WiFi
  if (guidebook.wifi_ssid || guidebook.wifi_password) {
    docs.push({
      id: 'wifi',
      kind: 'wifi',
      title: 'WiFi password',
      body: [guidebook.wifi_ssid, guidebook.wifi_password, guidebook.wifi_notes]
        .filter(Boolean).join(' · '),
      source: 'Arrival',
      href: `#arrival`,
      icon: 'wifi',
    });
  }

  // Address
  const addrParts = [
    [guidebook.street_number, guidebook.street_name].filter(Boolean).join(' '),
    guidebook.city, guidebook.postal_code,
  ].filter(Boolean);
  if (addrParts.length > 0) {
    docs.push({
      id: 'address',
      kind: 'address',
      title: 'Property address',
      body: addrParts.join(', '),
      source: 'Arrival',
      href: `#arrival`,
      icon: 'map',
    });
  }

  // Host
  if (guidebook.host_name || guidebook.host_phone) {
    docs.push({
      id: 'host',
      kind: 'host',
      title: `Contact ${guidebook.host_name || 'your host'}`,
      body: [guidebook.host_name, guidebook.host_phone, 'call', 'whatsapp', 'message'].filter(Boolean).join(' '),
      source: 'Home',
      href: `#home`,
      icon: 'phone',
    });
  }

  // Check-in / check-out timing
  if (guidebook.checkin_text) {
    docs.push({
      id: 'checkin',
      kind: 'checkin',
      title: 'Check-in',
      body: strip(guidebook.checkin_text),
      source: 'Arrival',
      href: `#arrival`,
      icon: 'clock',
    });
  }
  // Manuals
  for (const m of manuals) {
    const canonical = toCanonicalCategory(m.category) || (m.category || 'Manual');
    docs.push({
      id: `manual:${m.id}`,
      kind: 'manual',
      title: m.title,
      body: strip(m.body_html),
      category: canonical,
      source: `House Manual → ${canonical}`,
      href: `#stay`,
      icon: m.icon || 'home',
    });
  }

  // Recommendations
  for (const r of recommendations) {
    docs.push({
      id: `rec:${r.id}`,
      kind: 'recommendation',
      title: r.name,
      body: strip(r.description) + ' ' + (r.address || ''),
      category: r.category || undefined,
      source: r.category ? `Explore → ${r.category}` : 'Explore',
      href: `#explore`,
      icon: 'map',
    });
  }

  // Emergency contacts (per-property only — national SA lines removed
  // per Nicki; the Emergency page leads with SE's own contacts).
  if (guidebook.nearest_hospital_name) {
    docs.push({
      id: 'hospital',
      kind: 'emergency',
      title: guidebook.nearest_hospital_name,
      body: [guidebook.nearest_hospital_phone, guidebook.nearest_hospital_address, 'hospital', 'ambulance', 'medical'].filter(Boolean).join(' '),
      source: 'Emergency → Nearest hospital',
      href: `/g/${slug}/emergency`,
      icon: 'hospital',
    });
  }
  if (guidebook.armed_response_company) {
    docs.push({
      id: 'armed-response',
      kind: 'emergency',
      title: guidebook.armed_response_company,
      body: [guidebook.armed_response_phone, 'security', 'armed response', 'panic'].filter(Boolean).join(' '),
      source: 'Emergency → Armed response',
      href: `/g/${slug}/emergency`,
      icon: 'shield',
    });
  }

  return docs;
}

export function createSearchEngine(docs: SearchDoc[]) {
  return new Fuse(docs, {
    keys: [
      { name: 'title',    weight: 0.5 },
      { name: 'body',     weight: 0.3 },
      { name: 'category', weight: 0.2 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 1,
  });
}

/** Returns the top N results for a query. Empty query returns the
 *  "suggested" set (WiFi, address, host, emergency, check-out, recs). */
export function search(
  engine: Fuse<SearchDoc>,
  docs: SearchDoc[],
  query: string,
  limit = 20,
): SearchDoc[] {
  const q = query.trim();
  if (!q) {
    const suggestedKinds: SearchDoc['kind'][] = ['wifi', 'address', 'host', 'emergency', 'recommendation'];
    const buckets = new Map<string, SearchDoc>();
    for (const d of docs) {
      // One per kind for the suggested bucket — keep it compact.
      if (suggestedKinds.includes(d.kind) && !buckets.has(d.kind)) {
        buckets.set(d.kind, d);
      }
    }
    return Array.from(buckets.values()).slice(0, 6);
  }
  return engine.search(q, { limit }).map(r => r.item);
}
