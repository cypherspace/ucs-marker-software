import { describe, expect, it } from 'vitest';
import { OverlaySchema } from './overlay.js';

const ok = (shapes: unknown[]) => OverlaySchema.safeParse({ width: 800, height: 600, shapes }).success;

describe('OverlaySchema', () => {
  it('accepts each kind of shape', () => {
    expect(ok([
      { type: 'pen', points: [1, 2, 3, 4, 5, 6], w: 3 },
      { type: 'line', points: [0, 0, 100, 100], w: 2 },
      { type: 'circle', x: 50, y: 50, r: 20, w: 2 },
      { type: 'rect', x: 10, y: 10, width: 80, height: 40, w: 2 },
      { type: 'text', x: 10, y: 10, text: 'x = 3', size: 24 },
    ])).toBe(true);
  });

  it('needs at least one shape', () => expect(ok([])).toBe(false));
  it('rejects a freehand stroke with an odd number of coordinates or too few', () => {
    expect(ok([{ type: 'pen', points: [1, 2, 3], w: 3 }])).toBe(false);
    expect(ok([{ type: 'pen', points: [1, 2], w: 3 }])).toBe(false);
  });
  it('rejects unknown shapes, NaN and absurd values', () => {
    expect(ok([{ type: 'star', x: 1, y: 1 }])).toBe(false);
    expect(ok([{ type: 'circle', x: Number.NaN, y: 1, r: 2, w: 1 }])).toBe(false);
    expect(ok([{ type: 'rect', x: 1, y: 1, width: 0, height: 5, w: 1 }])).toBe(false);
    expect(ok([{ type: 'circle', x: 1, y: 1, r: 2, w: 9999 }])).toBe(false);
    expect(ok([{ type: 'text', x: 1, y: 1, text: '   ', size: 12 }])).toBe(false);
  });
  it('rejects a bad reference size', () => {
    expect(OverlaySchema.safeParse({ width: 0, height: 600, shapes: [{ type: 'line', points: [0, 0, 1, 1], w: 1 }] }).success).toBe(false);
  });
  it('limits how many shapes can be stored', () => {
    expect(ok(Array.from({ length: 2001 }, () => ({ type: 'line', points: [0, 0, 1, 1], w: 1 })))).toBe(false);
  });
});
