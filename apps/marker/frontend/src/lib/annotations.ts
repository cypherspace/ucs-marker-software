import type { Annotation, AnnotationData } from '@marker/shared-types';

// Annotations that mark a single spot. They are placed, and removed, with a double-click.
const POINT_TYPES: ReadonlySet<string> = new Set(['mark_tick', 'tick', 'cross', 'numbered_tick', 'numbered_cross']);

export const isPointType = (type: string): boolean => POINT_TYPES.has(type);

// How close (in image pixels) a double-click must be to a point annotation to remove it
export const HIT_RADIUS = 18;

/** How many marks a set of annotations is worth: one per Mark tick, on every layer. */
export function markTickTotal(data: AnnotationData | null | undefined): number {
  return (data?.annotations ?? []).filter((a) => a.type === 'mark_tick').length;
}

/** The point annotation nearest to (x, y) within `radius`, or null. The newest wins a tie. */
export function findPointAt(annotations: readonly Annotation[], x: number, y: number, radius = HIT_RADIUS): Annotation | null {
  let best: Annotation | null = null;
  let bestDist = Infinity;
  for (const a of annotations) {
    if (!isPointType(a.type)) continue;
    const d = Math.hypot(a.x - x, a.y - y);
    if (d <= radius && d <= bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best;
}

/** The next number for a numbered tick or cross: one more than the highest used. */
export function nextNumber(annotations: readonly Annotation[]): number {
  return 1 + Math.max(0, ...annotations.map((a) => a.number ?? 0));
}
