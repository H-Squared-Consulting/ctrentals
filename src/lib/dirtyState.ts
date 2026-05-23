/**
 * dirtyState — module-level registry of "this surface has unsaved edits".
 *
 * Companion to src/lib/autoUpdate.ts: the silent reloader consults this
 * registry before triggering a window.location.reload() so a user with
 * an in-flight form never has their work dropped.
 *
 * Usage from a component / page with a known dirty flag:
 *
 *   import { useDirty } from '../lib/dirtyState';
 *   useDirty(formIsDirty);  // toggle freely; cleans up on unmount
 *
 * Adding a new editing surface? Just call useDirty(yourDirtyFlag) and
 * the reloader will defer until the flag goes back to false (or the
 * component unmounts).
 */
import { useEffect, useRef } from 'react';

const registered = new Set<symbol>();

/** True if any mounted component is currently flagged as dirty. */
export function hasAnyDirty(): boolean {
  return registered.size > 0;
}

/** Track a component's dirty state in the global registry. Idempotent;
 *  cleans up on unmount or when `isDirty` flips back to false. */
export function useDirty(isDirty: boolean): void {
  // Stable identity per hook instance — survives re-renders, GC'd on
  // unmount via the cleanup effect.
  const keyRef = useRef<symbol | null>(null);
  if (!keyRef.current) keyRef.current = Symbol('dirty');
  const key = keyRef.current;

  useEffect(() => {
    if (isDirty) {
      registered.add(key);
      return () => {
        registered.delete(key);
      };
    }
    // isDirty=false: make sure any previous registration is cleared.
    registered.delete(key);
  }, [isDirty, key]);
}
