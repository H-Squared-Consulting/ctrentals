/**
 * autoUpdate — silent self-update when a new Vercel deploy lands.
 *
 * Problem: a Vite SPA holds whatever JS was loaded when the tab opened.
 * After a deploy, already-open tabs keep running the old bundle until
 * the user manually refreshes — which non-technical users (Mom) never
 * do, so they sit on stale code for hours.
 *
 * How this works:
 *   - vite.config emits /version.json at build with a `buildId` field
 *     (Vercel commit SHA in prod, timestamp locally).
 *   - The same buildId is inlined into the bundle as `__BUILD_ID__`.
 *   - This module polls /version.json on an interval and on tab
 *     visibility changes. If the served buildId differs from the baked
 *     one, a new deploy has landed.
 *   - When detected, it reloads the tab — but only at a safe moment:
 *     no modal open, no editable element focused, no `beforeunload`
 *     handler vetoing (= no dirty form). If unsafe, it defers and
 *     re-tries on the next visibility change or short poll.
 *
 * Constraints honoured:
 *   - PROD-only. No-op during local dev so it doesn't fight HMR.
 *   - No new packages.
 *   - Silent: no toast, no prompt. The user notices nothing if they're
 *     idle; they never see "Leave site?" because we defer on dirty.
 *   - Reload-loop guard: sessionStorage timestamp blocks a second
 *     reload within 60s in case a deploy serves a stale version.json.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { hasAnyDirty } from './dirtyState';

const VERSION_URL = '/version.json';
const CHECK_INTERVAL_MS = 2 * 60 * 1000;   // 2 minutes
const SAFE_RETRY_INTERVAL_MS = 10 * 1000;  // poll for safety every 10s once update is pending
const INITIAL_DELAY_MS = 30 * 1000;        // wait 30s after boot before first check
const RELOAD_COOLDOWN_MS = 60 * 1000;      // guard against reload loops
const RELOAD_COOLDOWN_KEY = 'autoUpdate.lastReloadAt';

// Selectors covering every modal / page-editor surface in the app. If any
// of these are mounted, reloading would yank the user out of an editing
// flow. Kept centralised so future modal types can be added in one place.
const MODAL_SELECTORS = [
  '.modal-overlay',
  '.detail-modal-overlay',
  '.action-modal-overlay',
  '.page-editor',
  '.brochure-editor-overlay',
].join(',');

let installed = false;

export function installAutoUpdate(): void {
  if (installed) return;
  installed = true;

  // Local dev (`vite` / `vite dev`) skips this entirely so it doesn't
  // fight HMR. PROD covers `vite build`-produced bundles served by
  // Vercel or any other static host.
  if (!import.meta.env.PROD) return;

  const bakedId = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';
  // Defensive: if the define didn't apply for some reason, bail rather
  // than reload on every check.
  if (!bakedId) return;

  let updateReady = false;
  let reloading = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  async function fetchServedBuildId(): Promise<string | null> {
    try {
      const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'omit',
      });
      if (!res.ok) return null;
      const json = await res.json();
      return typeof json?.buildId === 'string' ? json.buildId : null;
    } catch {
      // Network blip, offline, parse error — silent.
      return null;
    }
  }

  async function checkForUpdate(): Promise<void> {
    if (updateReady || reloading) return;
    const servedId = await fetchServedBuildId();
    if (!servedId) return;
    if (servedId === bakedId) return;
    updateReady = true;
    tryReload();
  }

  /** Returns true if reloading now would not interrupt the user. */
  function isSafeToReload(): boolean {
    // (a) No modal / full-page editor open.
    if (document.querySelector(MODAL_SELECTORS)) return false;

    // (b) Nothing editable is focused.
    const active = document.activeElement as HTMLElement | null;
    if (active) {
      const tag = active.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
      if (active.isContentEditable) return false;
    }

    // (c) No component has registered itself as dirty via useDirty().
    // This is the explicit, opt-in signal — preferred over the
    // beforeunload probe below because it survives any change to how
    // forms handle navigation guards.
    if (hasAnyDirty()) return false;

    // (d) Fallback: no `beforeunload` listener vetoes the reload.
    // Dispatching a synthetic event lets us probe without triggering
    // the browser's "Leave site?" dialog. Catches dirty surfaces that
    // haven't been migrated to useDirty() yet, and any third-party
    // code that registers its own beforeunload guard.
    try {
      const probe = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(probe);
      if (probe.defaultPrevented) return false;
    } catch {
      // Some older browsers may not support Event construction this way.
      // Treat as safe rather than blocking updates forever.
    }

    return true;
  }

  function withinCooldown(): boolean {
    try {
      const raw = sessionStorage.getItem(RELOAD_COOLDOWN_KEY);
      if (!raw) return false;
      const last = Number(raw);
      if (!Number.isFinite(last)) return false;
      return Date.now() - last < RELOAD_COOLDOWN_MS;
    } catch {
      return false;
    }
  }

  function markReloadAttempt(): void {
    try {
      sessionStorage.setItem(RELOAD_COOLDOWN_KEY, String(Date.now()));
    } catch {
      /* sessionStorage disabled — accept the small loop risk */
    }
  }

  function tryReload(): void {
    if (!updateReady || reloading) return;
    if (withinCooldown()) {
      // We very recently reloaded; the new bundle might still be propagating.
      // Drop the flag so the next check picks things up cleanly.
      updateReady = false;
      return;
    }
    if (!isSafeToReload()) {
      // Defer: keep the flag set, retry on the next visibility change
      // (handled below) or after a short interval.
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          tryReload();
        }, SAFE_RETRY_INTERVAL_MS);
      }
      return;
    }
    reloading = true;
    markReloadAttempt();
    window.location.reload();
  }

  // Periodic check. First run after a short delay so the app boots before
  // we add network noise.
  setTimeout(() => {
    checkForUpdate();
    setInterval(checkForUpdate, CHECK_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  // When the tab regains visibility (most common case: user switches back
  // from another tab and is briefly idle before clicking), opportunistic
  // check + reload attempt.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (updateReady) tryReload();
    else checkForUpdate();
  });
}
