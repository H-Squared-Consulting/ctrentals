/**
 * AgentPortalEnquiryFlow -- the agent's single-step enquiry path.
 *
 * The agent fills in a brief (dates, party size, beds, price tier,
 * optional guest details) and submits. The search filter logic still
 * runs silently in the background — it resolves the agent's allow-list
 * against the filters and persists the matching propertyIds against
 * the enquiry — but the agent never sees the houses themselves.
 *
 * Why no matches screen? The whole point of the agent portal is that
 * agents brief us and we (Nicki + Hayley) decide what to come back
 * with. Surfacing match cards turned the portal into a half-shopping
 * surface; this brief-only version keeps every shred of catalogue
 * identity inside the admin portal.
 */

import { useState } from 'react';
import { useToast } from './ToastProvider';
import ActionModal from './ActionModal';
import DateInput from './DateInput';
import NumericMultiSelect from './NumericMultiSelect';
import {
  searchAgentMatches,
  submitAgentEnquiry,
  type AgentTierKey,
  type AgentPriceTiers,
} from '../lib/agentPortal';

const TIER_ORDER: AgentTierKey[] = ['very_low', 'low', 'medium', 'high', 'very_high'];
const TIER_LABELS: Record<AgentTierKey, string> = {
  very_low:  'Very low',
  low:       'Low',
  medium:    'Medium',
  high:      'High',
  very_high: 'Very high',
};

const EMPTY_FILTERS = {
  subject: '',
  checkIn: '',
  checkOut: '',
  adults: '2',
  children: '0',
  notes: '',
  guestName: '',
  guestEmail: '',
  guestPhone: '',
  guestNationality: '',
};

function fmtRand(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`;
}

/** Range subtitle for a price-tier chip — same wording as the admin
 *  PriceBucketFilter. The agent only sees the bracket label here,
 *  never a specific house's rate. */
function tierRangeLabel(tier: AgentTierKey, t: AgentPriceTiers): string {
  switch (tier) {
    case 'very_low':  return `up to ${fmtRand(t.t1)}`;
    case 'low':       return `${fmtRand(t.t1)} – ${fmtRand(t.t2)}`;
    case 'medium':    return `${fmtRand(t.t2)} – ${fmtRand(t.t3)}`;
    case 'high':      return `${fmtRand(t.t3)} – ${fmtRand(t.t4)}`;
    case 'very_high': return `above ${fmtRand(t.t4)}`;
  }
}

export default function AgentPortalEnquiryFlow({
  token,
  tierThresholds,
  existingSubjects,
  onClose,
  onSubmitted,
}: {
  token: string;
  tierThresholds: AgentPriceTiers | null;
  existingSubjects: string[];
  onClose: () => void;
  onSubmitted: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [bedrooms, setBedrooms] = useState<number[]>([]);
  const [priceTiers, setPriceTiers] = useState<AgentTierKey[]>([]);
  const [guestSectionOpen, setGuestSectionOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function setField<K extends keyof typeof EMPTY_FILTERS>(key: K, value: string) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  function toggleTier(k: AgentTierKey) {
    setPriceTiers(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  }
  // Auto-fill highlight — same UX as PriceBucketFilter. Picking Very
  // low + High visually marks Low + Medium too so the agent sees
  // exactly which bands their range will catch, even though only the
  // explicit picks are stored.
  const tierOrderIdx = (t: AgentTierKey) => TIER_ORDER.indexOf(t);
  const sortedTierPicks = [...priceTiers].sort((a, b) => tierOrderIdx(a) - tierOrderIdx(b));
  const tierLoIdx = sortedTierPicks.length > 0 ? tierOrderIdx(sortedTierPicks[0]) : -1;
  const tierHiIdx = sortedTierPicks.length > 0 ? tierOrderIdx(sortedTierPicks[sortedTierPicks.length - 1]) : -1;
  const inTierAutoRange = (t: AgentTierKey) => {
    const i = tierOrderIdx(t);
    return tierLoIdx >= 0 && i >= tierLoIdx && i <= tierHiIdx;
  };

  const subjectKey = filters.subject.trim().toLowerCase();
  const isDuplicateSubject = subjectKey.length > 0 && existingSubjects.includes(subjectKey);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submitting) return;
    if (!filters.subject.trim())               { toast.warning('Add a short reference so you can find this enquiry later'); return; }
    if (isDuplicateSubject)                    { toast.warning('You already have an enquiry with this subject — pick a unique label'); return; }
    if (!filters.checkIn || !filters.checkOut) { toast.warning('Check-in and check-out dates are required'); return; }
    if (filters.checkIn >= filters.checkOut)   { toast.warning('Check-out must be after check-in'); return; }
    if (priceTiers.length === 0)               { toast.warning('Pick at least one price tier'); return; }

    const adults = Number(filters.adults) || 0;
    const children = Number(filters.children) || 0;
    const minSleeps = adults + children;

    setSubmitting(true);
    try {
      // Run the search silently to attach the matching property IDs to
      // the enquiry. The agent never sees the matches — the IDs land
      // on the deal in the admin pipeline so Nicki + Hayley can spin
      // up proposals against the right houses immediately.
      const matches = await searchAgentMatches(token, {
        checkIn:    filters.checkIn,
        checkOut:   filters.checkOut,
        bedrooms,
        minSleeps,
        priceTiers,
      });
      const propertyIds = matches.map(m => m.id);

      const result = await submitAgentEnquiry({
        token,
        propertyIds,
        agentReference:    filters.subject.trim(),
        guestName:         filters.guestName.trim(),
        guestEmail:        filters.guestEmail.trim(),
        guestPhone:        filters.guestPhone.trim(),
        guestNationality:  filters.guestNationality.trim(),
        checkIn:           filters.checkIn,
        checkOut:          filters.checkOut,
        guestsAdults:      adults,
        guestsChildren:    children,
        budgetTiers:       priceTiers,
        notes:             filters.notes.trim(),
      });
      if (!result.ok) {
        if (result.reason === 'duplicate-subject') {
          toast.error('You already have an enquiry with this subject — pick a unique label and try again.');
        } else {
          toast.error('Could not submit enquiry: ' + (result.reason || 'unknown error'));
        }
        return;
      }
      toast.success('Enquiry sent. The Southern Escapes team will be in touch shortly.');
      await onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  const filtersComplete =
    !!filters.subject.trim() &&
    !isDuplicateSubject &&
    !!filters.checkIn &&
    !!filters.checkOut &&
    filters.checkIn < filters.checkOut &&
    priceTiers.length > 0;

  const primary = (
    <button
      type="submit"
      form="agent-enquiry-flow-form"
      className="btn btn-primary"
      disabled={submitting || !filtersComplete}
      title={
        filtersComplete
          ? undefined
          : isDuplicateSubject
            ? 'Subject must be unique across your enquiries'
            : 'Fill in subject, both dates, and at least one price tier'
      }
    >
      {submitting ? 'Submitting…' : 'Submit enquiry'}
    </button>
  );

  return (
    <ActionModal
      title="Submit an enquiry"
      subtitle="Tell us the stay details. We’ll match it to your portfolio and come back to you with a proposal."
      width={760}
      primaryAction={primary}
      onClose={onClose}
    >
      <form id="agent-enquiry-flow-form" onSubmit={submit}>
        {/* Subject */}
        <div className="form-group" style={{ marginBottom: 'var(--s-3)' }}>
          <label className="form-label">Subject *</label>
          <input
            className="form-input"
            value={filters.subject}
            onChange={(e) => setField('subject', e.target.value)}
            placeholder="e.g. Sarah & Mark, Easter trip"
            maxLength={120}
            required
            autoFocus
            style={isDuplicateSubject ? { borderColor: 'var(--error, #DC2626)' } : undefined}
            aria-invalid={isDuplicateSubject || undefined}
          />
          {isDuplicateSubject ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--error, #DC2626)', marginTop: 4 }}>
              Invalid subject — you already have an enquiry called "{filters.subject.trim()}". Pick a unique label so you can tell them apart.
            </div>
          ) : (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              For your own reference — appears on your My Enquiries list.
            </div>
          )}
        </div>

        {/* Dates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)' }}>
          <div className="form-group">
            <label className="form-label">Check-in *</label>
            <DateInput
              className="form-input"
              value={filters.checkIn}
              onChange={(v) => setField('checkIn', v)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Check-out *</label>
            <DateInput
              className="form-input"
              value={filters.checkOut}
              onChange={(v) => setField('checkOut', v)}
            />
          </div>
        </div>

        {/* Party size */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)' }}>
          <div className="form-group">
            <label className="form-label">Adults</label>
            <input
              className="form-input"
              type="number"
              min={0}
              value={filters.adults}
              onChange={(e) => setField('adults', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Children</label>
            <input
              className="form-input"
              type="number"
              min={0}
              value={filters.children}
              onChange={(e) => setField('children', e.target.value)}
            />
          </div>
        </div>

        {/* Nationality */}
        <div className="form-group" style={{ marginBottom: 'var(--s-3)' }}>
          <label className="form-label">Guest nationality</label>
          <input
            className="form-input"
            value={filters.guestNationality}
            onChange={(e) => setField('guestNationality', e.target.value)}
            placeholder="e.g. United Kingdom"
            maxLength={60}
          />
        </div>

        {/* Bedrooms */}
        <div className="form-group" style={{ marginBottom: 'var(--s-3)' }}>
          <label className="form-label">Bedrooms</label>
          <NumericMultiSelect
            max={10}
            value={bedrooms}
            onChange={setBedrooms}
            placeholder="Any number of bedrooms"
            singular="bedroom"
            plural="bedrooms"
          />
        </div>

        {/* Price tier multi-select */}
        <div className="form-group" style={{ marginBottom: 'var(--s-3)' }}>
          <label className="form-label">Price tier *</label>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            gap: 6,
          }}>
            {TIER_ORDER.map(tier => {
              const explicit = priceTiers.includes(tier);
              const auto = inTierAutoRange(tier);
              const highlight = explicit || auto;
              return (
                <button
                  key={tier}
                  type="button"
                  className={`btn ${highlight ? 'btn-primary' : 'btn-outline'}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    padding: '10px 6px',
                    lineHeight: 1.25,
                    minHeight: 56,
                    opacity: highlight && !explicit ? 0.85 : 1,
                  }}
                  onClick={() => toggleTier(tier)}
                  title={
                    explicit
                      ? `Remove ${TIER_LABELS[tier]} from the selection`
                      : auto
                        ? 'Auto-included by your range — click to lock it in explicitly'
                        : `Add ${TIER_LABELS[tier]} to the selection`
                  }
                >
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{TIER_LABELS[tier]}</span>
                  {tierThresholds && (
                    <span style={{
                      fontSize: '0.6875rem',
                      color: highlight ? 'rgba(255,255,255,0.85)' : 'var(--text-light)',
                      whiteSpace: 'nowrap',
                    }}>
                      {tierRangeLabel(tier, tierThresholds)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 6 }}>
            Pick one or more bands — gaps fill in automatically (Very low + High picks everything between).
          </div>
        </div>

        {/* Notes */}
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea
            className="form-input"
            rows={3}
            value={filters.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="Anything we should know — special occasions, dietary needs, accessibility, expected arrival time, etc."
          />
        </div>

        {/* Optional guest section */}
        <div style={{
          marginTop: 'var(--s-3)',
          paddingTop: 'var(--s-3)',
          borderTop: '1px solid var(--border-light)',
        }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
            Guest details (if known)
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--s-2)' }}>
            Optional — leave blank if you can't share the guest yet.
          </div>
          {guestSectionOpen ? (
            <>
              <div className="form-group" style={{ marginBottom: 'var(--s-3)' }}>
                <label className="form-label">Guest name</label>
                <input
                  className="form-input"
                  value={filters.guestName}
                  onChange={(e) => setField('guestName', e.target.value)}
                  placeholder="e.g. Sarah Whitmore"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)' }}>
                <div className="form-group">
                  <label className="form-label">Guest email</label>
                  <input
                    className="form-input"
                    type="email"
                    value={filters.guestEmail}
                    onChange={(e) => setField('guestEmail', e.target.value)}
                    placeholder="guest@example.com"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Guest phone</label>
                  <input
                    className="form-input"
                    value={filters.guestPhone}
                    onChange={(e) => setField('guestPhone', e.target.value)}
                    placeholder="+27 …"
                  />
                </div>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: '0.8125rem' }}
              onClick={() => setGuestSectionOpen(true)}
            >
              + Add guest details
            </button>
          )}
        </div>
      </form>
    </ActionModal>
  );
}
