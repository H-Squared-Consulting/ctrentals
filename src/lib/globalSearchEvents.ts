/**
 * globalSearchEvents -- thin window-level event bus for "open the
 * global search modal" requests.
 *
 * Three callers can open the modal — the top-right search pill, the
 * FAB's "Search properties" action, and the ⌘K / Ctrl+K shortcut
 * listener that lives at the layout level. Routing every open
 * through the same event keeps the modal-open state owned by ONE
 * mount point (AppLayout) without forcing every caller to receive a
 * setter via props.
 *
 * Mirrors the pattern in src/lib/pipelineEvents.ts so the codebase
 * uses one shape for cross-component signals.
 */

const EVENT = 'global-search:open';

/** Detail payload — lets the caller scope the modal to a particular
 *  entity ("properties", "enquiries", etc.) when it opens. Phase 1
 *  only uses 'properties' but the wire is in place for later
 *  phases to expand. */
export interface OpenGlobalSearchDetail {
  scope?: 'properties' | 'enquiries' | 'proposals' | 'bookings' | 'guests';
}

export function openGlobalSearch(detail: OpenGlobalSearchDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenGlobalSearchDetail>(EVENT, { detail }));
}

export function onOpenGlobalSearch(
  handler: (detail: OpenGlobalSearchDetail) => void,
): () => void {
  function onEvent(e: Event) {
    handler(((e as CustomEvent<OpenGlobalSearchDetail>).detail) || {});
  }
  window.addEventListener(EVENT, onEvent);
  return () => window.removeEventListener(EVENT, onEvent);
}
