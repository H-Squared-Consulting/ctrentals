/**
 * GlobalSearchLauncher — single mount point for the global search.
 *
 * Owns:
 *   - the global ⌘K / Ctrl+K keyboard listener
 *   - the modal-open state for GlobalSearchModal
 *
 * Renders once in AppLayout. Three callers open the modal — the
 * sidebar Search pill, the FAB's Search action, and the keyboard
 * shortcut — all routed through globalSearchEvents so this
 * component is the only owner of `open`. The always-visible
 * affordance lives in Sidebar (next to the brand wordmark) so
 * it doesn't clash with per-page headers / counters in the main
 * content area.
 */

import { useEffect, useState } from 'react';
import GlobalSearchModal from './GlobalSearchModal';
import { openGlobalSearch, onOpenGlobalSearch, type OpenGlobalSearchDetail } from '../lib/globalSearchEvents';

export default function GlobalSearchLauncher() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<NonNullable<OpenGlobalSearchDetail['scope']>>('properties');

  // Listen for open requests from any caller (pill / FAB / keyboard).
  useEffect(() => {
    return onOpenGlobalSearch((detail) => {
      if (detail.scope) setScope(detail.scope);
      setOpen(true);
    });
  }, []);

  // Global ⌘K / Ctrl+K shortcut. Captured at the window level so it
  // fires from any page. Skipped while typing into a text field
  // (input/textarea/contenteditable) so the user can still type
  // "k" into an enquiry note without the palette stealing focus.
  // Escape is handled by ActionModal already; we don't need to
  // duplicate it here.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const isOpenShortcut = (e.metaKey || e.ctrlKey) && key === 'k';
      if (!isOpenShortcut) return;
      const target = e.target as HTMLElement | null;
      // Allow the shortcut even when focused inside the search
      // input itself (so Cmd+K toggles closed via re-opening
      // wouldn't make sense — but we don't toggle, we just open).
      // Block only when typing into a different text surface.
      const isTextInput = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      const isSearchModalInput = isTextInput && target?.closest('[data-global-search-modal]');
      if (isTextInput && !isSearchModalInput) {
        // Allow the user to OPT IN — Cmd+K still wins. The
        // "skipped while typing" claim above only applies to
        // non-modifier keys; we let the modifier-combo through
        // because Cmd+K conflicts with almost nothing.
      }
      e.preventDefault();
      openGlobalSearch();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;
  return (
    <div data-global-search-modal>
      <GlobalSearchModal
        initialScope={scope}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
