/**
 * statusSync — keep enquiry.deal_status and proposal.status in lockstep
 * for the common 1:1 case (one enquiry, one proposal).
 *
 * The two columns live in different vocabularies because the data model
 * supports multi-proposal enquiries (one client, several quoted properties
 * or agent variants). When there's exactly one proposal attached, the
 * ladies don't want to think about two statuses — moving the kanban card
 * on either surface should advance the other.
 *
 * As soon as a second proposal is attached, auto-sync turns off. The
 * Pipeline card then derives its stage from proposal states (see
 * dealStage() in PipelinePage), and each proposal carries its own status.
 */

export type DealStatus =
  | 'new'
  | 'drafting'
  | 'ready'
  | 'sent'
  | 'stalled'
  | 'interested'
  | 'won'
  | 'lost';

export type ProposalStatus =
  | 'drafting'
  | 'ready'
  | 'sent'
  | 'accepted'
  | 'declined';

/** deal_status → proposal.status. Returns null when the deal stage has
 *  no proposal-level equivalent (e.g. 'new' — proposal doesn't exist yet). */
export function dealStatusToProposalStatus(d: DealStatus): ProposalStatus | null {
  switch (d) {
    case 'drafting':   return 'drafting';
    case 'ready':      return 'ready';
    case 'sent':       return 'sent';
    case 'interested': return 'sent';      // not a proposal state; keep proposal sent.
    case 'stalled':    return 'sent';      // derived from "sent + N days"; proposal stays sent.
    case 'won':        return 'accepted';
    case 'lost':       return 'declined';
    case 'new':        return null;        // no proposal yet.
  }
}

/** proposal.status → deal_status. Always returns a value because every
 *  proposal state maps cleanly onto a deal stage. */
export function proposalStatusToDealStatus(p: ProposalStatus): DealStatus {
  switch (p) {
    case 'drafting': return 'drafting';
    case 'ready':    return 'ready';
    case 'sent':     return 'sent';
    case 'accepted': return 'won';
    case 'declined': return 'lost';
  }
}

/** Bump the enquiry's deal_status to match the proposal's new status,
 *  but only when this is the enquiry's sole proposal. Multi-proposal
 *  deals are managed independently — the Pipeline card derives its
 *  stage from proposal states in that case. */
export async function syncEnquiryFromProposal(
  supabase: any,
  proposalId: string,
  newProposalStatus: ProposalStatus,
): Promise<void> {
  const { data: prop } = await supabase
    .from('proposals')
    .select('enquiry_id')
    .eq('id', proposalId)
    .single();
  if (!prop?.enquiry_id) return;

  const { count } = await supabase
    .from('proposals')
    .select('id', { count: 'exact', head: true })
    .eq('enquiry_id', prop.enquiry_id);
  if ((count ?? 0) !== 1) return;

  const dealStatus = proposalStatusToDealStatus(newProposalStatus);
  await supabase
    .from('enquiries')
    .update({ deal_status: dealStatus, updated_at: new Date().toISOString() })
    .eq('id', prop.enquiry_id);
}

/** Cascade an accepted proposal: close the parent enquiry as Won and
 *  auto-decline every sibling. Use this instead of syncEnquiryFromProposal
 *  when a proposal is being accepted — once one wins, the others are
 *  superseded. The auto-declines carry decline_reason='Superseded by
 *  accepted proposal' so the user can hover and see why.
 *
 *  Standalone proposals (no enquiry_id) only update themselves — caller
 *  has already written the accept.
 */
export async function closeEnquiryOnProposalAccept(
  supabase: any,
  proposalId: string,
): Promise<void> {
  const { data: prop } = await supabase
    .from('proposals')
    .select('enquiry_id')
    .eq('id', proposalId)
    .single();
  if (!prop?.enquiry_id) return;

  // Enquiry → Won (overrides the 1:1 sync guard — multi-proposal accept
  // is the explicit "this deal is won" signal, so the guard doesn't apply).
  await supabase
    .from('enquiries')
    .update({ deal_status: 'won', updated_at: new Date().toISOString() })
    .eq('id', prop.enquiry_id);

  // Snapshot each sibling's CURRENT status into previous_status
  // BEFORE we cascade them to declined. Lets "Move back to
  // Responded" restore each sibling to its exact pre-cascade state
  // (drafting / ready / sent) rather than guessing.
  const { data: liveSiblings } = await supabase
    .from('proposals')
    .select('id, status')
    .eq('enquiry_id', prop.enquiry_id)
    .neq('id', proposalId)
    .not('status', 'in', '("accepted","declined")');
  for (const sib of (liveSiblings || []) as Array<{ id: string; status: string }>) {
    await supabase
      .from('proposals')
      .update({
        previous_status: sib.status,
        status: 'declined',
        decline_reason: 'Superseded by accepted proposal',
        updated_at: new Date().toISOString(),
      })
      .eq('id', sib.id);
  }
}

/** Called after a proposal is declined. If no live siblings remain on
 *  the parent enquiry, close it as Lost. Otherwise no-op (enquiry stays
 *  open while other proposals are still in flight). */
export async function maybeCloseEnquiryOnProposalDecline(
  supabase: any,
  proposalId: string,
): Promise<void> {
  const { data: prop } = await supabase
    .from('proposals')
    .select('enquiry_id')
    .eq('id', proposalId)
    .single();
  if (!prop?.enquiry_id) return;

  const { data: live } = await supabase
    .from('proposals')
    .select('id', { count: 'exact' })
    .eq('enquiry_id', prop.enquiry_id)
    .not('status', 'in', '("accepted","declined")');
  if (live && live.length > 0) return;

  await supabase
    .from('enquiries')
    .update({ deal_status: 'lost', updated_at: new Date().toISOString() })
    .eq('id', prop.enquiry_id);
}

/** How many sibling proposals are still live on the parent enquiry of
 *  this proposal, excluding the proposal itself. Used to compose the
 *  confirm dialogs before Accept/Decline. */
export async function countLiveSiblings(
  supabase: any,
  proposalId: string,
): Promise<number> {
  const { data: prop } = await supabase
    .from('proposals')
    .select('enquiry_id')
    .eq('id', proposalId)
    .single();
  if (!prop?.enquiry_id) return 0;

  const { data } = await supabase
    .from('proposals')
    .select('id')
    .eq('enquiry_id', prop.enquiry_id)
    .neq('id', proposalId)
    .not('status', 'in', '("accepted","declined")');
  return data?.length ?? 0;
}

/** Mirror the enquiry's new deal_status onto its sole proposal. Same
 *  1:1 guard as the reverse direction. No-op when the new deal stage
 *  has no proposal equivalent (e.g. 'new'). */
export async function syncProposalFromEnquiry(
  supabase: any,
  enquiryId: string,
  newDealStatus: DealStatus,
): Promise<void> {
  const target = dealStatusToProposalStatus(newDealStatus);
  if (target === null) return;

  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, status')
    .eq('enquiry_id', enquiryId);
  if (!proposals || proposals.length !== 1) return;

  if (proposals[0].status === target) return;
  await supabase
    .from('proposals')
    .update({ status: target, updated_at: new Date().toISOString() })
    .eq('id', proposals[0].id);
}
