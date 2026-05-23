/**
 * HomePage — the landing page.
 *
 * v1 deliberately minimal:
 *   - Quick actions for the most common things (new enquiry, proposal,
 *     booking, brochure share). Same set as the FAB so the entry point
 *     is consistent.
 *   - A placeholder section inviting the team to tell us what else
 *     should live here. The full design (Today / Action queue / Stale
 *     items / etc) gets built after we've actually heard from the
 *     people who land here every morning.
 *
 * Uses only the shared design-system classes (.card, .btn variants,
 * .detail-modal-section-heading shape). No bespoke .home-* prefix.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { CT_RENTALS_PARTNER_ID } from './constants';
import NewProposalLauncher from '../components/NewProposalLauncher';
import SendBrochurePicker from '../components/SendBrochurePicker';
import BookingModal from './BookingModal';

export default function HomePage() {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();
  const navigate = useNavigate();

  const [proposalLauncherOpen, setProposalLauncherOpen] = useState(false);
  const [brochurePickerOpen, setBrochurePickerOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingProperties, setBookingProperties] = useState<any[]>([]);

  // Pull a first name out of the email local-part — "hayley.harrod@x"
  // → Hayley. Falls back to "Welcome back" when there's no email.
  useEffect(() => {
    const local = (user?.email || '').split('@')[0].split('.')[0];
    const name = local ? local.charAt(0).toUpperCase() + local.slice(1) : '';
    setPageTitle(name ? `Welcome back, ${name}` : 'Welcome back');
  }, [setPageTitle, user?.email]);

  /** Lazy-load properties only when the user opens the booking flow. */
  async function openBooking() {
    const { data } = await supabase
      .from('partner_properties')
      .select('id, property_name, suburb, city, bedrooms, hero_image_url, is_published')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('property_name');
    setBookingProperties(data || []);
    setBookingOpen(true);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Quick actions — same set as the FAB so the entry point is
          consistent whether the user is on the dashboard or anywhere else. */}
      <div className="card" style={{ padding: 16 }}>
        <div className="detail-modal-section-heading" style={{ marginBottom: 12 }}>
          Quick actions
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate('/enquiry/new')}>
            💬 New enquiry
          </button>
          <button className="btn btn-outline" onClick={() => setProposalLauncherOpen(true)}>
            📝 New proposal
          </button>
          <button className="btn btn-outline" onClick={openBooking}>
            📅 New booking
          </button>
          <button className="btn btn-outline" onClick={() => setBrochurePickerOpen(true)}>
            📄 Send brochure
          </button>
        </div>
      </div>

      {/* Placeholder content prompt — honest about being a work in progress
          without feeling broken. Team feedback shapes what lands here next. */}
      <div className="card" style={{ padding: 20 }}>
        <div className="detail-modal-section-heading" style={{ marginBottom: 12 }}>
          What would you like to see here?
        </div>
        <p style={{ margin: '0 0 12px', color: 'var(--text)', fontSize: '0.9375rem', lineHeight: 1.5 }}>
          This dashboard is the first thing you see each day. We're rebuilding
          it around what actually matters to you — the team — rather than
          guessing. A few candidate things we could surface:
        </p>
        <ul style={{ margin: '0 0 16px 20px', color: 'var(--text)', fontSize: '0.9375rem', lineHeight: 1.7 }}>
          <li>Today's arrivals, departures, and guests in-stay</li>
          <li>Enquiries waiting for a proposal</li>
          <li>Proposals sent but unviewed for a few days</li>
          <li>Bookings missing payment confirmation</li>
          <li>This week's bookings count + value, conversion rate</li>
          <li>Anything else that would save you 3+ clicks every morning</li>
        </ul>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8125rem', fontStyle: 'italic' }}>
          Mention what you'd actually use next time we catch up. The dashboard
          gets rebuilt around your answers — nothing here is fixed.
        </p>
      </div>

      {proposalLauncherOpen && (
        <NewProposalLauncher onClose={() => setProposalLauncherOpen(false)} />
      )}

      {brochurePickerOpen && (
        <SendBrochurePicker onClose={() => setBrochurePickerOpen(false)} />
      )}

      {bookingOpen && (
        <BookingModal
          booking={{}}
          properties={bookingProperties}
          supabase={supabase}
          user={user}
          partnerId={CT_RENTALS_PARTNER_ID}
          onClose={() => setBookingOpen(false)}
          onSave={() => setBookingOpen(false)}
        />
      )}
    </div>
  );
}
