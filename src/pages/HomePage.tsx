/**
 * HomePage -- the "what should I do next" landing page.
 *
 * Three sections, ordered by usefulness:
 *   1. Quick actions       — start a new enquiry / proposal without hunting.
 *   2. Action queue        — counts per Pipeline stage; click → Pipeline.
 *   3. Needs your attention — hand-picked stale / time-sensitive items
 *                             across stages, each linking to the relevant
 *                             deal in Pipeline (via the search param).
 *
 * Mirrors the data model from PipelinePage so the same "deal" abstraction
 * (enquiry + proposals, or standalone proposal) drives both screens.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { CT_RENTALS_PARTNER_ID } from './constants';
import NewProposalLauncher from '../components/NewProposalLauncher';
import SendBrochurePicker from '../components/SendBrochurePicker';
import { onPipelineChanged } from '../lib/pipelineEvents';

// ── Tunables ────────────────────────────────────────────────────────────
// Thresholds for what counts as "stale" or "soon" in the attention list.
// Same values as Pipeline's stale-dot logic so the two views agree.
const STALE_ENQUIRY_DAYS = 3;
const STALE_DRAFT_DAYS = 2;
const SOON_CHECKIN_DAYS = 14;

// ── Types ───────────────────────────────────────────────────────────────

interface ProposalRow {
  id: string;
  status: string;
  guest_name: string;
  check_in: string | null;
  check_out: string | null;
  property_name: string;
  created_at: string;
}

interface Deal {
  key: string;
  type: 'enquiry' | 'standalone';
  client_name: string;
  created_at: string;
  check_in: string | null;
  check_out: string | null;
  manual_status: string | null;
  proposals: ProposalRow[];
  is_agent: boolean;
}

interface AttentionItem {
  key: string;
  reason: 'enquiry_stale' | 'draft_stale' | 'interested_soon' | 'checkin_soon';
  title: string;
  detail: string;
  urgencyDays: number;        // -ve = past (overdue), 0 = today, +ve = days away
  searchTerm: string;          // pre-fills Pipeline's search box
}

// ── Helpers ─────────────────────────────────────────────────────────────

const INACTIVE_PROPOSAL_STATUSES = new Set(['expired', 'archived', 'booked', 'cancelled']);

function dealStage(d: Deal): 'to_quote' | 'quoted' | 'sent' | 'interested' | 'closed' {
  if (d.manual_status === 'booked' || d.manual_status === 'cancelled') return 'closed';
  const active = d.proposals.filter(p => !INACTIVE_PROPOSAL_STATUSES.has(p.status));
  if (d.type === 'standalone' && active.length === 0) return 'closed';
  if (active.length === 0) return 'to_quote';
  if (active.some(p => p.status === 'interested')) return 'interested';
  if (active.some(p => p.status === 'sent' || p.status === 'viewed')) return 'sent';
  return 'quoted';
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function daysSince(iso: string): number {
  return daysBetween(new Date(iso), new Date());
}

function daysUntil(iso: string): number {
  return daysBetween(new Date(), new Date(iso));
}

// ── Page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();
  const navigate = useNavigate();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [proposalLauncherOpen, setProposalLauncherOpen] = useState(false);
  const [brochurePickerOpen, setBrochurePickerOpen] = useState(false);

  // Pull a first name out of the email local-part — "jordon.harrod@x" → Jordon.
  // Falls back to "Welcome back" when there's no email (shouldn't happen
  // inside ProtectedRoute, but the page should still render).
  useEffect(() => {
    const local = (user?.email || '').split('@')[0].split('.')[0];
    const name = local ? local.charAt(0).toUpperCase() + local.slice(1) : '';
    setPageTitle(name ? `Welcome back, ${name}` : 'Welcome back');
  }, [setPageTitle, user?.email]);

  async function fetchDeals() {
    const [enqRes, standaloneRes] = await Promise.all([
      supabase
        .from('enquiries')
        .select('*, proposals(*, partner_properties(property_name))')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .order('created_at', { ascending: false }),
      supabase
        .from('proposals')
        .select('*, partner_properties(property_name)')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .is('enquiry_id', null)
        .order('created_at', { ascending: false }),
    ]);

    const mapProp = (p: any): ProposalRow => ({
      id: p.id,
      status: p.status,
      guest_name: p.guest_name,
      check_in: p.check_in,
      check_out: p.check_out,
      property_name: p.partner_properties?.property_name || '—',
      created_at: p.created_at,
    });

    const fromEnquiries: Deal[] = (enqRes.data || []).map((e: any) => ({
      key: e.id,
      type: 'enquiry' as const,
      client_name: e.client_name,
      created_at: e.created_at,
      check_in: e.check_in,
      check_out: e.check_out,
      manual_status: e.status,
      proposals: (e.proposals || []).map(mapProp),
      is_agent: (e.proposals || []).some((p: any) => p.is_agent),
    }));

    const fromStandalone: Deal[] = (standaloneRes.data || []).map((p: any) => ({
      key: `p-${p.id}`,
      type: 'standalone' as const,
      client_name: p.guest_name,
      created_at: p.created_at,
      check_in: p.check_in,
      check_out: p.check_out,
      manual_status: null,
      proposals: [mapProp(p)],
      is_agent: !!p.is_agent,
    }));

    setDeals([...fromEnquiries, ...fromStandalone]);
    setLoading(false);
  }

  useEffect(() => {
    if (!supabase) return;
    setLoading(true);
    fetchDeals();
  }, [supabase]);

  // Stay in sync with mutations made elsewhere (Pipeline, Property editor,
  // FAB-launched new proposal). Cheap because the dataset is small.
  useEffect(() => onPipelineChanged(() => { fetchDeals(); }), [supabase]);

  // ── Derived counts + attention list ──
  const { counts, attention } = useMemo(() => {
    const counts = { to_quote: 0, quoted: 0, sent: 0, interested: 0 };
    const items: AttentionItem[] = [];

    for (const d of deals) {
      const stage = dealStage(d);
      if (stage in counts) (counts as any)[stage] += 1;

      // Item 1: enquiry sitting un-quoted for too long.
      if (stage === 'to_quote') {
        const age = daysSince(d.created_at);
        if (age >= STALE_ENQUIRY_DAYS) {
          items.push({
            key: `enq-${d.key}`,
            reason: 'enquiry_stale',
            title: d.client_name,
            detail: `Waiting ${age} day${age === 1 ? '' : 's'} without a proposal`,
            urgencyDays: -age,
            searchTerm: d.client_name,
          });
        }
      }

      // Item 2: draft proposal not yet sent. Use the oldest unsent draft.
      if (stage === 'quoted') {
        const drafts = d.proposals
          .filter(p => p.status === 'draft')
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const oldest = drafts[0];
        if (oldest) {
          const age = daysSince(oldest.created_at);
          if (age >= STALE_DRAFT_DAYS) {
            items.push({
              key: `draft-${oldest.id}`,
              reason: 'draft_stale',
              title: d.client_name,
              detail: `Draft for ${oldest.property_name} unsent for ${age} day${age === 1 ? '' : 's'}`,
              urgencyDays: -age,
              searchTerm: d.client_name,
            });
          }
        }
      }

      // Item 3: interested + check-in approaching. Hot leads.
      if (stage === 'interested' && d.check_in) {
        const until = daysUntil(d.check_in);
        if (until >= 0 && until <= SOON_CHECKIN_DAYS) {
          items.push({
            key: `int-${d.key}`,
            reason: 'interested_soon',
            title: d.client_name,
            detail: until === 0
              ? `Interested · check-in today`
              : `Interested · check-in in ${until} day${until === 1 ? '' : 's'}`,
            urgencyDays: until,
            searchTerm: d.client_name,
          });
        }
      }
    }

    // Sort by urgency: most overdue first, then check-ins soonest first.
    items.sort((a, b) => a.urgencyDays - b.urgencyDays);

    return { counts, attention: items };
  }, [deals]);

  // ── Render ──
  return (
    <div className="home-page">
      {/* Summary line sits under the page header — quietly tells the user
          how loaded their day is without an attention-grabbing banner. */}
      <p className="home-summary">
        {loading ? 'Loading your pipeline…' : attentionSummary(attention.length, counts)}
      </p>

      <div className="home-quick-actions">
        <button className="btn btn-primary" onClick={() => navigate('/enquiry/new')}>
          + New Enquiry
        </button>
        <button className="btn btn-outline" onClick={() => setProposalLauncherOpen(true)}>
          + New Proposal
        </button>
        <button className="btn btn-outline" onClick={() => setBrochurePickerOpen(true)}>
          ✉ Send Brochure
        </button>
        <Link to="/operations/enquiries" className="btn btn-ghost">
          Open Operations →
        </Link>
      </div>

      {/* Action queue — counts per Pipeline stage. Each card is a link */}
      <section className="home-section">
        <h3 className="home-section-title">Action queue (test 1)</h3>
        <div className="home-cards">
          <ActionCard
            label="Enquiry"
            sub="Needs a proposal"
            count={counts.to_quote}
            stageKey="to_quote"
            tone="warn"
          />
          <ActionCard
            label="Proposal created"
            sub="Drafts not sent"
            count={counts.quoted}
            stageKey="quoted"
            tone="info"
          />
          <ActionCard
            label="Proposal Sent"
            sub="Awaiting reply"
            count={counts.sent}
            stageKey="sent"
            tone="neutral"
          />
          <ActionCard
            label="Interested"
            sub="Close the sale"
            count={counts.interested}
            stageKey="interested"
            tone="good"
          />
        </div>
      </section>

      {/* Needs your attention — stale items across stages */}
      <section className="home-section">
        <h3 className="home-section-title">Needs your attention</h3>
        {loading ? (
          <div className="home-empty">Loading…</div>
        ) : attention.length === 0 ? (
          <div className="home-empty">
            <strong>You're all clear.</strong>
            <span>No stale enquiries, drafts, or near-term interested leads.</span>
          </div>
        ) : (
          <div className="home-attention">
            {attention.map(it => (
              <Link
                key={it.key}
                to={`/operations/pipeline?search=${encodeURIComponent(it.searchTerm)}`}
                className={`home-attention-row home-attention-row--${it.reason}`}
              >
                <span className={`home-attention-dot home-attention-dot--${it.reason}`} aria-hidden />
                <div className="home-attention-text">
                  <div className="home-attention-title">{it.title}</div>
                  <div className="home-attention-detail">{it.detail}</div>
                </div>
                <span className="home-attention-arrow">→</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {proposalLauncherOpen && (
        <NewProposalLauncher onClose={() => setProposalLauncherOpen(false)} />
      )}

      {brochurePickerOpen && (
        <SendBrochurePicker onClose={() => setBrochurePickerOpen(false)} />
      )}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────

function ActionCard({
  label, sub, count, stageKey, tone,
}: {
  label: string;
  sub: string;
  count: number;
  stageKey: 'to_quote' | 'quoted' | 'sent' | 'interested';
  tone: 'warn' | 'info' | 'neutral' | 'good';
}) {
  // Empty stages stay visible but muted — gives the eye a steady layout
  // and confirms there's nothing pending without the user wondering.
  return (
    <Link
      to={`/operations/pipeline?stage=${stageKey}`}
      className={`home-card home-card--${tone} ${count === 0 ? 'home-card--empty' : ''}`}
    >
      <div className="home-card-top">
        <span className="home-card-tonedot" aria-hidden />
        <span className="home-card-label">{label}</span>
        <span className="home-card-count">{count}</span>
      </div>
      <div className="home-card-sub">{sub}</div>
    </Link>
  );
}

function attentionSummary(
  attentionCount: number,
  counts: { to_quote: number; quoted: number; sent: number; interested: number },
): string {
  const total = counts.to_quote + counts.quoted + counts.sent + counts.interested;
  if (total === 0) return 'No active deals right now.';
  if (attentionCount === 0) return `${total} active deal${total === 1 ? '' : 's'}, nothing urgent.`;
  return `${attentionCount} item${attentionCount === 1 ? '' : 's'} need attention out of ${total} active deal${total === 1 ? '' : 's'}.`;
}
