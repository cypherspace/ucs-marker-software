import { beforeEach, describe, expect, it } from 'vitest';
import {
  clampOpacity, clampScale, DEFAULT_VIEW, isMoved, isOverlayView, loadView, normaliseRotation, nudge, resetPosition,
  rotateBy, saveView, scaleBy, storageKey,
} from './overlay';

// A tiny stand-in for the browser's localStorage
function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
beforeEach(() => { (globalThis as unknown as { window: unknown }).window = { localStorage: fakeStorage() }; });

describe('rotation and scale', () => {
  it('keeps a rotation between -180 and 180', () => {
    expect(normaliseRotation(190)).toBe(-170);
    expect(normaliseRotation(-190)).toBe(170);
    expect(normaliseRotation(360)).toBe(0);
    expect(rotateBy(DEFAULT_VIEW, 5).rotation).toBe(5);
    expect(rotateBy({ ...DEFAULT_VIEW, rotation: 178 }, 5).rotation).toBe(-177);
  });
  it('limits the size and opacity', () => {
    expect(clampScale(100)).toBe(5);
    expect(clampScale(0.001)).toBe(0.1);
    expect(scaleBy(DEFAULT_VIEW, 1.1).scale).toBe(1.1);
    expect(clampOpacity(0)).toBe(0.05);
    expect(clampOpacity(2)).toBe(1);
  });
});

describe('moving and resetting', () => {
  it('nudges the position', () => {
    const v = nudge(nudge(DEFAULT_VIEW, 3, -2), 1, 1);
    expect([v.tx, v.ty]).toEqual([4, -1]);
  });
  it('reset puts the position back but keeps the look', () => {
    const moved = { ...DEFAULT_VIEW, tx: 40, ty: 9, rotation: 12, scale: 1.4, flip: true, opacity: 0.3, color: '#2563eb', show: false };
    expect(isMoved(moved)).toBe(true);
    const r = resetPosition(moved);
    expect(isMoved(r)).toBe(false);
    expect([r.opacity, r.color, r.show]).toEqual([0.3, '#2563eb', false]);
  });
});

describe('remembering the view per question', () => {
  it('starts from the defaults', () => expect(loadView('q1')).toEqual(DEFAULT_VIEW));

  it('gives the same position back for the same question, and not for another', () => {
    const v = { ...DEFAULT_VIEW, tx: 25, ty: -8, rotation: 3.5, scale: 1.2 };
    saveView('q1', v);
    expect(loadView('q1')).toEqual(v);
    expect(loadView('q2')).toEqual(DEFAULT_VIEW);
  });

  it('ignores stored values that are not a valid view', () => {
    window.localStorage.setItem(storageKey('q1'), '{"tx":"far"}');
    expect(loadView('q1')).toEqual(DEFAULT_VIEW);
    window.localStorage.setItem(storageKey('q1'), 'not json');
    expect(loadView('q1')).toEqual(DEFAULT_VIEW);
    expect(isOverlayView(null)).toBe(false);
  });
});
