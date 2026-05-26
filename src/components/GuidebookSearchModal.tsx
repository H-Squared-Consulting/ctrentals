/**
 * GuidebookSearchModal -- the ⌘K modal for the guest guidebook.
 *
 * Mounted by GuidebookChrome at the page root so it's reachable from
 * every guidebook route (Home, Arrival, Stay, Explore, Emergency).
 *
 * Open via:
 *   - ⌘K / Ctrl+K
 *   - `/` (when no other input is focused)
 *   - The header search pill (fires window.dispatchEvent(new CustomEvent('gb-search:open')))
 *
 * Result tap:
 *   - Same-page anchor (`#stay` etc) → smooth-scroll + brief highlight
 *   - Cross-route path (`/g/:slug/emergency`) → react-router navigate
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  buildSearchIndex,
  createSearchEngine,
  search,
  type SearchDoc,
} from '../lib/guidebookSearch';
import { Emoji, type Guidebook, type Manual } from '../lib/guidebookShared';

type Recommendation = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  address: string | null;
};

export type GuidebookSearchData = {
  guidebook: Guidebook;
  manuals: Manual[];
  recommendations: Recommendation[];
};

export default function GuidebookSearchModal({
  data,
}: { data: GuidebookSearchData | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const docs = useMemo(
    () => data ? buildSearchIndex(data.guidebook, data.manuals, data.recommendations) : [],
    [data],
  );
  const engine = useMemo(() => createSearchEngine(docs), [docs]);
  const results = useMemo(() => search(engine, docs, query, 20), [engine, docs, query]);

  // Reset highlight to top when query changes.
  useEffect(() => { setActiveIdx(0); }, [query]);

  // Open via window event ('gb-search:open') OR ⌘K / Ctrl+K / `/`.
  useEffect(() => {
    function onOpen() { setOpen(true); }
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === '/' && !meta) {
        const t = e.target as HTMLElement | null;
        const isField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (isField) return;
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('gb-search:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('gb-search:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Autofocus input when opened, restore body scroll when closed.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      document.body.style.overflow = 'hidden';
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Keep the active result visible in the scroll viewport.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  function close() { setOpen(false); }

  function selectResult(doc: SearchDoc) {
    setOpen(false);
    if (doc.href.startsWith('#')) {
      // Same-page anchor — scroll + brief highlight.
      // Defer slightly so the modal closes first (less visual jank).
      setTimeout(() => scrollToWithHighlight(doc.href), 60);
    } else {
      // Cross-route navigation.
      navigate(doc.href);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectResult(results[activeIdx]);
    }
  }

  if (!open || !data) return null;

  const showingSuggested = !query.trim();

  return (
    <div
      className="gb-search-overlay"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        className="gb-search-shell"
        role="dialog"
        aria-modal="true"
        aria-label="Search the guidebook"
      >
        <div className="gb-search-header">
          <span className="gb-search-icon" aria-hidden>🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="gb-search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search the guidebook — WiFi, hospitals, recommendations…"
            role="combobox"
            aria-expanded
            aria-controls="gb-search-listbox"
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="gb-search-hint" aria-hidden>Esc</span>
          <button
            type="button"
            className="gb-search-close"
            onClick={close}
            aria-label="Close search"
          >
            ✕
          </button>
        </div>

        <div ref={listRef} className="gb-search-body" id="gb-search-listbox" role="listbox">
          {showingSuggested && (
            <div className="gb-search-section">Suggested</div>
          )}
          {results.length === 0 ? (
            <div className="gb-search-empty">
              <div className="gb-search-empty-title">Nothing found</div>
              <div className="gb-search-empty-body">
                Try a different word, or message your host directly.
              </div>
            </div>
          ) : (
            results.map((doc, idx) => (
              <button
                key={doc.id}
                type="button"
                data-idx={idx}
                role="option"
                aria-selected={idx === activeIdx}
                className={`gb-search-result ${idx === activeIdx ? 'is-active' : ''}`}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => selectResult(doc)}
              >
                <span className="gb-search-result-icon"><Emoji name={doc.icon} /></span>
                <span className="gb-search-result-main">
                  <span className="gb-search-result-source">{doc.source}</span>
                  <span className="gb-search-result-title">{doc.title}</span>
                  {doc.body && (
                    <span className="gb-search-result-body">{truncate(doc.body, 110)}</span>
                  )}
                </span>
                <span className="gb-search-result-enter" aria-hidden>↵</span>
              </button>
            ))
          )}
        </div>

        <div className="gb-search-footer" aria-hidden>
          <kbd>↑</kbd><kbd>↓</kbd> Navigate
          <kbd>↵</kbd> Select
          <kbd>Esc</kbd> Close
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

/** Scroll to the given hash on the current page and briefly outline
 *  the target section so the user sees where they landed. */
function scrollToWithHighlight(hash: string) {
  const id = hash.replace(/^#/, '');
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 64;
  window.scrollTo({ top, behavior: 'smooth' });
  el.classList.add('gb-search-flash');
  window.setTimeout(() => el.classList.remove('gb-search-flash'), 1600);
}
