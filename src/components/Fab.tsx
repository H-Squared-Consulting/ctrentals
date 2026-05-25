/* eslint-disable */
// @ts-nocheck
/**
 * Fab — persistent floating action button. Bottom-right of every signed-in
 * page; fans out to the four most common entry points:
 *   New Enquiry · New Proposal · New Booking · Send Brochure
 *
 * Click the "+" to open / close. Click outside or hit Escape to close.
 * Send Brochure opens a property picker modal (active properties only),
 * each row exposes copy-link / WhatsApp / email straight from the picker.
 * New Booking opens the same BookingModal used on the Bookings calendar,
 * with the active properties loaded so the user can pick one inside.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import SendBrochurePicker from './SendBrochurePicker';
import NewProposalLauncher from './NewProposalLauncher';
import BookingModal from '../pages/BookingModal';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';

export default function Fab() {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [proposalLauncherOpen, setProposalLauncherOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingProperties, setBookingProperties] = useState<any[]>([]);
  const navigate = useNavigate();
  const { supabase, user } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside + Escape close the fan-out.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** Lazy-load active properties only when the user clicks New booking —
   *  the FAB is on every page so an eager fetch would be wasted bandwidth. */
  async function openBooking() {
    setOpen(false);
    const { data } = await supabase
      .from('partner_properties')
      .select('id, property_name, suburb, city, bedrooms, hero_image_url, is_published')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('property_name');
    setBookingProperties(data || []);
    setBookingOpen(true);
  }

  function trigger(action: 'enquiry' | 'proposal' | 'booking' | 'brochure') {
    setOpen(false);
    if (action === 'enquiry') navigate('/enquiry/new');
    else if (action === 'proposal') setProposalLauncherOpen(true);
    else if (action === 'booking') openBooking();
    else if (action === 'brochure') setPickerOpen(true);
  }

  return (
    <>
      <div className="fab-root" ref={rootRef}>
        {open && (
          <div className="fab-menu" role="menu">
            <button className="fab-action" onClick={() => trigger('enquiry')}>
              <span className="fab-action-icon">💬</span>
              <span className="fab-action-label">New enquiry</span>
            </button>
            {/* "New proposal" hidden — proposals are now always
                created against an enquiry via the property match
                step. The standalone-proposal FAB entry was a
                holdover from the old flow. */}
            <button className="fab-action" onClick={() => trigger('booking')}>
              <span className="fab-action-icon">📅</span>
              <span className="fab-action-label">New booking</span>
            </button>
            <button className="fab-action" onClick={() => trigger('brochure')}>
              <span className="fab-action-icon">📄</span>
              <span className="fab-action-label">Send brochure</span>
            </button>
          </div>
        )}
        <button
          className={`fab-trigger ${open ? 'is-open' : ''}`}
          onClick={() => setOpen(v => !v)}
          aria-label={open ? 'Close quick actions' : 'Quick actions'}
          aria-expanded={open}
        >
          <span className="fab-trigger-plus">+</span>
        </button>
      </div>

      {pickerOpen && (
        <SendBrochurePicker onClose={() => setPickerOpen(false)} />
      )}

      {proposalLauncherOpen && (
        <NewProposalLauncher onClose={() => setProposalLauncherOpen(false)} />
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
    </>
  );
}
