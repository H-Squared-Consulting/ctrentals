/* eslint-disable */
// @ts-nocheck
/**
 * ComingSoon — placeholder shown in sections of the nav whose
 * functionality hasn't been built yet. Keeps the platform feeling
 * intentional rather than half-finished by giving each empty surface
 * a clear "what this will be" promise.
 */
export default function ComingSoon({ title, description, icon = '🚧' }: { title: string; description?: string; icon?: string }) {
  return (
    <div className="coming-soon">
      <div className="coming-soon-icon" aria-hidden="true">{icon}</div>
      <div className="coming-soon-title">{title}</div>
      {description && <div className="coming-soon-description">{description}</div>}
      <span className="badge-soft" style={{ marginTop: 'var(--s-4)' }}>In production</span>
    </div>
  );
}
