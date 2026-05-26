/**
 * DetailModal — the standard Tier A detail-modal shell.
 *
 * Owns the visual shape every CT Rentals entity editor shares:
 *   - centred 880px dialog (near-full-screen on mobile)
 *   - coloured 5px accent strip up top
 *   - header: title + mode pill + sub-line + Edit/Save/Cancel + close
 *   - body: scrollable, sections rendered by the caller via children
 *   - footer: action buttons + hint, tinted background
 *   - dirty-check on close in edit mode
 *
 * One source of truth for the look. Callers (DealDetailModal,
 * ProposalDetailModal, BookingModal, etc.) provide content and
 * action buttons; everything else is handled here.
 */

import { useEffect, type ReactNode } from 'react';
import { useDirty } from '../lib/dirtyState';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { useModalStack } from '../contexts/ModalStackContext';

export type DetailModalMode = 'view' | 'edit';

interface DetailModalProps {
  /** Main heading text, e.g. the entity's name. Title-cased by the caller. */
  title: string;
  /** Optional sub-line under the title (stage, dates, type, etc.). */
  subtitle?: ReactNode;
  /** Top accent strip colour. Pass a CSS colour or var(). Defaults to info blue. */
  accentColour?: string;
  /** Current mode. When null/undefined, the modal is action-only (no Edit/Save). */
  mode?: DetailModalMode;
  /** Called when the user clicks the in-header Edit (→ 'edit') or Cancel (→ 'view'). */
  onModeChange?: (mode: DetailModalMode) => void;
  /** Whether the entity can be edited. False hides the Edit button (e.g. closed deals). */
  canEdit?: boolean;
  /** Whether unsaved changes exist. Drives the "Unsaved" badge and Save-enabled state. */
  isDirty?: boolean;
  /** Save handler. Required when mode is enabled. */
  onSave?: () => void | Promise<void>;
  /** Optional cancel handler. Defaults to flipping back to view mode and discarding. */
  onCancel?: () => void;
  /** Pill shown when the entity is in a closed/terminal state — overrides the mode pill. */
  closedBadge?: ReactNode;
  /** Banner shown at the top of the body (e.g. "This deal is Won"). */
  banner?: ReactNode;
  /** Footer action buttons (left side). Caller controls what's there. */
  footerActions?: ReactNode;
  /** Footer hint text (right side). Defaults to a mode-aware message. */
  footerHint?: ReactNode;
  /** Body content — typically a stack of <DetailModalSection>s. */
  children: ReactNode;
  /** Close handler. */
  onClose: () => void;
  /** Renders the modal at reduced opacity to signal it's the
   *  background surface in a multi-modal layout (e.g. when the
   *  global search modal opens alongside on the right). The
   *  caller wires `onActivate` to bring this modal back into
   *  focus on click. */
  faded?: boolean;
  /** Click handler on the modal body — only used when `faded`
   *  is true, so a tap on the dimmed surface promotes it to
   *  the focused modal. */
  onActivate?: () => void;
  /** Slide the modal leftward (smoothly) to make room for a
   *  side-docked partner modal (the global search panel). When
   *  omitted, DetailModal auto-shifts whenever the global search
   *  is open — pass `false` to opt out, `true` to force-on. */
  shifted?: boolean;
}

/** Section wrapper for content inside the modal body. Use the heading slot
 *  for an uppercase label and the children for the section content. */
export function DetailModalSection({ heading, headingRight, children }: {
  heading: string;
  headingRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="detail-modal-section">
      <div className="detail-modal-section-heading">
        <span>{heading}</span>
        {headingRight && <span style={{ fontWeight: 400, color: 'var(--text-light)' }}>{headingRight}</span>}
      </div>
      {children}
    </div>
  );
}

export default function DetailModal({
  title,
  subtitle,
  accentColour = 'var(--info)',
  mode,
  onModeChange,
  canEdit = true,
  isDirty = false,
  onSave,
  onCancel,
  closedBadge,
  banner,
  footerActions,
  footerHint,
  children,
  onClose,
  faded = false,
  onActivate,
  shifted,
}: DetailModalProps) {
  // Default: any centered DetailModal shifts left when the
  // global search panel is open, so the two sit side-by-side
  // instead of overlapping. Callers can force-on or opt-out by
  // passing `shifted` explicitly.
  const modalStack = useModalStack();
  const shouldShift = shifted ?? !!modalStack?.searchOpen;

  // Register as a centered "primary" in the modal stack on mount
  // — keeps the search panel right-docked while this modal is on
  // screen, and triggers re-center when it closes. DetailModal is
  // never the search itself, so no skip flag needed.
  useEffect(() => {
    if (!modalStack) return;
    modalStack.pushPrimary();
    return () => modalStack.popPrimary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Stop the page underneath scrolling while the modal is open.
  // Centralised here so every DetailModal consumer gets it for free.
  useBodyScrollLock();

  // Flag this modal as dirty in the global registry whenever it has
  // unsaved edits, so the silent auto-update reloader defers a refresh.
  useDirty(mode === 'edit' && !!isDirty);

  // Escape key closes the modal (subject to dirty-check).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isDirty]);

  function requestClose() {
    if (mode === 'edit' && isDirty) {
      const ok = window.confirm('You have unsaved changes. Discard them?');
      if (!ok) return;
    }
    onClose();
  }

  function defaultCancel() {
    onModeChange?.('view');
  }

  const showEditButton = mode === 'view' && canEdit && onModeChange;
  const showSaveCancel = mode === 'edit' && onSave;

  // When the modal is faded (background surface in a multi-modal
  // layout) we suppress the overlay click-to-close — the user
  // can still hit X / Esc, but a stray click on the dim partner
  // (the global search modal sitting on the right) shouldn't
  // accidentally dismiss this one. The inline onClick promotes
  // this modal back to focused on activation.
  return (
    <div className="modal-overlay" onClick={faded ? undefined : requestClose}>
      <div
        className={`detail-modal ${faded ? 'detail-modal--faded' : ''} ${shouldShift ? 'detail-modal--shifted-left' : ''}`.replace(/\s+/g, ' ').trim()}
        onClick={(e) => {
          e.stopPropagation();
          if (faded && onActivate) onActivate();
        }}
      >
        <div className="detail-modal-accent" style={{ background: accentColour }} />
        <div className="detail-modal-header">
          <div className="detail-modal-header-text">
            <h2 className="detail-modal-title">
              {title}
              {closedBadge}
              {!closedBadge && mode === 'view' && (
                <span className="detail-modal-mode-badge detail-modal-mode-badge--view">
                  👁 Viewing
                </span>
              )}
              {!closedBadge && mode === 'edit' && !isDirty && (
                <span className="detail-modal-mode-badge detail-modal-mode-badge--editing">
                  ✏ Editing
                </span>
              )}
              {!closedBadge && mode === 'edit' && isDirty && (
                <span className="detail-modal-mode-badge detail-modal-mode-badge--unsaved">
                  ● Unsaved
                </span>
              )}
            </h2>
            {subtitle && <div className="detail-modal-sub">{subtitle}</div>}
          </div>
          <div className="detail-modal-header-actions">
            {showEditButton && (
              <button className="btn btn-primary" onClick={() => onModeChange!('edit')}>
                ✏ Edit
              </button>
            )}
            {showSaveCancel && (
              <>
                <button
                  className="btn btn-ghost"
                  onClick={() => (onCancel ?? defaultCancel)()}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => onSave!()}
                  disabled={!isDirty}
                >
                  Save
                </button>
              </>
            )}
            <button className="detail-modal-close" onClick={requestClose} aria-label="Close">×</button>
          </div>
        </div>

        <div className="detail-modal-body">
          {banner}
          {children}
        </div>

        {(footerActions || footerHint) && (
          <div className="detail-modal-footer">
            {footerActions}
            {footerHint && <div className="detail-modal-footer-hint">{footerHint}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
