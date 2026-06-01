/**
 * EnquiryMatchPage -- /enquiry/new/match
 *
 * Step 2 of the direct-enquiry flow. The user fills /enquiry/new,
 * clicks Continue, lands here with the form data carried via the
 * router's location.state. Renders the property match modal as the
 * page's primary surface.
 *
 * On a hard refresh location.state is gone — we redirect back to
 * /enquiry/new rather than trying to render with a half-empty
 * enquiry payload.
 */

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import EnquiryPropertyMatchModal, { type PendingEnquiry } from '../components/EnquiryPropertyMatchModal';

export default function EnquiryMatchPage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { enquiry?: PendingEnquiry; initiallySelected?: string[] | null } | null;
  const enquiry = state?.enquiry ?? null;
  const initiallySelected = state?.initiallySelected ?? null;

  useEffect(() => { setPageTitle('Pick properties to quote'); }, [setPageTitle]);

  // No state means the user landed here directly (deep-link or
  // refresh) — bounce back to step 1 rather than render a broken
  // form. Replace history so back-button doesn't loop them here.
  useEffect(() => {
    if (!enquiry) navigate('/enquiry/new', { replace: true });
  }, [enquiry, navigate]);

  if (!enquiry) return null;

  return (
    <EnquiryPropertyMatchModal
      supabase={supabase}
      enquiry={enquiry}
      initiallySelected={initiallySelected}
      onClose={() => navigate('/enquiry/new', { state: { enquiry } })}
      onSaved={(enquiryId) => {
        navigate(`/operations/enquiries?deal=${encodeURIComponent(enquiryId)}&highlight=1`);
      }}
    />
  );
}
