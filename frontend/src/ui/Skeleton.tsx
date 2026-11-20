/** Placeholder that reserves the final size of content loading for more than ~300 ms. */
export function Skeleton({ width = '100%', height = '1rem' }: { width?: string; height?: string }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden />;
}

/** Same footprint as a StatTile: label, value, footer. */
export function SkeletonTile() {
  return (
    <div className="skeleton-tile" aria-hidden>
      <Skeleton width="45%" height="0.875rem" />
      <Skeleton width="65%" height="2.25rem" />
      <Skeleton width="30%" height="0.875rem" />
    </div>
  );
}

/** Same footprint as an item card: badge row, title, two text lines, inset box. */
export function SkeletonCard() {
  return (
    <div className="card" aria-hidden>
      <Skeleton width="30%" height="1.25rem" />
      <Skeleton width="80%" height="1.5rem" />
      <Skeleton width="100%" height="0.875rem" />
      <Skeleton width="70%" height="0.875rem" />
      <Skeleton width="100%" height="4.5rem" />
    </div>
  );
}
