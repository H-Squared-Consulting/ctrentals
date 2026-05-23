/**
 * useBodyScrollLock — set `document.body.style.overflow` to 'hidden' for
 * the lifetime of the calling component, then restore whatever the body
 * had before. Designed for modal shells (ActionModal, DetailModal):
 * mount = open, unmount = close.
 *
 * Why this exists: a fixed-position .modal-overlay covers the viewport
 * but doesn't stop wheel events from bubbling to the page underneath,
 * so the background still scrolls. Locking body overflow is the
 * standard fix.
 *
 * Restore semantics: snapshots the value at mount-time and restores
 * exactly that. Won't trample a future site-wide `body { overflow:
 * hidden }` set elsewhere.
 */
import { useEffect } from 'react';

export function useBodyScrollLock(): void {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
}
