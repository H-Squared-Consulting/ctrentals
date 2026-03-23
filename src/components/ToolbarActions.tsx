/**
 * ToolbarActions -- Renders action buttons in the DataTable header.
 * Matches Sentinel's ToolbarActions interface: primary, secondary, onSync, overflow.
 */
import { useState } from 'react';

interface PrimaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface OverflowAction {
  label: string;
  icon?: string;
  onClick: () => void;
}

interface ToolbarActionsProps {
  primary?: PrimaryAction;
  secondary?: PrimaryAction;
  onSync?: (() => void) | { label: string; onClick: () => void } | Array<{ label: string; onClick: () => void }>;
  overflow?: OverflowAction[];
}

export default function ToolbarActions({ primary, secondary, onSync, overflow }: ToolbarActionsProps) {
  const [showOverflow, setShowOverflow] = useState(false);

  // Normalise onSync to array of { label, onClick }
  const syncButtons = Array.isArray(onSync)
    ? onSync
    : onSync && typeof onSync === 'object' && 'label' in onSync
    ? [onSync]
    : null;

  return (
    <div className="toolbar-actions-group">
      {/* Sync / refresh buttons */}
      {syncButtons
        ? syncButtons.map((s, i) => (
            <button key={i} className="btn btn-ghost" onClick={s.onClick}>
              {s.label}
            </button>
          ))
        : typeof onSync === 'function' && (
            <button className="btn btn-ghost" onClick={onSync}>↻</button>
          )}

      {/* Secondary action */}
      {secondary && (
        <button className="btn btn-secondary" onClick={secondary.onClick} disabled={secondary.disabled}>
          {secondary.label}
        </button>
      )}

      {/* Overflow menu (⋮) */}
      {overflow && overflow.length > 0 && (
        <div className="overflow-menu-wrapper">
          <button className="btn btn-ghost" onClick={() => setShowOverflow(!showOverflow)} style={{ fontSize: '1rem', padding: '4px 8px' }}>
            ⋮
          </button>
          {showOverflow && (
            <>
              <div className="overflow-backdrop" onClick={() => setShowOverflow(false)} />
              <div className="overflow-menu">
                {overflow.map((item, i) => (
                  <button
                    key={i}
                    className="overflow-menu-item"
                    onClick={() => { setShowOverflow(false); item.onClick(); }}
                  >
                    {item.icon && <span>{item.icon}</span>}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Primary action */}
      {primary && (
        <button className="btn btn-primary" onClick={primary.onClick} disabled={primary.disabled}>
          {primary.label}
        </button>
      )}
    </div>
  );
}
