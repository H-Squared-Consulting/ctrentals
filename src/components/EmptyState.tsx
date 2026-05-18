/* eslint-disable */
// @ts-nocheck
/**
 * EmptyState — the friendly placeholder shown when a list/view has no
 * data. Per the design doc, every empty surface gets an icon, a short
 * title, an optional supporting line, and (where it makes sense) a
 * primary action that lets the user take the obvious next step.
 */
import { type ReactNode } from 'react';

export default function EmptyState({
  icon = '📭',
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">{icon}</div>
      <div className="empty-state-title">{title}</div>
      {description && <div className="empty-state-description">{description}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
