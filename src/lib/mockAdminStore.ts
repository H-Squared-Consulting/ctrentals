/**
 * mockAdminStore -- localStorage-backed state for the agent portal demo.
 *
 * Lets the admin side (Agents page) write portal tokens and per-agent
 * property assignments, and the public agent portal at /q/:token read
 * the same data. Both surfaces share state via localStorage so two
 * browser tabs can demo the end-to-end flow without any backend.
 *
 * When the real backend lands, replace these functions with Supabase
 * calls against agents.url_token + the agent_properties join table.
 * The UI does not need to change — the function signatures here are
 * the contract.
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'cmb_agent_portal_mock_v1';
const CHANGE_EVENT = 'agent-portal-mock-changed';

interface AdminState {
  /** agentId -> active token, or null if the portal has been revoked. */
  tokenByAgentId: Record<string, string | null>;
  /** agentId -> array of property IDs the agent is allowed to sell. */
  propertiesByAgentId: Record<string, string[]>;
}

const EMPTY: AdminState = { tokenByAgentId: {}, propertiesByAgentId: {} };

function loadState(): AdminState {
  if (typeof localStorage === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return {
      tokenByAgentId: parsed.tokenByAgentId || {},
      propertiesByAgentId: parsed.propertiesByAgentId || {},
    };
  } catch {
    return EMPTY;
  }
}

function saveState(state: AdminState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  // Custom event for same-tab subscribers; localStorage's "storage" event
  // only fires in *other* tabs.
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function generateToken(): string {
  // 32-char hex token. Cryptographically random so we can swap to a real
  // backend without rebuilding URLs.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Token management ───────────────────────────────────────────────

export function getTokenForAgent(agentId: string): string | null {
  return loadState().tokenByAgentId[agentId] ?? null;
}

export function isPortalEnabled(agentId: string): boolean {
  return !!getTokenForAgent(agentId);
}

export function enablePortal(agentId: string): string {
  const state = loadState();
  const token = generateToken();
  state.tokenByAgentId[agentId] = token;
  // New agents start with zero properties (per Gazza's decision).
  if (!state.propertiesByAgentId[agentId]) {
    state.propertiesByAgentId[agentId] = [];
  }
  saveState(state);
  return token;
}

export function regenerateToken(agentId: string): string {
  // Same effect as enable — generate a fresh token and overwrite. Any
  // previously-shared URL stops working immediately.
  return enablePortal(agentId);
}

export function revokePortal(agentId: string): void {
  const state = loadState();
  state.tokenByAgentId[agentId] = null;
  saveState(state);
}

// ── Property assignment ────────────────────────────────────────────

export function getPropertyIdsForAgent(agentId: string): string[] {
  return loadState().propertiesByAgentId[agentId] ?? [];
}

export function setPropertyIdsForAgent(agentId: string, propertyIds: string[]): void {
  const state = loadState();
  state.propertiesByAgentId[agentId] = propertyIds;
  saveState(state);
}

// ── Lookup by token (used by the public portal page) ───────────────

export function getAgentIdByToken(token: string): string | null {
  const state = loadState();
  for (const [agentId, t] of Object.entries(state.tokenByAgentId)) {
    if (t && t === token) return agentId;
  }
  return null;
}

// ── URL helpers ────────────────────────────────────────────────────

export function getPortalUrl(token: string): string {
  return `${window.location.origin}/q/${token}`;
}

// ── Demo reset ─────────────────────────────────────────────────────

export function resetAll(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// ── React hook ─────────────────────────────────────────────────────

/**
 * Tick that bumps every time the mock store changes. Components that
 * read from the store should call this and include it (or any value
 * read from the store) in their dependency arrays so they re-render
 * when the store updates from elsewhere.
 */
export function useAgentPortalMockState(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const handler = () => setVersion(v => v + 1);
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return version;
}
