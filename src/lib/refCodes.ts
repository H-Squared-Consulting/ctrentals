/**
 * refCodes -- sequential ref code generation for enquiries and the
 * proposals attached to them.
 *
 * Scheme (rolling out one stream at a time — DIRECT is live, AGENT
 * and PLATFORM still use legacy formats for now):
 *
 *   Direct enquiry          D001, D002, D003, ...
 *   Direct enquiry proposal PD0011, PD0012, ... PD0021, PD0022, ...
 *                           (parent enquiry's number + trailing index)
 *
 * Generation reads MAX(existing) and increments. There's a benign
 * race between two concurrent inserts that pick the same number;
 * downstream UNIQUE constraints catch that (rare at this scale).
 *
 * If a future stream needs strict ordering, swap to a Postgres
 * sequence + server-side RPC.
 */
const DIRECT_ENQUIRY_PREFIX = 'D';
const DIRECT_PROPOSAL_PREFIX = 'PD';

/** Returns the next Dxxx ref code for a direct enquiry. Pads to 3
 *  digits; will naturally widen past 999 (D1000 → D1001) so we
 *  don't have to migrate when volume grows. */
export async function nextDirectEnquiryRefCode(supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from('enquiries')
    .select('ref_code')
    .like('ref_code', `${DIRECT_ENQUIRY_PREFIX}%`);
  if (error) {
    console.error('nextDirectEnquiryRefCode failed:', error);
    // Fail-safe: start at D001 rather than blocking the save.
    return `${DIRECT_ENQUIRY_PREFIX}001`;
  }
  const re = new RegExp(`^${DIRECT_ENQUIRY_PREFIX}(\\d+)$`);
  let maxN = 0;
  for (const row of (data || []) as Array<{ ref_code: string }>) {
    const m = re.exec(row.ref_code || '');
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return `${DIRECT_ENQUIRY_PREFIX}${String(maxN + 1).padStart(3, '0')}`;
}

/** Returns the next agent enquiry ref code in the form
 *  `{agentRefCode}/N` (e.g. AHH/1, AHH/2, …). N is the next
 *  free integer after the highest already used for this agent.
 *  Uses max-suffix rather than count so deleted rows don't cause
 *  collisions with rows that still exist. Doubles as the enquiry
 *  subject — the kanban card falls back to this when no guest
 *  details have been disclosed yet, which is the agent norm. */
export async function nextAgentEnquiryRefCode(
  supabase: any,
  agentId: string,
  agentRefCode: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('enquiries')
    .select('subject')
    .eq('agent_id', agentId)
    .like('subject', `${agentRefCode}/%`);
  if (error) {
    console.error('nextAgentEnquiryRefCode failed:', error);
    return `${agentRefCode}/1`;
  }
  const escaped = agentRefCode.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  const re = new RegExp(`^${escaped}\\/(\\d+)$`);
  let maxN = 0;
  for (const row of (data || []) as Array<{ subject: string | null }>) {
    const m = re.exec(row.subject || '');
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return `${agentRefCode}/${maxN + 1}`;
}

/** Returns the next proposal ref code for an AGENT-enquiry parent.
 *  Format: `{parentRefCode}-P{N}` (e.g. AHH/3-P1, AHH/3-P2). N is
 *  the max-existing suffix + 1 across that enquiry's proposals.
 *  Scoped to the parent enquiry via enquiry_id so two unrelated
 *  agent enquiries can't collide on the same suffix. */
export async function nextAgentProposalRefCode(
  supabase: any,
  enquiryId: string,
  parentRefCode: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('proposals')
    .select('ref_code')
    .eq('enquiry_id', enquiryId);
  if (error) {
    console.error('nextAgentProposalRefCode failed:', error);
    return `${parentRefCode}-P1`;
  }
  const escaped = parentRefCode.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  const re = new RegExp(`^${escaped}-P(\\d+)$`);
  let maxN = 0;
  for (const row of (data || []) as Array<{ ref_code: string | null }>) {
    const m = re.exec(row.ref_code || '');
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return `${parentRefCode}-P${maxN + 1}`;
}

/** Returns the next proposal ref code for a parent enquiry. Only
 *  applies when the parent's ref_code is in the new direct format
 *  (Dxxx). For legacy or other-stream parents the caller should
 *  fall back to the old code generator. */
export async function nextProposalRefCodeFor(
  supabase: any,
  parentEnquiryRefCode: string | null | undefined,
): Promise<string | null> {
  if (!parentEnquiryRefCode) return null;
  const m = /^D(\d+)$/.exec(parentEnquiryRefCode);
  if (!m) return null;
  const enquiryNumber = m[1]; // keep zero-padding from parent
  const prefix = `${DIRECT_PROPOSAL_PREFIX}${enquiryNumber}`;
  const { data, error } = await supabase
    .from('proposals')
    .select('ref_code')
    .like('ref_code', `${prefix}%`);
  if (error) {
    console.error('nextProposalRefCodeFor failed:', error);
    return `${prefix}1`;
  }
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let maxN = 0;
  for (const row of (data || []) as Array<{ ref_code: string }>) {
    const r = re.exec(row.ref_code || '');
    if (r) maxN = Math.max(maxN, parseInt(r[1], 10));
  }
  return `${prefix}${maxN + 1}`;
}
