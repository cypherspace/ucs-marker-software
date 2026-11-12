import { describe, expect, it } from 'vitest';
import type { Annotation } from '@marker/shared-types';
import { findPointAt, isPointType, markTickTotal, nextNumber } from './annotations';

const a = (over: Partial<Annotation>): Annotation => ({ id: 'x', type: 'tick', x: 0, y: 0, color: '#000', ...over });

describe('markTickTotal', () => {
  it('counts only mark ticks', () => {
    expect(markTickTotal({ annotations: [a({ type: 'mark_tick' }), a({ type: 'tick' }), a({ type: 'mark_tick' })] })).toBe(2);
  });
  it('is zero for nothing', () => {
    expect(markTickTotal(null)).toBe(0);
    expect(markTickTotal({ annotations: [] })).toBe(0);
  });
});

describe('isPointType', () => {
  it('is true for ticks and crosses, false for drawn shapes', () => {
    for (const t of ['mark_tick', 'tick', 'cross', 'numbered_tick', 'numbered_cross']) expect(isPointType(t)).toBe(true);
    for (const t of ['circle', 'underline', 'ruler', 'text']) expect(isPointType(t)).toBe(false);
  });
});

describe('findPointAt', () => {
  const anns = [
    a({ id: 'far', type: 'tick', x: 200, y: 200 }),
    a({ id: 'near', type: 'cross', x: 105, y: 100 }),
    a({ id: 'circle', type: 'circle', x: 100, y: 100, radius: 30 }),
  ];
  it('finds the point annotation within the radius', () => {
    expect(findPointAt(anns, 100, 100)?.id).toBe('near');
  });
  it('ignores shapes that are not points', () => {
    expect(findPointAt([anns[2]], 100, 100)).toBeNull();
  });
  it('returns null when nothing is close enough', () => {
    expect(findPointAt(anns, 150, 150)).toBeNull();
  });
  it('prefers the closer of two, and the newer on a tie', () => {
    const two = [a({ id: 'a', x: 90, y: 100 }), a({ id: 'b', x: 112, y: 100 })];
    expect(findPointAt(two, 100, 100)?.id).toBe('a');
    const tie = [a({ id: 'old', x: 90, y: 100 }), a({ id: 'new', x: 110, y: 100 })];
    expect(findPointAt(tie, 100, 100)?.id).toBe('new');
  });
});

describe('nextNumber', () => {
  it('starts at 1 and continues after the highest', () => {
    expect(nextNumber([])).toBe(1);
    expect(nextNumber([a({ number: 3 }), a({ number: 1 })])).toBe(4);
  });
});

import { annotationMark } from './annotations';
const at = (type: Annotation['type']): Annotation => ({ id: type + Math.random(), type, x: 1, y: 1 } as Annotation);

describe('annotationMark', () => {
  it('is null until something worth a mark is placed', () => {
    expect(annotationMark({ annotations: [] })).toBeNull();
    expect(annotationMark({ annotations: [at('tick'), at('circle')] })).toBeNull();
    expect(annotationMark(null)).toBeNull();
  });
  it('counts one mark per mark tick', () => {
    expect(annotationMark({ annotations: [at('mark_tick'), at('mark_tick'), at('tick')] })).toBe(2);
  });
  it('treats a cross on its own as zero marks, plain or numbered', () => {
    expect(annotationMark({ annotations: [at('cross')] })).toBe(0);
    expect(annotationMark({ annotations: [at('numbered_cross')] })).toBe(0);
  });
  it('lets mark ticks win over a cross', () => {
    expect(annotationMark({ annotations: [at('cross'), at('mark_tick')] })).toBe(1);
  });
});
