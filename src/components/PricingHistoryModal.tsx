/**
 * PricingHistoryModal -- view-only audit timeline of every pricing
 * snapshot ever attached to a single proposal.
 *
 * Backed by the `pricing_proposals.proposal_id` back-reference added
 * in 20260530080000_pricing_proposals_proposal_backlink.sql. Each
 * "Edit pricing" save inserts a new snapshot, and the trigger keeps
 * the back-link in sync — this modal just lists them in reverse
 * chronological order so Nicki and Hayley can see how a deal moved.
 *
 * Read-only: no revert, no edit. The current pricing always wins;
 * historicals are reference only.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import ActionModal from './ActionModal';

interface Version {
  id: string;
  created_at: string;
  client_price_excl_vat: number | null;
  owner_net: number | null;
  company_take: number | null;
  scenario_type: string | null;
  agents: Array<{ id: string; pct: number }> | null;
}

export default function PricingHistoryModal({
  proposalId,
  proposalRefCode,
  currentPricingProposalId,
  propertyName,
  onClose,
}: {
  proposalId: string;
  proposalRefCode: string;
  /** The proposal's currently-linked pricing_proposal_id, used to
   *  flag which row is the live one. */
  currentPricingProposalId: string | null;
  propertyName: string;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('pricing_proposals')
        .select('id, created_at, client_price_excl_vat, owner_net, company_take, scenario_type, agents')
        .eq('proposal_id', proposalId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error('PricingHistoryModal load failed:', error);
        setVersions([]);
        setLoading(false);
        return;
      }
      const rows = (data || []) as Version[];
      setVersions(rows);

      // Resolve agent names so the multi-agent split lines read as
      // "Anneline Klaase (15%)" instead of UUIDs.
      const agentIds = new Set<string>();
      for (const v of rows) {
        if (Array.isArray(v.agents)) {
          for (const a of v.agents) {
            if (a?.id) agentIds.add(a.id);
          }
        }
      }
      if (agentIds.size > 0) {
        const { data: agentRows } = await supabase
          .from('agents')
          .select('id, name')
          .in('id', [...agentIds]);
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const a of (agentRows || []) as Array<{ id: string; name: string }>) {
          map[a.id] = a.name || '';
        }
        setAgentNames(map);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [proposalId]);

  const subtitle = (
    <span style={{ color: 'var(--text-secondary)' }}>
      {propertyName} · {proposalRefCode}
    </span>
  );

  return (
    <ActionModal
      title="Pricing history"
      subtitle={subtitle}
      width={620}
      onClose={onClose}
      hideFooter
    >
      {loading ? (
        <div style={emptyStyle}>Loading…</div>
      ) : versions.length === 0 ? (
        <div style={emptyStyle}>No pricing history yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
          {versions.map((v, i) => {
            const isCurrent = v.id === currentPricingProposalId;
            // Newest is at index 0 so the version label counts down from
            // the total. Older = lower number — keeps "v1 = first save"
            // consistent with the agent portal.
            const versionNumber = versions.length - i;
            return (
              <VersionCard
                key={v.id}
                version={v}
                versionNumber={versionNumber}
                isCurrent={isCurrent}
                agentNames={agentNames}
              />
            );
          })}
        </div>
      )}
    </ActionModal>
  );
}

function VersionCard({
  version, versionNumber, isCurrent, agentNames,
}: {
  version: Version;
  versionNumber: number;
  isCurrent: boolean;
  agentNames: Record<string, string>;
}) {
  const v = version;
  const guestPrice = v.client_price_excl_vat != null ? Math.round(Number(v.client_price_excl_vat)) : null;
  const ownerNet = v.owner_net != null ? Math.round(Number(v.owner_net)) : null;
  const ctrTake = v.company_take != null ? Math.round(Number(v.company_take)) : null;
  // Total agent take = guest − owner − CTR. Split by agents JSONB.
  const totalAgentTake = (guestPrice != null && ownerNet != null && ctrTake != null)
    ? guestPrice - ownerNet - ctrTake
    : null;
  const agents = Array.isArray(v.agents) ? v.agents.filter(a => !!a?.id) : [];
  const totalPct = agents.reduce((s, a) => s + (Number(a.pct) || 0), 0);

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: isCurrent ? 'var(--color-primary-bg)' : 'var(--surface)',
        padding: 'var(--s-3) var(--s-4)',
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 'var(--s-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text)' }}>
            v{versionNumber}
          </span>
          {isCurrent && (
            <span style={{
              fontSize: '0.625rem',
              fontWeight: 700,
              color: 'var(--color-primary)',
              background: '#fff',
              border: '1px solid var(--color-primary)',
              padding: '1px 6px',
              borderRadius: 4,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              Current
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Saved {fmtDateTime(v.created_at)}
        </span>
      </div>

      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <tbody>
          <Row label="Guest pays / night"   value={guestPrice} />
          <Row label="Owner gets / night"   value={ownerNet} />
          <Row label="Southern Escapes"     value={ctrTake} />
          {agents.length === 0 && totalAgentTake != null && totalAgentTake > 0 && (
            <Row label="Agent commission"   value={totalAgentTake} highlight />
          )}
          {agents.length > 0 && totalAgentTake != null && totalAgentTake > 0 && agents.map(a => {
            const share = totalPct > 0
              ? Math.round((Number(a.pct) / totalPct) * totalAgentTake)
              : null;
            return (
              <Row
                key={a.id}
                label={`${agentNames[a.id] || 'Agent'} (${Number(a.pct).toFixed(0)}%)`}
                value={share}
                highlight
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: number | null; highlight?: boolean }) {
  return (
    <tr>
      <td style={{
        padding: '4px 0',
        fontSize: '0.8125rem',
        color: highlight ? 'var(--color-primary)' : 'var(--text-secondary)',
        fontWeight: highlight ? 600 : 400,
      }}>
        {label}
      </td>
      <td style={{
        padding: '4px 0',
        textAlign: 'right',
        fontSize: '0.875rem',
        fontWeight: highlight ? 700 : 600,
        color: highlight ? 'var(--color-primary)' : 'var(--text)',
      }}>
        {value != null ? fmtRand(value) : '—'}
      </td>
    </tr>
  );
}

function fmtRand(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`;
}

function fmtDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

const emptyStyle: React.CSSProperties = {
  padding: 'var(--s-6) var(--s-3)',
  textAlign: 'center',
  fontSize: '0.875rem',
  color: 'var(--text-secondary)',
};
