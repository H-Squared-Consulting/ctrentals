/**
 * useBodyScrollLock — set `document.body.style.overflow` to 'hidden' for
 * the lifetime of the calling component, then restore the original value
 * once every lock holder has unmounted. Designed for modal shells
 * (ActionModal, DetailModal): mount = open, unmount = close.
 *
 * Why this exists: a fixed-position .modal-overlay covers the viewport
 * but doesn't stop wheel events from bubbling to the page underneath,
 * so the background still scrolls. Locking body overflow is the
 * standard fix.
 *
 * Refcount semantics: the previous (per-component snapshot) version had
 * a stuck-lock bug whenever two modals were open at once — the second
 * mount snapshotted `'hidden'` as the "previous" value, so when the
 * first modal unmounted and restored `''`, the second one's unmount
 * later restored `'hidden'`, permanently locking page scroll until a
 * full refresh. Counting active holders at the module level fixes that:
 *   - First mount snapshots the original value and locks.
 *   - Subsequent mounts just bump the counter.
 *   - Each unmount decrements; the last one restores the original.
 */
import { useEffect } from 'react';

// Module-level state shared across every consumer of the hook. Survives
// component re-renders and StrictMode's double-invoke (each mount has a
// paired unmount, so the counter still nets out correctly).
let lockCount = 0;
let originalOverflow: string | null = null;

export function useBodyScrollLock(): void {
  useEffect(() => {
    if (lockCount === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount <= 0) {
        // Belt-and-braces: clamp at 0 so an unexpected unmount-without-
        // mount can't drive the counter negative and trap future locks.
        lockCount = 0;
        document.body.style.overflow = originalOverflow ?? '';
        originalOverflow = null;
      }
    };
  }, []);
}
