// How a tracing-paper overlay is shown on one question: where it has been moved to, how it is turned and sized, and how it
// looks. This is remembered in the browser per question, so once it is lined up it stays lined up from script to script.

export interface OverlayView {
  show: boolean;
  // Offset of the overlay's centre from where it was drawn, in clip-image pixels
  tx: number;
  ty: number;
  // Degrees, turning about the overlay's centre (clockwise is positive)
  rotation: number;
  scale: number;
  // Mirrored left to right
  flip: boolean;
  opacity: number;
  color: string;
  // Locked in place: it can no longer be dragged by accident (it starts unlocked, so it can be moved straight away)
  locked: boolean;
}

export const DEFAULT_VIEW: OverlayView = { show: true, tx: 0, ty: 0, rotation: 0, scale: 1, flip: false, opacity: 0.6, color: '#e11d48', locked: false };
export const OVERLAY_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#000000'];

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isOverlayView(v: unknown): v is OverlayView {
  const o = v as Partial<OverlayView> | null;
  return Boolean(o) && typeof o === 'object'
    && typeof o!.show === 'boolean' && isNum(o!.tx) && isNum(o!.ty) && isNum(o!.rotation) && isNum(o!.scale)
    && typeof o!.flip === 'boolean' && isNum(o!.opacity) && typeof o!.color === 'string';
}

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 1000) / 1000));
export const clampOpacity = (o: number): number => Math.min(1, Math.max(0.05, Math.round(o * 100) / 100));

// Keep a rotation within -180 to 180 degrees
export function normaliseRotation(deg: number): number {
  const r = ((((deg + 180) % 360) + 360) % 360) - 180;
  return Math.round(r * 100) / 100;
}

export const rotateBy = (view: OverlayView, deg: number): OverlayView => ({ ...view, rotation: normaliseRotation(view.rotation + deg) });
export const scaleBy = (view: OverlayView, factor: number): OverlayView => ({ ...view, scale: clampScale(view.scale * factor) });
export const nudge = (view: OverlayView, dx: number, dy: number): OverlayView => ({ ...view, tx: view.tx + dx, ty: view.ty + dy });

/** Back to where it was drawn, un-turned, at full size and not mirrored (the look and visibility are kept). */
export const resetPosition = (view: OverlayView): OverlayView => ({ ...view, tx: 0, ty: 0, rotation: 0, scale: 1, flip: false });

export const isMoved = (view: OverlayView): boolean =>
  view.tx !== 0 || view.ty !== 0 || view.rotation !== 0 || view.scale !== 1 || view.flip;

export const storageKey = (questionId: string): string => `marker.overlay.${questionId}`;

export function loadView(questionId: string): OverlayView {
  try {
    const raw = window.localStorage.getItem(storageKey(questionId));
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (isOverlayView(parsed)) return { ...DEFAULT_VIEW, ...parsed, scale: clampScale(parsed.scale), opacity: clampOpacity(parsed.opacity) };
    }
  } catch { /* storage unavailable or unreadable: use the defaults */ }
  return DEFAULT_VIEW;
}

export function saveView(questionId: string, view: OverlayView): void {
  try { window.localStorage.setItem(storageKey(questionId), JSON.stringify(view)); } catch { /* storage unavailable */ }
}
