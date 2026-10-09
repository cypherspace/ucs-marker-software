// Pure geometry for the dockable panels, kept apart from React so it can be tested.

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type Edge = 'left' | 'right' | 'top' | 'bottom';

/** Distance (px) from a screen edge within which releasing a dragged panel docks it there. */
export const SNAP_DISTANCE = 56;

/**
 * Which edge of `bounds` the point is within `threshold` of, or null. The nearest edge wins;
 * ties go to left, right, top, bottom in that order.
 */
export function nearestEdge(p: Point, bounds: Rect, threshold = SNAP_DISTANCE): Edge | null {
  const dist: [Edge, number][] = [
    ['left', p.x - bounds.x],
    ['right', bounds.x + bounds.w - p.x],
    ['top', p.y - bounds.y],
    ['bottom', bounds.y + bounds.h - p.y],
  ];
  let best: Edge | null = null;
  let bestDist = Infinity;
  for (const [edge, d] of dist) {
    if (d <= threshold && d < bestDist) {
      best = edge;
      bestDist = d;
    }
  }
  return best;
}

/** Keep a rectangle inside `bounds`, shrinking it to the minimum size at the smallest. */
export function clampRect(r: Rect, bounds: Rect, min = { w: 200, h: 140 }): Rect {
  const w = Math.min(Math.max(r.w, min.w), Math.max(bounds.w, min.w));
  const h = Math.min(Math.max(r.h, min.h), Math.max(bounds.h, min.h));
  const x = Math.min(Math.max(r.x, bounds.x), bounds.x + bounds.w - w);
  const y = Math.min(Math.max(r.y, bounds.y), bounds.y + bounds.h - h);
  return { x, y, w, h };
}

/** Keep a docked panel's thickness between `min` and a fraction of the space available. */
export function clampSize(size: number, total: number, min = 200, maxFraction = 0.7): number {
  const max = Math.max(min, total * maxFraction);
  return Math.min(Math.max(size, min), max);
}
