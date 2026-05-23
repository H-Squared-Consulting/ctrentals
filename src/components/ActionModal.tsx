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

interface ActionModalProps {
  title: string;
  /** Optional sub-line below the title for context (ref code, recipient, etc.). */
  subtitle?: ReactNode;
  /** Max width of the dialog. Defaults to 520px (compact). Use 720px for forms with two columns. */
  width?: number | string;
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
  summary,
  children,
  secondaryActions,
  primaryAction,
  cancelLabel = 'Cancel',
  hideCancel = false,
  hideFooter = false,
  onClose,
}: ActionModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="action-modal"
        onClick={(e) => e.stopPropagation()}
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
