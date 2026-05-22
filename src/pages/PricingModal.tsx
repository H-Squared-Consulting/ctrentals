/**
 * PricingModal -- Pricing calculator for a property.
 *
 * Two modes:
 *   - mode='create' (default): blank calculator. "Create Proposal" opens
 *     CreateProposalModal which asks for guest details and inserts both a
 *     pricing_proposals snapshot + a linked proposals row in one step.
 *   - mode='edit': calculator pre-filled with an existing pricing_proposal.
 *     "Save Pricing" UPDATEs that snapshot in place. The linked proposal
 *     automatically reflects the new price.
 */

import { useState } from 'react';
import ActionModal from '../components/ActionModal';
import { useToast } from '../components/ToastProvider';
import PricingWidget, { snapshotToText } from '../components/PricingWidget';
import CreateProposalModal from '../components/CreateProposalModal';
import type { PricingSnapshot } from '../components/PricingWidget';
import type { EnquiryPrefill } from '../components/CreateProposalModal';
import type { PricingProposal } from '../types/pricing';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

interface PricingModalProps {
  property: { id: string; property_name: string };
  onClose: () => void;
  supabase: any;
  /** Edit mode pre-fills the widget with an existing pricing snapshot and
   *  changes "Create Proposal" → "Save Pricing" (updates in place). */
  editPricingProposal?: PricingProposal;
  /** Called after a successful save in edit mode. */
  onPricingSaved?: () => void;
  /** Optional enquiry — passed through to CreateProposalModal so the
   *  recipient form pre-fills + the saved proposal links to the enquiry. */
  enquiryPrefill?: EnquiryPrefill | null;
}

export default function PricingModal({
  property,
  onClose,
  supabase,
  editPricingProposal,
  onPricingSaved,
  enquiryPrefill,
}: PricingModalProps) {
  const toast = useToast();
  const [creatingFromSnapshot, setCreatingFromSnapshot] = useState<PricingSnapshot | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(editPricingProposal);

  // ── Create-mode handler: hand the snapshot off to the modal ──
  function handleCreateProposal(snap: PricingSnapshot) {
    setCreatingFromSnapshot(snap);
  }

  // ── Edit-mode handler: UPDATE the existing pricing_proposal in place ──
  async function handleSavePricing(snap: PricingSnapshot) {
    if (saving || !editPricingProposal) return;
    setSaving(true);
    try {
      const b = snap.breakdown;
      const payload = {
        scenario_type: snap.scenarioType,
        agent_id: snap.agentId,
        // Multi-agent split — Postgres JSONB column; pg-driver serialises the
        // array straight through. Empty array for non-agent scenarios so we
        // don't leave stale data on row.
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
        vat_amount: 0,
        client_price_incl_vat: b.clientPriceExclVat,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('pricing_proposals')
        .update(payload)
        .eq('id', editPricingProposal.id);
      if (error) throw error;
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

  // ── Share Calc (clipboard) ──
  async function handleShareCalc(snap: PricingSnapshot) {
    const text = snapshotToText(snap, property.property_name);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Pricing copied to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  return (
    <>
      <ActionModal
        title={isEdit ? 'Edit pricing' : 'Pricing calculator'}
        subtitle={titleCase(property.property_name)}
        width={900}
        hideFooter
        onClose={onClose}
      >
        <PricingWidget
          property={property}
          supabase={supabase}
          initialSnapshot={editPricingProposal ?? null}
          onCreateProposal={isEdit ? handleSavePricing : handleCreateProposal}
          onShareCalc={handleShareCalc}
          saving={saving}
          actionLabel={isEdit ? 'Save Pricing' : 'Create Proposal'}
        />
      </ActionModal>

      {creatingFromSnapshot && (
        <CreateProposalModal
          snapshot={creatingFromSnapshot}
          property={property}
          supabase={supabase}
          enquiryPrefill={enquiryPrefill}
          onClose={() => setCreatingFromSnapshot(null)}
          onCreated={() => { setCreatingFromSnapshot(null); onClose(); }}
        />
      )}
    </>
  );
}
