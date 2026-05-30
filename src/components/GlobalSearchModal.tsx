/**
 * GlobalSearchModal — universal "what am I looking for?" surface.
 *
 * Reachable from THREE entry points (all routed through
 * globalSearchEvents so the modal lives in a single mount point):
 *   1. Top-right search pill in the layout                  (always visible)
 *   2. FAB → "Search properties" action                     (intentional pick)
 *   3. ⌘K / Ctrl+K shortcut from anywhere on the platform    (power user)
 *
 * Phase 1 (this commit) ships the SHELL — the modal frame, the
 * search input header, and the scope tabs. Per-scope filter UI
 * + the actual querying are wired in phase 2 onwards. We render a
 * clear "Filters arrive in the next update" placeholder so the
 * empty state doesn't look broken in the meantime.
 *
 * Reusable by design: scope tabs are data-driven, the body content
 * is keyed off the active scope so a future phase plugs in a real
 * results component without touching the modal chrome.
 *
 * Styling: piggybacks on ActionModal (the same shell PricingModal +
 * SendProposalDialog use) so it matches the rest of the platform
 * out of the box.
 */

import { useEffect, useMemo, useState } from 'react';
import ActionModal from './ActionModal';
import NumericMultiSelect from './NumericMultiSelect';
import NightCount from './NightCount';
import PriceBucketFilter from './PriceBucketFilter';
import type { TierKey } from '../lib/priceTiers';
import { useAuth } from '../contexts/AuthContext';
import { useModalStack } from '../contexts/ModalStackContext';
import { searchProperties, type PropertySearchFilters, type PropertyResult } from '../lib/propertySearch';
import {
  fetchAmenityCatalog,
  catalogHas,
  suggestAmenities,
  type AmenityCatalogEntry,
} from '../lib/amenitiesCatalog';
import { fetchPriceTiers, computeDefaultTiers } from '../lib/priceTiers';
import { peakGuestRateForChannel } from '../lib/displayRate';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

/** Preset "common" amenities surfaced as quick-add chips above the
 *  typeahead. These are the seven Hayley + the team flagged as
 *  "the ones they actually filter on"; we intersect them with the
 *  live catalog at render time so chips never advertise an amenity
 *  no property actually has. Anything else gets added via the
 *  typeahead, but ONLY if it's present somewhere in the catalog. */
const COMMON_AMENITIES = [
  'Aircon',
  'Heated Pool',
  'Tennis court',
  'Padel Court',
  'Jacuzzi',
  'Hot Tub',
  'Sun loungers',
];

/** Scope = which entity the search is currently looking at. Listed
 *  in order = render order across the top of the modal. Only
 *  'properties' has UI today; the rest are stubbed so the wire is
 *  in place for later phases. */
export type SearchScope = 'properties' | 'enquiries' | 'proposals' | 'bookings' | 'guests';

interface ScopeDef {
  key: SearchScope;
  label: string;
  icon: string;
  enabled: boolean;
}

const SCOPES: ScopeDef[] = [
  { key: 'properties', label: 'Properties', icon: '🏠', enabled: true },
  { key: 'enquiries',  label: 'Enquiries',  icon: '💬', enabled: false },
  { key: 'proposals',  label: 'Proposals',  icon: '📝', enabled: false },
  { key: 'bookings',   label: 'Bookings',   icon: '📅', enabled: false },
  { key: 'guests',     label: 'Guests',     icon: '👤', enabled: false },
];

interface Props {
  /** Scope to highlight on open. Defaults to 'properties'. */
  initialScope?: SearchScope;
  onClose: () => void;
}

/** Which channel the team is searching against. Drives the price
 *  tier math (each channel turns the baseline into a different
 *  "guest pays" figure) and labels the result set so the user
 *  always knows which side of the deal they're looking at. Until
 *  the user picks one, the rest of the filter form is hidden. */
export type SearchChannel = 'direct' | 'agent' | 'platform';

export interface PropertyFilters {
  /** Null = not yet chosen → only the channel picker is rendered;
   *  the rest of the form (bedrooms, amenities, etc) stays hidden. */
  channel: SearchChannel | null;
  bedrooms: number[];
  amenities: string[];
  /** Free-text being typed in the amenity custom input; tracked so
   *  Enter / + Add can flush it into `amenities` without losing
   *  the in-progress value on re-render. */
  amenityDraft: string;
  checkIn: string;
  checkOut: string;
  /** Selected price tier(s). Multi-select — picking more than one
   *  collapses to a single range running from the floor of the
   *  lowest selected tier to the ceiling of the highest selected
   *  tier (so Very low + High silently includes Low + Medium too).
   *  Empty array = no price filter. */
  priceTiers: TierKey[];
}

const EMPTY_PROPERTY_FILTERS: PropertyFilters = {
  channel: null,
  bedrooms: [],
  amenities: [],
  amenityDraft: '',
  checkIn: '',
  checkOut: '',
  priceTiers: [],
};

const CHANNEL_OPTIONS: { key: SearchChannel; label: string; icon: string; description: string }[] = [
  { key: 'direct',   label: 'Direct',   icon: '👤', description: 'Guest enquiry, no agent' },
  { key: 'agent',    label: 'Agent',    icon: '🤝', description: 'Booked via a partner agent' },
  { key: 'platform', label: 'Platform', icon: '🌐', description: 'Airbnb / Booking.com / etc.' },
];

export default function GlobalSearchModal({ initialScope = 'properties', onClose }: Props) {
  const { supabase } = useAuth();
  // Register in the modal stack so DealDetailModal (or any other
  // primary surface in future) knows we're on screen. When a deal
  // is already open, that signal flips this modal into the side-
  // docked layout below.
  const modalStack = useModalStack();
  useEffect(() => {
    if (!modalStack) return;
    modalStack.setSearchOpen(true);
    return () => modalStack.setSearchOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Any primary modal (deal card, enquiry form) on screen → dock
  // to the side instead of stacking on top of it.
  const primaryAlsoOpen = !!modalStack?.primaryOpen;
  const placement: 'center' | 'right' = primaryAlsoOpen ? 'right' : 'center';
  const focusedKey = modalStack?.focused;
  const isFaded = primaryAlsoOpen && focusedKey !== 'search';
  const focusSelf = () => modalStack?.focus('search');

  // Scope is properties-only today (Enquiries / Proposals / Bookings /
  // Guests were always coming-soon stubs). Kept as a state in case
  // future scopes plug in; not user-toggleable in the UI any more.
  const [scope] = useState<SearchScope>(initialScope);
  const [propertyFilters, setPropertyFilters] = useState<PropertyFilters>(EMPTY_PROPERTY_FILTERS);
  // Live amenity catalog — the set of amenities currently used on
  // at least one published property. The amenities filter restricts
  // itself to this list (no inventing tags that match nothing). We
  // fetch once on modal mount; the result is small (<100 strings).
  const [amenityCatalog, setAmenityCatalog] = useState<AmenityCatalogEntry[]>([]);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    fetchAmenityCatalog(supabase)
      .then(entries => { if (!cancelled) setAmenityCatalog(entries); })
      .catch(err => console.error('fetchAmenityCatalog failed:', err));
    return () => { cancelled = true; };
  }, [supabase]);

  // Pre-warm the price-tier cache the moment the modal mounts so
  // by the time the user picks a channel the chips render with
  // their R-ranges instantly instead of sitting in "loading…".
  // Kicks off the saved-tiers read + a default-derive for each
  // channel in parallel; results land in the priceTiers module
  // cache and PriceBucketFilter consumes them with no extra wait.
  useEffect(() => {
    if (!supabase) return;
    fetchPriceTiers(supabase).then(() => {
      return Promise.all([
        computeDefaultTiers(supabase, 'direct'),
        computeDefaultTiers(supabase, 'agent'),
        computeDefaultTiers(supabase, 'platform'),
      ]);
    }).catch(err => console.warn('Tier prefetch failed (non-fatal):', err));
  }, [supabase]);
  /** Two-pane modal: 'filters' (default) ↔ 'results'. Search runs
   *  on the transition to 'results'; ← Back returns to the same
   *  filters the user had so they can refine without losing
   *  their place. Keeping it inside the modal (vs navigating
   *  away) means the rest of the platform isn't disturbed. */
  const [view, setView] = useState<'filters' | 'results'>('filters');
  const [results, setResults] = useState<PropertyResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** Snapshot of the filters that produced the current `results`.
   *  Used for the results-pane summary line so it always reads
   *  what was actually queried, not what's in the live form. */
  const [resultFilters, setResultFilters] = useState<PropertyFilters | null>(null);

  async function executeSearch() {
    if (!supabase || searching) return;
    setSearching(true);
    setSearchError(null);
    setView('results');
    setResultFilters(propertyFilters);
    try {
      const apiFilters: PropertySearchFilters = {
        bedrooms: propertyFilters.bedrooms.length > 0 ? propertyFilters.bedrooms : undefined,
        amenities: propertyFilters.amenities.length > 0 ? propertyFilters.amenities : undefined,
        checkIn: propertyFilters.checkIn || undefined,
        checkOut: propertyFilters.checkOut || undefined,
        channel: propertyFilters.channel ?? undefined,
        priceTiers: propertyFilters.priceTiers.length > 0 ? propertyFilters.priceTiers : undefined,
      };
      const rows = await searchProperties(supabase, apiFilters);
      setResults(rows);
    } catch (err: any) {
      console.error('Property search failed:', err);
      setSearchError(err?.message || 'Search failed');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  // Title / subtitle / width all adapt to the active view. Results
  // view uses a wider modal so the .property-card grid has space
  // to render two columns side-by-side without compressing.
  const isResults = view === 'results';
  const modalTitle = isResults ? 'Matching properties' : 'Find matching properties';
  const modalSubtitle = isResults
    ? <span style={{ color: 'var(--text-secondary)' }}>{searching ? 'Searching…' : `${results.length} match${results.length === 1 ? '' : 'es'} for your filters.`}</span>
    : <span style={{ color: 'var(--text-secondary)' }}>Narrow by bedrooms, amenities, dates, or price tier.</span>;
  // Side-docked layout has its own width from the CSS class
  // (.action-modal--side @ 480px). Center placement uses the
  // wider results-friendly sizing.
  const modalWidth = placement === 'right' ? 480 : (isResults ? 900 : 720);

  return (
    <ActionModal
      title={modalTitle}
      subtitle={modalSubtitle}
      width={modalWidth}
      placement={placement}
      faded={isFaded}
      onActivate={focusSelf}
      /* The search modal is the SOURCE of the side-dock — it
       * should never auto-shift itself based on `searchOpen`
       * (which is always true while it's mounted). Pin to false. */
      shifted={false}
      /* Don't count the search modal itself in the centered-
       * primary stack — that count is what tells the search where
       * to place itself, so self-registering would loop. */
      skipStackRegister
      hideFooter
      onClose={onClose}
    >
      {isResults ? (
        <ResultsPane
          results={results}
          error={searchError}
          searching={searching}
          filters={resultFilters}
          onBack={() => setView('filters')}
          onClose={onClose}
        />
      ) : (
        // Only properties is supported today. The free-text input
        // and scope tabs are gone — channel is the entry point and
        // the PropertyFiltersBlock handles the rest of the form.
        <PropertyFiltersBlock
          filters={propertyFilters}
          onChange={setPropertyFilters}
          onReset={() => setPropertyFilters({ ...EMPTY_PROPERTY_FILTERS, channel: propertyFilters.channel })}
          onSearch={executeSearch}
          amenityCatalog={amenityCatalog}
        />
      )}
    </ActionModal>
  );
}

/** Results pane — second "page" inside the same modal. Renders
 *  matches as compact property cards using the same .property-card
 *  / .property-grid CSS classes the main Properties grid uses, so
 *  the visual rhythm is consistent across the platform. ← Back
 *  returns to the filter view with the user's inputs preserved. */
function ResultsPane({
  results, error, searching, filters, onBack, onClose,
}: {
  results: PropertyResult[];
  error: string | null;
  searching: boolean;
  filters: PropertyFilters | null;
  onBack: () => void;
  onClose: () => void;
}) {
  // Airbnb-copy preview modal state. Opens on the Copy Airbnb links
  // button so the team can sanity-check the property list (title +
  // URL per row) before pasting into the Airbnb reply.
  const [airbnbPreviewOpen, setAirbnbPreviewOpen] = useState(false);
  const withAirbnb = results.filter(r => !!r.airbnbUrl);
  const withoutAirbnb = results.length - withAirbnb.length;
  useEffect(() => { setAirbnbPreviewOpen(false); }, [results]);

  return (
    <div>
      {/* Header row: ← Back to refine + a compact summary of what
          was searched. Sticky-ish at the top so the user always
          has a clear path back to the filter UI. */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 'var(--s-3)',
        flexWrap: 'wrap',
      }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: '0.8125rem' }}
          onClick={onBack}
        >
          ← Refine filters
        </button>
        {filters && (
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            textAlign: 'right',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {summariseFiltersInline(filters) || 'no filters'}
          </div>
        )}
      </div>

      {/* Big, obvious Airbnb CTA. Lives on its own row above the result
          grid so it's the second thing the eye reaches after "← Refine
          filters" — for the dumbest user, this is the one button that
          answers "I'm replying to an Airbnb enquiry, what now?". Hidden
          when there are no results or no result has an Airbnb URL on
          file. */}
      {!searching && withAirbnb.length > 0 && (
        <div style={{
          marginBottom: 'var(--s-3)',
          background: 'var(--color-primary-bg)',
          border: '1px solid var(--color-primary)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 auto' }}>
            <span style={{ fontSize: '1.5rem', lineHeight: 1, flexShrink: 0 }} aria-hidden>📋</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                Replying to an Airbnb enquiry?
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                Hand the guest a paste-ready block of Airbnb links for these matches.
                {withoutAirbnb > 0 && (
                  <span style={{ color: 'var(--text-light)' }}>
                    {' · '}{withoutAirbnb} skipped (no Airbnb URL on file).
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: '0.875rem', padding: '8px 16px', flexShrink: 0 }}
            onClick={() => setAirbnbPreviewOpen(true)}
          >
            📋 Copy Airbnb links ({withAirbnb.length})
          </button>
        </div>
      )}

      {searching && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Searching the portfolio…
        </div>
      )}

      {!searching && error && (
        <div style={{
          padding: 12,
          border: '1px dashed var(--error, #DC2626)',
          background: 'var(--error-bg, #FEE2E2)',
          color: 'var(--error, #DC2626)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.8125rem',
        }}>
          Search failed: {error}
        </div>
      )}

      {!searching && !error && results.length === 0 && (
        <div style={{
          padding: '40px 16px',
          textAlign: 'center',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-secondary)',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }} aria-hidden>🔍</div>
          <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
            No properties match
          </div>
          <div style={{ fontSize: '0.8125rem' }}>
            Try widening the bedrooms range, clearing the dates, or dropping an amenity.
          </div>
        </div>
      )}

      {!searching && !error && results.length > 0 && (
        // Reuses the global .property-grid / .property-card CSS so
        // the result tiles look identical to the main Properties
        // page — same scanning rhythm across the platform.
        <div className="property-grid">
          {results.map(p => (
            <ResultCard
              key={p.id}
              property={p}
              channel={filters?.channel ?? null}
              onClose={onClose}
            />
          ))}
        </div>
      )}
      {airbnbPreviewOpen && (
        <AirbnbLinksPreviewModal
          properties={withAirbnb}
          skippedCount={withoutAirbnb}
          onClose={() => setAirbnbPreviewOpen(false)}
        />
      )}
    </div>
  );
}

/** Preview-and-copy modal for the Copy Airbnb links action.
 *  Three editable surfaces stacked top-to-bottom:
 *    1. Greeting + intro line (free-text — agents can localise per guest)
 *    2. Property picker (every matched property with an Airbnb URL is
 *       pre-checked; user can untick what they don't want to send)
 *    3. Live preview of the exact block that will go to the clipboard
 *  Forced centre placement + skipStackRegister so the parent search
 *  modal doesn't side-dock relative to this — the preview should
 *  always feel like the focused modal.
 *
 *  Exported because the new-enquiry form reuses this same picker as
 *  the primary post-save action on platform (Airbnb/VRBO) enquiries —
 *  the team gets to send the guest's links AND save the enquiry
 *  record in one button click instead of via two surfaces. */
export function AirbnbLinksPreviewModal({
  properties, skippedCount, onClose,
}: {
  properties: PropertyResult[];
  skippedCount: number;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [header, setHeader] = useState('Hi,\n\nThe following homes would be available:');
  // Selection set keyed by property id. Defaults to "everything checked"
  // so the existing "copy them all" path is one click.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(properties.map(p => p.id)));

  // Prefer the cached Airbnb listing headline over our internal name —
  // that's what the guest already sees on Airbnb.
  function displayTitleFor(p: PropertyResult): string {
    return (p.airbnbTitle && p.airbnbTitle.trim()) || titleCase(p.name);
  }

  const pickedProperties = properties.filter(p => picked.has(p.id));
  const blockText = (() => {
    const parts: string[] = [];
    if (header.trim()) parts.push(header.trimEnd(), '');
    for (const p of pickedProperties) {
      parts.push(`${displayTitleFor(p)}: ${p.airbnbUrl}`);
    }
    return parts.join('\n');
  })();

  function togglePicked(id: string) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const allPicked = properties.length > 0 && properties.every(p => picked.has(p.id));
  function toggleAll() {
    setPicked(allPicked ? new Set() : new Set(properties.map(p => p.id)));
  }

  async function copy() {
    if (pickedProperties.length === 0) return;
    try {
      await navigator.clipboard.writeText(blockText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
  }

  return (
    <ActionModal
      title="Copy Airbnb links"
      subtitle={skippedCount > 0
        ? `${pickedProperties.length} of ${properties.length} selected · ${skippedCount} more skipped (no Airbnb URL on file)`
        : `${pickedProperties.length} of ${properties.length} selected`}
      width={640}
      placement="center"
      shifted={false}
      skipStackRegister
      onClose={onClose}
      primaryAction={
        <button
          type="button"
          className="btn btn-primary"
          onClick={copy}
          disabled={pickedProperties.length === 0}
          title={pickedProperties.length === 0 ? 'Pick at least one property to copy' : undefined}
        >
          {copied
            ? '✓ Copied to clipboard'
            : pickedProperties.length === 1
              ? '📋 Copy 1 link'
              : `📋 Copy ${pickedProperties.length} links`}
        </button>
      }
    >
      {/* Editable greeting */}
      <div className="form-group" style={{ marginBottom: 'var(--s-4)' }}>
        <label className="form-label">Message header</label>
        <textarea
          className="form-input"
          rows={3}
          value={header}
          onChange={(e) => setHeader(e.target.value)}
          placeholder="Hi, ..."
          style={{ resize: 'vertical', minHeight: 60 }}
        />
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)', marginTop: 4 }}>
          Free-text — appears above the link list. Tweak per guest if you like.
        </div>
      </div>

      {/* Property picker */}
      <div style={{ marginBottom: 'var(--s-4)' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--s-2)',
        }}>
          <span style={{
            fontSize: '0.6875rem',
            fontWeight: 700,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Properties to include
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '0.75rem', padding: '2px 8px' }}
            onClick={toggleAll}
          >
            {allPicked ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          maxHeight: 280,
          overflowY: 'auto',
          background: 'var(--surface)',
        }}>
          {properties.map(p => {
            const on = picked.has(p.id);
            // Row is a plain div with one click handler driving state.
            // No wrapping <label> + onChange combo — the previous version
            // double-fired (label.onClick + input.onChange both toggling)
            // which felt laggy as React reconciled the contradictory updates.
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                onClick={() => togglePicked(p.id)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    togglePicked(p.id);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border-light)',
                  cursor: 'pointer',
                  background: on ? 'var(--color-primary-bg)' : 'transparent',
                  borderLeft: on ? '3px solid var(--color-primary)' : '3px solid transparent',
                  userSelect: 'none',
                }}
              >
                {/* Decorative checkbox indicator — purely visual. The
                    real input affordance is the whole row. */}
                <span
                  aria-hidden
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    borderRadius: 4,
                    border: on ? '2px solid var(--color-primary)' : '2px solid var(--border)',
                    background: on ? 'var(--color-primary)' : 'var(--surface)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: '0.75rem',
                    lineHeight: 1,
                  }}
                >
                  {on ? '✓' : ''}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}>
                    <span style={{
                      fontSize: '0.875rem',
                      fontWeight: on ? 600 : 500,
                      color: on ? 'var(--color-primary)' : 'var(--text)',
                    }}>
                      {displayTitleFor(p)}
                    </span>
                    {/* Small chip with our internal property name so the
                        team can spot which house an Airbnb listing
                        actually is at a glance. Only renders when the
                        internal name differs from the Airbnb headline
                        (avoids "Pinehurst · Pinehurst" duplication when
                        a host happened to title their listing the same
                        as our internal name). */}
                    {titleCase(p.name) !== displayTitleFor(p) && (
                      <span style={{
                        fontSize: '0.625rem',
                        fontWeight: 600,
                        background: 'var(--surface)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                        padding: '1px 6px',
                        borderRadius: 4,
                        letterSpacing: '0.02em',
                        whiteSpace: 'nowrap',
                      }}>
                        {titleCase(p.name)}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: '0.6875rem',
                    color: 'var(--text-light)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginTop: 2,
                  }}>
                    {p.airbnbUrl}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Preview */}
      <div>
        <div style={{
          fontSize: '0.6875rem',
          fontWeight: 700,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 'var(--s-2)',
        }}>
          Preview
        </div>
        <div style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--s-3)',
          fontSize: '0.8125rem',
          lineHeight: 1.6,
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 240,
          overflowY: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}>
          {blockText || <span style={{ color: 'var(--text-light)', fontStyle: 'italic' }}>Nothing selected yet</span>}
        </div>
      </div>

      <div style={{
        marginTop: 'var(--s-3)',
        fontSize: '0.6875rem',
        color: 'var(--text-light)',
        lineHeight: 1.4,
      }}>
        Paste straight into the Airbnb reply — formatting is plain text so it travels cleanly.
      </div>
    </ActionModal>
  );
}

function ResultCard({ property, channel, onClose }: { property: PropertyResult; channel: SearchChannel | null; onClose: () => void }) {
  // Show what THE GUEST PAYS at peak season for the picked
  // channel — sourced via the same helper /price-list and the
  // Properties grid use, so a property's R-amount never differs
  // between surfaces. For fixed-mode properties this reads the
  // peak property_fixed_rates row; for system-mode it goes
  // through the canonical pricingEngine helpers.
  const peakGuestPays = channel
    ? peakGuestRateForChannel({
        pricingMode: property.pricingMode,
        baselineDailyRate: property.dailyRate,
        fixedPeakGuestRate: property.fixedPeakGuestRate,
      }, channel)
    : null;
  return (
    <div
      className="property-card"
      style={{ cursor: property.slug ? 'pointer' : 'default' }}
      onClick={() => {
        if (!property.slug) return;
        // Whole-card click opens the agent-variant brochure in a
        // new tab — the most common "what does this look like?"
        // action straight from a search result.
        window.open(`/brochures/${encodeURIComponent(property.slug)}?brand=agent`, '_blank', 'noopener,noreferrer');
        onClose();
      }}
    >
      <div className="property-card__image">
        {property.heroImageUrl
          ? <img src={property.heroImageUrl} alt={property.name} loading="lazy" />
          : <div className="property-card__no-image">🏠</div>}
      </div>
      <div className="property-card__body">
        <div className="property-card__name-row">
          <h3 className="property-card__name">{titleCase(property.name)}</h3>
          {property.slug && (
            <span className="property-card__uid" title="Unique ID">{property.slug}</span>
          )}
        </div>
        {(property.suburb || property.city) && (
          <p className="property-card__location">
            {[property.suburb, property.city].filter(Boolean).map(titleCase).join(', ')}
          </p>
        )}
        {property.tagline && (
          <p className="property-card__tagline">{property.tagline}</p>
        )}
        <div className="property-card__stats">
          {property.bedrooms != null && property.bedrooms > 0 && (
            <span className="property-card__stat">🛏 {property.bedrooms} bed{property.bedrooms !== 1 ? 's' : ''}</span>
          )}
          {property.bathrooms != null && property.bathrooms > 0 && (
            <span className="property-card__stat">🚿 {property.bathrooms} bath</span>
          )}
          {property.sleeps != null && property.sleeps > 0 && (
            <span className="property-card__stat">👤 {property.sleeps} guests</span>
          )}
        </div>
        {(peakGuestPays ?? property.dailyRate) != null && (
          <div className="property-card__price">
            ZAR {Math.round(peakGuestPays ?? property.dailyRate!).toLocaleString('en-ZA')}
            <span className="property-card__price-label">
              {' '}/ night{peakGuestPays != null ? ' · peak · guest pays' : ''}
            </span>
          </div>
        )}
      </div>
      <div className="property-card__footer">
        {property.slug && (
          <a
            className="btn btn-ghost"
            style={{ fontSize: '0.75rem' }}
            href={`/brochures/${encodeURIComponent(property.slug)}?brand=agent`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            📖 Brochure
          </a>
        )}
      </div>
    </div>
  );
}

/** One-line compact filter summary for the results-pane header. */
function summariseFiltersInline(f: PropertyFilters): string {
  const parts: string[] = [];
  if (f.channel) parts.push(f.channel);
  if (f.bedrooms.length > 0) parts.push(`${f.bedrooms.join(', ')} bed${f.bedrooms.length === 1 && f.bedrooms[0] === 1 ? '' : 's'}`);
  if (f.amenities.length > 0) parts.push(f.amenities.join(', '));
  if (f.checkIn && f.checkOut) parts.push(`${f.checkIn} → ${f.checkOut}`);
  if (f.priceTiers.length > 0) parts.push(`${f.priceTiers.map(t => t.replace('_', ' ')).join(' / ')}`);
  return parts.join(' · ');
}

// ──────────────────────────────────────────────────────────────
// Property filters block — phase 2.
// ──────────────────────────────────────────────────────────────

/** Quick stats line that summarises the active filters above the
 *  results placeholder so the user can read "what am I searching
 *  for?" at a glance without re-checking every section. */
function FilterSummary({ filters }: { filters: PropertyFilters }) {
  const parts: string[] = [];
  if (filters.bedrooms.length > 0) parts.push(`${filters.bedrooms.join(', ')} bed${filters.bedrooms.length === 1 && filters.bedrooms[0] === 1 ? '' : 's'}`);
  if (filters.amenities.length > 0) parts.push(`${filters.amenities.length} amenity${filters.amenities.length === 1 ? '' : ' filters'}`);
  if (filters.checkIn && filters.checkOut) parts.push(`${filters.checkIn} → ${filters.checkOut}`);
  if (filters.priceTiers.length > 0) {
    parts.push(filters.priceTiers.length === 1
      ? `${filters.priceTiers[0].replace('_', ' ')} band`
      : `${filters.priceTiers.length} price bands`);
  }
  if (parts.length === 0) return null;
  return (
    <div style={{
      padding: '8px 12px',
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      fontSize: '0.75rem',
      color: 'var(--text-secondary)',
      marginBottom: 12,
    }}>
      <strong style={{ color: 'var(--text)' }}>Active filters:</strong> {parts.join(' · ')}
    </div>
  );
}

/** Section heading inside the filter form — small caps label so
 *  the four filter blocks read as a checklist rather than a wall
 *  of inputs. */
function FilterSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.6875rem',
      fontWeight: 700,
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

interface PropertyFiltersBlockProps {
  filters: PropertyFilters;
  onChange: (next: PropertyFilters) => void;
  onReset: () => void;
  onSearch: () => void;
  /** Live amenities catalog — typeahead source + the gate that
   *  stops the user filtering by an amenity no property actually has. */
  amenityCatalog: AmenityCatalogEntry[];
}

function PropertyFiltersBlock({ filters, onChange, onReset, onSearch, amenityCatalog }: PropertyFiltersBlockProps) {
  const datesInvalid = !!(filters.checkIn && filters.checkOut && filters.checkIn >= filters.checkOut);

  /** Flush whatever's in `amenityDraft` into the active amenities
   *  list. Two guards: dedupe on lower-case (so "Aircon" + "aircon"
   *  don't double up), and reject anything not present in the
   *  catalog (filtering by an amenity no property has produces a
   *  guaranteed-empty result, which is just confusing). When a
   *  draft term has an exact catalog match we substitute the
   *  canonical casing so the chip reads consistently. */
  function commitAmenityDraft(override?: string) {
    const raw = (override ?? filters.amenityDraft).trim();
    if (!raw) return;
    const lower = raw.toLowerCase();
    if (filters.amenities.some(a => a.toLowerCase() === lower)) {
      onChange({ ...filters, amenityDraft: '' });
      return;
    }
    // Only accept terms that appear on the live catalog.
    const match = amenityCatalog.find(e => e.lower === lower);
    if (!match) return; // silently no-op — the UI hints at why
    onChange({
      ...filters,
      amenities: [...filters.amenities, match.label],
      amenityDraft: '',
    });
  }

  function toggleAmenity(name: string) {
    const lower = name.toLowerCase();
    const has = filters.amenities.some(a => a.toLowerCase() === lower);
    onChange({
      ...filters,
      amenities: has
        ? filters.amenities.filter(a => a.toLowerCase() !== lower)
        : [...filters.amenities, name],
    });
  }

  // Quick-add chips = the hand-picked "common" list intersected
  // with what the catalog actually contains. Drops any common
  // entry that isn't on at least one property so we never offer a
  // dead-end suggestion.
  const catalogLowerSet = useMemo(
    () => new Set(amenityCatalog.map(e => e.lower)),
    [amenityCatalog],
  );
  const unusedPresets = COMMON_AMENITIES.filter(p => {
    if (!catalogLowerSet.has(p.toLowerCase())) return false;
    return !filters.amenities.some(a => a.toLowerCase() === p.toLowerCase());
  });

  // Typeahead suggestions while the user types. Skipped when the
  // input is empty (the quick-add row already covers cold-start)
  // or already-selected. Limited to 6 for visual weight.
  const draft = filters.amenityDraft;
  const suggestions = useMemo(() => {
    if (!draft.trim()) return [];
    const selectedLower = new Set(filters.amenities.map(a => a.toLowerCase()));
    return suggestAmenities(amenityCatalog, draft, 6)
      .filter(s => !selectedLower.has(s.lower));
  }, [draft, amenityCatalog, filters.amenities]);
  const draftMatchesCatalog = catalogHas(amenityCatalog, draft);

  const hasAnyFilter = filters.bedrooms.length > 0
    || filters.amenities.length > 0
    || !!filters.checkIn
    || !!filters.checkOut
    || filters.priceTiers.length > 0;

  // Channel is optional now — only required for the Price tier
  // filter (tier R-amounts depend on which channel they apply to).
  // Everything else can be searched channel-agnostic.
  const channelChoice = filters.channel;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <FilterSummary filters={filters} />

      {/* ── 2.1 Bedrooms ────────────────────────────────────────── */}
      <div>
        <FilterSectionLabel>Bedrooms</FilterSectionLabel>
        <NumericMultiSelect
          max={10}
          value={filters.bedrooms}
          onChange={(next) => onChange({ ...filters, bedrooms: next })}
          placeholder="Any bedroom count"
          singular="bedroom"
          plural="bedrooms"
        />
      </div>

      {/* ── 2.2 Amenities ───────────────────────────────────────── */}
      <div>
        <FilterSectionLabel>Amenities</FilterSectionLabel>
        {/* Reuse the property editor's amenity-tag CSS so the
            chips look identical across the platform. Active chips
            click-to-remove; preset chips click-to-add. Custom
            input + Enter / + Add for anything not in the preset
            list. */}
        <div className="amenity-editor">
          {filters.amenities.length > 0 && (
            <div className="amenity-active">
              {filters.amenities.map(tag => (
                <span
                  key={tag}
                  className="amenity-tag amenity-tag--active"
                  onClick={() => toggleAmenity(tag)}
                >
                  {tag}
                  <span className="amenity-tag-x">✕</span>
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              type="text"
              className="form-input"
              placeholder="Type an amenity (e.g. pool, jacuzzi)…"
              style={{ flex: 1 }}
              value={filters.amenityDraft}
              onChange={(e) => onChange({ ...filters, amenityDraft: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitAmenityDraft();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: '0.75rem' }}
              onClick={() => commitAmenityDraft()}
              disabled={!filters.amenityDraft.trim() || !draftMatchesCatalog}
              title={
                filters.amenityDraft.trim() && !draftMatchesCatalog
                  ? 'No property has this amenity yet — pick one of the suggestions below.'
                  : undefined
              }
            >
              + Add
            </button>
          </div>

          {/* Typeahead — only shown while the user is typing.
              Suggestions come from the live catalog so every chip
              is guaranteed to filter to at least one property. */}
          {draft.trim() && (
            suggestions.length > 0 ? (
              <div className="amenity-presets" style={{ marginBottom: 10 }}>
                <div className="amenity-presets-label">Matches:</div>
                <div className="amenity-presets-list">
                  {suggestions.map(s => (
                    <span
                      key={s.lower}
                      className="amenity-tag amenity-tag--preset"
                      onClick={() => commitAmenityDraft(s.label)}
                    >
                      + {s.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-light)',
                marginBottom: 10,
                fontStyle: 'italic',
              }}>
                No properties tagged "{draft.trim()}" yet.
              </div>
            )
          )}

          {/* Common quick-add chips. Hidden while typing (the
              typeahead replaces them) and when the catalog hasn't
              loaded any of the common items. */}
          {!draft.trim() && unusedPresets.length > 0 && (
            <div className="amenity-presets">
              <div className="amenity-presets-label">Common:</div>
              <div className="amenity-presets-list">
                {unusedPresets.map(tag => (
                  <span
                    key={tag}
                    className="amenity-tag amenity-tag--preset"
                    onClick={() => toggleAmenity(tag)}
                  >
                    + {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 2.3 Date range ──────────────────────────────────────── */}
      <div>
        <FilterSectionLabel>Dates</FilterSectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem' }}>Check-in</label>
            {/* Native date input — same as the enquiry form. Opens
                the browser's calendar picker on click so the user
                doesn't have to type a date by hand. */}
            <input
              type="date"
              className="form-input"
              value={filters.checkIn}
              onChange={(e) => onChange({ ...filters, checkIn: e.target.value })}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem' }}>
              Check-out
              {/* Inline night count pill — same component the
                  enquiry form + deal cards use, so the user sees
                  "🌙 7 nights" the moment both dates are valid. */}
              <NightCount checkIn={filters.checkIn} checkOut={filters.checkOut} />
            </label>
            <input
              type="date"
              className="form-input"
              value={filters.checkOut}
              onChange={(e) => onChange({ ...filters, checkOut: e.target.value })}
              min={filters.checkIn || undefined}
            />
          </div>
        </div>
        {datesInvalid && (
          <div style={{ fontSize: '0.75rem', color: 'var(--error)', marginTop: 6 }}>
            Check-out must be after check-in.
          </div>
        )}
      </div>

      {/* ── 2.4 Price tier — 5 single-select chips driven by
          /settings/price-tiers. Tier R-amounts depend on the
          channel, so we surface a compact channel select inline
          on the same row. Without a channel picked, the price
          chips are hidden + a one-line hint explains why. */}
      <div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}>
          <FilterSectionLabel>Price</FilterSectionLabel>
          <select
            className="form-input"
            style={{ width: 'auto', minWidth: 160, fontSize: '0.8125rem', padding: '4px 8px' }}
            value={filters.channel ?? ''}
            onChange={(e) => onChange({ ...filters, channel: (e.target.value || null) as SearchChannel | null, priceTiers: [] })}
            title="Pick a channel to enable price-tier filtering"
          >
            <option value="">Channel — pick to filter by price</option>
            {CHANNEL_OPTIONS.map(opt => (
              <option key={opt.key} value={opt.key}>{opt.icon} {opt.label}</option>
            ))}
          </select>
        </div>
        {filters.channel ? (
          <PriceBucketFilter
            channel={filters.channel}
            value={filters.priceTiers}
            onChange={(tiers) => onChange({ ...filters, priceTiers: tiers })}
          />
        ) : (
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--text-light)',
            fontStyle: 'italic',
          }}>
            Pick a channel above to filter by price tier — tier R-amounts differ for direct, agent and platform bookings.
          </div>
        )}
      </div>

      {/* Footer: reset + run the search. Search is enabled even
          with zero filters — that's the "show me everything on
          the books" case. */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 12,
        borderTop: '1px solid var(--border-light, var(--border))',
        marginTop: 4,
      }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: '0.8125rem' }}
          onClick={onReset}
          disabled={!hasAnyFilter}
        >
          Reset
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSearch}
          disabled={datesInvalid}
          title={datesInvalid ? 'Fix the date range first' : 'Run the search'}
        >
          🔍 Search properties
        </button>
      </div>
    </div>
  );
}


/** Phase 1 empty-state. Tells the user the scope is wired up but
 *  the filter / results UI hasn't shipped yet — no broken-modal
 *  vibes. Phase 2 will replace this with the real per-scope body. */
function ScopePlaceholder({ scope, query }: { scope: SearchScope; query: string }) {
  return (
    <div
      style={{
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '32px 20px',
        textAlign: 'center',
        background: 'var(--bg)',
        color: 'var(--text-secondary)',
      }}
    >
      <div style={{ fontSize: '2rem', marginBottom: 8 }} aria-hidden>
        🔎
      </div>
      <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        {scopeReadyLabel(scope)}
      </div>
      <div style={{ fontSize: '0.8125rem', lineHeight: 1.5, maxWidth: 380, margin: '0 auto' }}>
        The search shell is in place. Filters and live results land in the next update —
        you'll be able to nail down a property by beds, sleeps, suburb, dates and more
        without leaving this modal.
      </div>
      {query.trim() && (
        <div style={{
          marginTop: 16,
          fontSize: '0.75rem',
          color: 'var(--text-light)',
          fontStyle: 'italic',
        }}>
          You typed “{query.trim()}” — saved for the next phase.
        </div>
      )}
    </div>
  );
}

function scopeReadyLabel(scope: SearchScope): string {
  switch (scope) {
    case 'properties': return 'Property search';
    case 'enquiries':  return 'Enquiry search';
    case 'proposals':  return 'Proposal search';
    case 'bookings':   return 'Booking search';
    case 'guests':     return 'Guest search';
  }
}
