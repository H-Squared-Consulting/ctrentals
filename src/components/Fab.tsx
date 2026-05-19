/* eslint-disable */
// @ts-nocheck
/**
 * Fab — persistent floating action button. Bottom-right of every signed-in
 * page; fans out to the three most common entry points per the doc:
 *   New Enquiry · New Proposal · Send Brochure
 *
 * Click the "+" to open / close. Click outside or hit Escape to close.
 * Send Brochure opens a property picker modal (active properties only),
 * each row exposes copy-link / WhatsApp / email straight from the picker.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SendBrochurePicker from './SendBrochurePicker';
import NewProposalLauncher from './NewProposalLauncher';

export default function Fab() {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [proposalLauncherOpen, setProposalLauncherOpen] = useState(false);
  const navigate = useNavigate();
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

  function trigger(action: 'enquiry' | 'proposal' | 'brochure') {
    setOpen(false);
    if (action === 'enquiry') navigate('/enquiry/new');
    else if (action === 'proposal') setProposalLauncherOpen(true);
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
            <button className="fab-action" onClick={() => trigger('proposal')}>
              <span className="fab-action-icon">📝</span>
              <span className="fab-action-label">New proposal</span>
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
    </>
  );
}
