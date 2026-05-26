/**
 * PricingModal -- Pricing calculator for a property.
 *
 * Two modes, both routed through the same PricingDashboard:
 *   - mode='create' (default): blank calculator. "Create Proposal" opens
 *     CreateProposalModal which asks for guest details and inserts both a
 *     pricing_proposals snapshot + a linked proposals row in one step.
 *   - mode='edit': dashboard pre-filled with an existing pricing_proposal.
 *     "Save Pricing" UPDATEs that snapshot in place. The linked proposal
 *     automatically reflects the new price.
 */

import { useState } from 'react';
import ActionModal from '../components/ActionModal';
import { useToast } from '../components/ToastProvider';
import PricingDashboard from '../components/PricingDashboard';
import CreateProposalModal from '../components/CreateProposalModal';
import type { PricingSnapshot } from '../components/PricingDashboard';
import type { EnquiryPrefill } from '../components/CreateProposalModal';
import type { PricingProposal } from '../types/pricing';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

interface PricingModalProps {
  property: { id: string; property_name: string };
  onClose: () => void;
  /** Fires when a proposal is actually saved (distinct from onClose,
   *  which also fires on cancel). Hosts use this to swap their success
   *  state from "enquiry saved" → "proposal created" with the right
   *  next-step CTAs. */
  onCreated?: () => void;
  supabase: any;
  /** Edit mode pre-fills the dashboard with an existing pricing snapshot
   *  and changes the primary action to "Save pricing" (in-place UPDATE). */
  editPricingProposal?: PricingProposal;
  /** Called after a successful save in edit mode. */
  onPricingSaved?: () => void;
  /** Optional enquiry — passed through to CreateProposalModal so the
   *  recipient form pre-fills + the saved proposal links to the enquiry. */
  enquiryPrefill?: EnquiryPrefill | null;
  /** Snapshot-only mode. When set, the primary action button just
   *  returns the in-memory snapshot via this callback (and closes)
   *  rather than persisting anything. Used by the new
   *  EnquiryPropertyMatchModal so the user can adjust per-property
   *  pricing during enquiry capture; the actual DB writes happen
   *  later when the user clicks "Save enquiry + N proposals". */
  onSnapshotReady?: (snap: PricingSnapshot) => void;
  /** Optional starting snapshot for snapshot-only mode — lets the
   *  user re-open the modal and resume editing where they left off
   *  on a previous adjustment. */
  initialSnapshot?: PricingSnapshot | null;
  /** Number of nights — forwarded to PricingDashboard for total-stay
   *  sub-lines on every R-amount row. */
  nights?: number;
  /** Forwarded to PricingDashboard. Hides the channel-change toggle
   *  on the channel pill — used when editing pricing from a context
   *  where the scenario is already fixed (e.g. a direct enquiry's
   *  existing proposal). Without this, a stray click could silently
   *  flip a direct quote into an agent quote and rewire the maths. */
  lockScenario?: boolean;
}

export default function PricingModal({
  property,
  onClose,
  onCreated,
  supabase,
  editPricingProposal,
  onPricingSaved,
  enquiryPrefill,
  onSnapshotReady,
  initialSnapshot,
  nights,
  lockScenario = false,
}: PricingModalProps) {
  const toast = useToast();
  const [creatingFromSnapshot, setCreatingFromSnapshot] = useState<PricingSnapshot | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(editPricingProposal);
  // Pure calculator mode = no enquiry, no edit, not the match-flow
  // snapshot return. Renders without an action button — proposals
  // can't be raised from here any more (they must hang off an
  // enquiry), so this surface is just for playing with pricing.
  const isCalculatorOnly = !enquiryPrefill && !isEdit && !onSnapshotReady;

  // Hand the snapshot off to CreateProposalModal. Only used when
  // an enquiry context exists (enquiryPrefill set) — otherwise the
  // action button is hidden and this handler never fires.
  function handleCreateProposal(snap: PricingSnapshot) {
    setCreatingFromSnapshot(snap);
  }

  // ── Edit-mode handler: UPDATE the existing pricing_proposal in place ──
  async function handleSavePricing(snap: PricingSnapshot) {
    if (saving || !editPricingProposal) return;
    setSaving(true);
    try {
      const b = snap.breakdown;
      // pricing_proposals rows are immutable post-insert (enforced by DB
      // trigger — only status / notes / expiry_date may change). To "edit"
      // a saved snapshot we INSERT a fresh row with the new values and
      // repoint the parent proposal(s) at it. The old row stays as an
      // historical record of what was originally quoted.
      const payload = {
        property_id: editPricingProposal.property_id,
        scenario_type: snap.scenarioType,
        agent_id: snap.agentId,
        agents: snap.agents.map(a => ({ id: a.id, pct: a.pct })),
        channel_profile_id: snap.channelId,
        baseline_used: snap.baseline,
        baseline_mode: 'daily' as const,
        commission_pct: snap.totalMarginPct,
        reduced_baseline: snap.reducedBaseline,
        reduced_commission_pct: snap.reducedCtrPct !== null || snap.reducedAgentPct !== null
          ? (snap.reducedCtrPct ?? snap.ctrPct) + (snap.reducedAgentPct ?? snap.agentPct)
          : null,
        season_tag: snap.seasonTag,
        season_multiplier: snap.seasonMultiplier,
        calc_method: 'margin' as const,
        owner_net: b.ownerNet,
        company_take: b.ctrTake,
        client_price_excl_vat: b.clientPriceExclVat,
        vat_enabled: false,
        vat_rate_pct: 0,
        vat_amount: 0,
        client_price_incl_vat: b.clientPriceExclVat,
        status: 'draft' as const,
        expiry_date: null,
        notes: null,
      };
      const { data: newSnap, error: insErr } = await supabase
        .from('pricing_proposals')
        .insert(payload)
        .select('id')
        .single();
      if (insErr) throw insErr;

      const { error: updErr } = await supabase
        .from('proposals')
        .update({ pricing_proposal_id: newSnap.id, updated_at: new Date().toISOString() })
        .eq('pricing_proposal_id', editPricingProposal.id);
      if (updErr) throw updErr;

      toast.success('Pricing updated — linked proposal reflects the new price.');
      onPricingSaved?.();
      onClose();
    } catch (err: any) {
      console.error('handleSavePricing error:', err);
      toast.error('Failed to save: ' + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  }

  // Header subtitle: property + the stay dates (or just the night count when
  // dates aren't available on this path).
  const stayCheckIn = enquiryPrefill?.check_in ?? (editPricingProposal as any)?._checkIn ?? null;
  const stayCheckOut = enquiryPrefill?.check_out ?? (editPricingProposal as any)?._checkOut ?? null;
  const headerSubtitle = (() => {
    const name = titleCase(property.property_name);
    const n = nights ?? (stayCheckIn && stayCheckOut
      ? Math.round((new Date(stayCheckOut).getTime() - new Date(stayCheckIn).getTime()) / 86400000)
      : undefined);
    const fmtD = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
    const nightsTxt = n && n > 0 ? `${n} night${n === 1 ? '' : 's'}` : '';
    if (stayCheckIn && stayCheckOut) return `${name} · ${fmtD(stayCheckIn)} – ${fmtD(stayCheckOut)}${nightsTxt ? ` · ${nightsTxt}` : ''}`;
    if (nightsTxt) return `${name} · ${nightsTxt}`;
    return name;
  })();

  return (
    <>
      <ActionModal
        title={isEdit ? 'Edit pricing' : 'Pricing calculator'}
        subtitle={headerSubtitle}
        width={560}
        hideFooter
        onClose={onClose}
      >
        <PricingDashboard
          property={property}
          supabase={supabase}
          // Forward the enquiry's stay length so the dashboard can
          // show a running total ("R 70 000 for the week") next to
          // every per-night figure. Without this the user only sees
          // per-night until the very end of the flow, which is
          // frustrating when a guest gave a budget for the whole stay.
          nights={nights ?? (() => {
            if (!stayCheckIn || !stayCheckOut) return undefined;
            const n = Math.round((new Date(stayCheckOut).getTime() - new Date(stayCheckIn).getTime()) / (1000 * 60 * 60 * 24));
            return n > 0 ? n : undefined;
          })()}
          initialSnapshot={editPricingProposal ?? (initialSnapshot as any) ?? null}
          // Pre-select scenario from the enquiry: platform enquiries land
          // on the platform breakdown with the channel pre-locked; agent
          // enquiries skip to agent pricing; everything else lands on
          // direct. Users can still flip on agent/direct but the platform
          // path locks the channel since it was already picked at enquiry
          // capture.
          initialScenario={(() => {
            // Prefer enquiryPrefill (new proposal flow). Fall back to the
            // edit-pricing carrier (existing proposal under a platform
            // enquiry) so older direct-saved proposals open as platform.
            const editSource = (editPricingProposal as any)?._enquirySource;
            const editPlatformChannel = (editPricingProposal as any)?._enquiryPlatformChannel;
            if (editSource === 'platform' || editPlatformChannel) return 'platform';
            if (!enquiryPrefill) return undefined;
            if (enquiryPrefill.source === 'platform') return 'platform';
            return enquiryPrefill.is_agent ? 'agent' : 'direct';
          })()}
          // Pre-select the agent who made the enquiry. Only fires when
          // the enquiry is_agent and the user picks the 'agent' scenario
          // in the dashboard. Without this the dropdown defaults to
          // "(any agent)" — frustrating when we already know who.
          initialAgentId={enquiryPrefill?.is_agent ? (enquiryPrefill?.agent_id ?? null) : null}
          // Lock the channel to the platform the user picked at enquiry
          // capture (Airbnb / VRBO). PricingDashboard resolves the
          // lowercase channel name against channel_defaults.platform_name
          // (case-insensitive) and disables the channel dropdown. Falls
          // back to the edit-pricing carrier so older proposals under a
          // platform enquiry also land on the locked platform breakdown.
          initialPlatformChannel={(() => {
            // Don't use `??` chaining here — `false && x` returns `false`
            // not undefined, so `??` won't fall through and the edit-
            // pricing carrier never gets read. Explicit ternary instead.
            if (enquiryPrefill?.source === 'platform') return enquiryPrefill?.platform_channel ?? null;
            const editPlatform = (editPricingProposal as any)?._enquiryPlatformChannel;
            return editPlatform ?? null;
          })()}
          lockScenario={lockScenario || enquiryPrefill?.source === 'platform' || (editPricingProposal as any)?._enquirySource === 'platform'}
          // Three modes drive the action button. The fourth — pure
          // calculator (isCalculatorOnly) — passes undefined so no
          // button renders; the modal is view-only in that case.
          //   onSnapshotReady set → snapshot-only (return + close, no DB write)
          //   isEdit              → in-place save (UPDATE existing pricing_proposal)
          //   enquiryPrefill set  → hand off to CreateProposalModal for full create flow
          //   else                → no action button (calculator only)
          onCreateProposal={
            isCalculatorOnly
              ? undefined
              : onSnapshotReady
                ? (snap: PricingSnapshot) => { onSnapshotReady(snap); onClose(); }
                : (isEdit ? handleSavePricing : handleCreateProposal)
          }
          actionLabel={
            onSnapshotReady
              ? 'Use this pricing'
              : (isEdit ? 'Save pricing' : 'Create proposal from this')
          }
          saving={saving}
        />
      </ActionModal>

      {creatingFromSnapshot && (
        <CreateProposalModal
          snapshot={creatingFromSnapshot}
          property={property}
          supabase={supabase}
          enquiryPrefill={enquiryPrefill}
          onClose={() => setCreatingFromSnapshot(null)}
          onCreated={() => { setCreatingFromSnapshot(null); onCreated?.(); onClose(); }}
        />
      )}
    </>
  );
}
