/**
 * agentPortalAdmin -- admin-side helpers for the agent portal feature.
 *
 * These functions are called from inside the authenticated admin app
 * (Agents page, Property picker, Share menu). They read and write the
 * three pieces of data the feature introduces:
 *
 *   - agents.url_token (+ issued/revoked timestamps)  → enablePortal,
 *     regenerateToken, revokePortal
 *   - agent_properties join table                     → getPropertyIds,
 *     setPropertyIds
 *
 * RLS on agent_properties is "authenticated can do anything", which
 * matches every other partner-scoped table in the codebase. The
 * authenticated user is staff, so trust is implicit.
 *
 * The public portal page (/q/:token) does NOT use this module. It
 * talks to the agent-portal-read / agent-portal-enquire edge functions
 * via src/lib/agentPortal.ts so the public surface has no direct DB
 * access.
 */

/** A loosely-typed Supabase client — matches how the rest of the
 *  codebase passes the auth-context client around. */
type Client = any;

/** Generate a 128-bit (32 hex char) random token. */
function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Build the public portal URL for a given token. Agents see the
 *  neutral ctvilla.co.za domain in production (mirrors the agent-
 *  brochure pattern in BrochureShareMenu) so the Southern Escapes
 *  brand isn't leaked into a link Hayley pastes into a WhatsApp to
 *  an agent. Dev still falls back to window.location.origin so
 *  localhost links work without DNS gymnastics. Override the prod
 *  domain via VITE_AGENT_DOMAIN if the neutral domain ever moves. */
export function getPortalUrl(token: string): string {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
  if (isLocal) return `${window.location.origin}/q/${token}`;
  const domain = (import.meta as any).env?.VITE_AGENT_DOMAIN || 'ctvilla.co.za';
  return `https://${domain}/q/${token}`;
}

// ── Token lifecycle ────────────────────────────────────────────────

export async function enablePortal(supabase: Client, agentId: string): Promise<string> {
  const token = generateToken();
  const { error } = await supabase
    .from('agents')
    .update({
      url_token: token,
      url_token_issued_at: new Date().toISOString(),
      url_token_revoked_at: null,
    })
    .eq('id', agentId);
  if (error) throw error;
  return token;
}

/** Same effect as enablePortal but framed as "rotate" — the previous
 *  token becomes orphaned and any URL using it stops working. */
export async function regenerateToken(supabase: Client, agentId: string): Promise<string> {
  return enablePortal(supabase, agentId);
}

export async function revokePortal(supabase: Client, agentId: string): Promise<void> {
  const { error } = await supabase
    .from('agents')
    .update({
      url_token: null,
      url_token_revoked_at: new Date().toISOString(),
    })
    .eq('id', agentId);
  if (error) throw error;
}

// ── Property assignment ────────────────────────────────────────────

/** All property IDs assigned to a single agent. */
export async function getPropertyIdsForAgent(supabase: Client, agentId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('agent_properties')
    .select('property_id')
    .eq('agent_id', agentId);
  if (error) throw error;
  return (data || []).map((r: any) => r.property_id);
}

/** Overwrite an agent's property list with a fresh selection.
 *  Implemented as a simple DELETE-then-INSERT (no transaction at the
 *  PostgREST layer; if it half-fails the agent ends up with no
 *  properties, which is recoverable from the admin UI). */
export async function setPropertyIdsForAgent(
  supabase: Client,
  agentId: string,
  propertyIds: string[],
): Promise<void> {
  const { error: delErr } = await supabase
    .from('agent_properties')
    .delete()
    .eq('agent_id', agentId);
  if (delErr) throw delErr;

  if (propertyIds.length === 0) return;

  const rows = propertyIds.map(pid => ({ agent_id: agentId, property_id: pid }));
  const { error: insErr } = await supabase
    .from('agent_properties')
    .insert(rows);
  if (insErr) throw insErr;
}

// ── Bulk loads for the Agents page ─────────────────────────────────

/** Pre-loaded map of agentId → property count, for rendering the
 *  Properties cell on the Agents page without per-row queries.
 *
 *  Pass the list of agent IDs currently visible on the page; the
 *  function returns a record covering exactly those (zero counts
 *  included). */
export async function getPropertyCountsByAgent(
  supabase: Client,
  agentIds: string[],
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const id of agentIds) result[id] = 0;
  if (agentIds.length === 0) return result;
  const { data, error } = await supabase
    .from('agent_properties')
    .select('agent_id')
    .in('agent_id', agentIds);
  if (error) throw error;
  for (const row of (data || []) as any[]) {
    result[row.agent_id] = (result[row.agent_id] || 0) + 1;
  }
  return result;
}
