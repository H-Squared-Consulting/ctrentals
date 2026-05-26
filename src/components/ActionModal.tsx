/**
 * ActionModal — the standard Tier B modal shell.
 *
 * Used by every one-shot action modal (send proposal, pick property,
 * import CSV, share brochure, etc). Lighter than DetailModal:
 *   - centred dialog (default 520px wide, configurable)
 *   - simple header: title + close X
 *   - body: caller content
 *   - footer: secondary actions left, one primary action right
 *
 * No mode toggle, no dirty check, no accent strip. These are
 * single-purpose dialogs; their primary action is unambiguous.
 */

import { useEffect, type ReactNode } from 'react';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { useModalStack } from '../contexts/ModalStackContext';

interface ActionModalProps {
  title: string;
  /** Optional sub-line below the title for context (ref code, recipient, etc.). */
  subtitle?: ReactNode;
  /** Max width of the dialog. Defaults to 520px (compact). Use 720px for forms with two columns. */
  width?: number | string;
  /** Where the dialog sits on the page. 'center' = the default
   *  full-page overlay. 'right' = side-docked panel with no
   *  backdrop, intended for coexisting with another centered
   *  primary modal (currently: deal modal + global search). The
   *  caller is responsible for handling click-outside-to-close
   *  on right-placed modals (no overlay click = no auto close;
   *  use the X button or Esc instead). */
  placement?: 'center' | 'right';
  /** Faded state — applied when this modal is currently NOT the
   *  focused one in a multi-modal layout. The caller wires its
   *  own onClick to focus itself; this prop just renders the
   *  visual cue. */
  faded?: boolean;
  /** Click handler on the modal body itself — used by the multi-
   *  modal layout to switch focus when the user clicks the faded
   *  one. */
  onActivate?: () => void;
  /** Slide leftward (smoothly) to make room for a side-docked
   *  partner modal. When omitted, ActionModal auto-shifts whenever
   *  the global search panel is open AND this modal isn't itself
   *  the right-placed one. Pass `false` to opt out. */
  shifted?: boolean;
  /** Opt out of registering as a centered "primary" in the
   *  modal stack. The global search modal passes this — it
   *  shouldn't count itself when deciding where to place itself. */
  skipStackRegister?: boolean;
  /** Optional summary panel rendered at the top of the body (recipient + ref, etc.). */
  summary?: ReactNode;
  /** Body content. */
  children: ReactNode;
  /** Secondary footer actions on the left (Back, Cancel). */
  secondaryActions?: ReactNode;
  /** Primary footer action on the right. Pass null to hide; a Cancel button still renders. */
  primaryAction?: ReactNode;
  /** Optional cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Hide the default Cancel button (e.g. for pure picker modals). */
  hideCancel?: boolean;
  /** Suppress the footer entirely (use when the body content owns its actions, like PricingModal). */
  hideFooter?: boolean;
  onClose: () => void;
}

export default function ActionModal({
  title,
  subtitle,
  width = 520,
  placement = 'center',
  faded = false,
  onActivate,
  shifted,
  skipStackRegister = false,
  summary,
  children,
  secondaryActions,
  primaryAction,
  cancelLabel = 'Cancel',
  hideCancel = false,
  hideFooter = false,
  onClose,
}: ActionModalProps) {
  // Stop the page underneath scrolling while the modal is open.
  // Centralised here so every ActionModal consumer gets it for free.
  useBodyScrollLock();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Auto-register as a centered "primary" in the modal stack on
  // mount so the global search panel can dock right alongside us
  // (and re-center when we close). Right-placed ActionModals (the
  // search modal itself) skip; the search modal also passes the
  // explicit opt-out via skipStackRegister to avoid counting
  // itself when it's at center placement (alone on screen).
  const modalStack = useModalStack();
  const registerInStack = !skipStackRegister && placement !== 'right';
  useEffect(() => {
    if (!modalStack || !registerInStack) return;
    modalStack.pushPrimary();
    return () => modalStack.popPrimary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerInStack]);

  // ONE overlay container for all placements so the modal element
  // stays in the same DOM node when the placement prop flips —
  // that's the only way the CSS transition has continuity to
  // animate against (a fresh mount would just snap into place).
  // The overlay's data-placement attribute drives the layout:
  // centered (default) keeps the original full-page dim, right-
  // docked drops the dim + aligns the modal to the right edge so
  // it can coexist with another centered modal underneath.
  const isRight = placement === 'right';
  // Default: centered ActionModals auto-shift left when the
  // global search panel is open. Right-placed ones (the search
  // modal itself) never shift — they're the side that's docking.
  const shouldShift = isRight ? false : (shifted ?? !!modalStack?.searchOpen);
  const modalClass = `action-modal ${isRight ? 'action-modal--side' : ''} ${faded ? 'action-modal--faded' : ''} ${shouldShift ? 'action-modal--shifted-left' : ''}`.replace(/\s+/g, ' ').trim();
  // Click on the overlay backdrop only closes when we're the
  // centered modal — a right-docked partner shouldn't accidentally
  // close on a click that escapes the bounds.
  const overlayClick = isRight ? undefined : onClose;
  const onModalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (faded && onActivate) onActivate();
  };

  return (
    <div
      className="modal-overlay"
      data-placement={placement}
      onClick={overlayClick}
    >
      <div
        className={modalClass}
        onClick={onModalClick}
        style={{ maxWidth: typeof width === 'number' ? `${width}px` : width }}
      >
        <div className="action-modal-header">
          <div className="action-modal-header-text">
            <h2 className="action-modal-title">{title}</h2>
            {subtitle && <div className="action-modal-sub">{subtitle}</div>}
          </div>
          <button className="detail-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="action-modal-body">
          {summary && <div className="action-modal-summary">{summary}</div>}
          {children}
        </div>
        {!hideFooter && (
          <div className="action-modal-footer">
            {secondaryActions}
            <div style={{ flex: 1 }} />
            {!hideCancel && (
              <button className="btn btn-ghost" onClick={onClose}>{cancelLabel}</button>
            )}
            {primaryAction}
          </div>
        )}
      </div>
    </div>
  );
}
