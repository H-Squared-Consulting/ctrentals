/* eslint-disable */
// @ts-nocheck
/**
 * Skeleton primitives — used to fill the page during initial data loads
 * instead of flashing a blank canvas or a centred spinner. One shimmer
 * animation, sized to match the real component it stands in for.
 */
export function SkeletonBlock({ width = '100%', height = '1rem', radius = '6px', style }: { width?: string; height?: string; radius?: string; style?: any }) {
  return <span className="skeleton" style={{ display: 'inline-block', width, height, borderRadius: radius, ...style }} />;
}

export function SkeletonPropertyCard() {
  return (
    <div className="property-card skeleton-card">
      <div className="property-card__image"><span className="skeleton skeleton-fill" /></div>
      <div className="property-card__body">
        <SkeletonBlock width="70%" height="1.1rem" />
        <div style={{ marginTop: 6 }}><SkeletonBlock width="50%" height="0.75rem" /></div>
        <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
          <SkeletonBlock width="48px" height="0.75rem" />
          <SkeletonBlock width="48px" height="0.75rem" />
          <SkeletonBlock width="56px" height="0.75rem" />
        </div>
      </div>
      <div className="property-card__footer">
        <SkeletonBlock width="56px" height="22px" radius="6px" />
        <SkeletonBlock width="64px" height="22px" radius="6px" />
        <SkeletonBlock width="64px" height="22px" radius="6px" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="property-grid">
      {Array.from({ length: count }).map((_, i) => <SkeletonPropertyCard key={i} />)}
    </div>
  );
}

export function SkeletonRows({ count = 8, cols = 5 }: { count?: number; cols?: number }) {
  return (
    <div className="skeleton-rows">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-row">
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonBlock key={c} width={`${100 / cols}%`} height="1rem" style={{ marginRight: 12 }} />
          ))}
        </div>
      ))}
    </div>
  );
}
