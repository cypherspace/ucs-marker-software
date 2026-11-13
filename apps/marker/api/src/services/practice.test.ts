import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({ db: {} }));
vi.mock('./clipImages.js', () => ({ getClipBytes: vi.fn() }));
import { biasNote, compareStats, histogram, isSettled, newLinkToken, sampleClips, shuffled, type EligibleClip } from './practice.js';

const clip = (id: string, q: string, reference: number, distinct_marks = 1, moderated = false): EligibleClip => ({
  clip_id: id, question_id: q, reference, distinct_marks, moderated,
});

describe('sampleClips', () => {
  const clips = Array.from({ length: 20 }, (_, i) => clip(`c${String(i).padStart(2, '0')}`, 'q1', i % 5));
  it('spreads the picks across the range of marks', () => {
    const picked = sampleClips(clips, 5, true).map((c) => c.reference);
    expect(Math.min(...picked)).toBe(0);
    expect(Math.max(...picked)).toBe(4);
    expect(picked).toHaveLength(5);
  });
  it('samples each question on its own', () => {
    const two = [...clips, ...clips.map((c) => ({ ...c, clip_id: `x${c.clip_id}`, question_id: 'q2' }))];
    const picked = sampleClips(two, 3, true);
    expect(picked.filter((c) => c.question_id === 'q1')).toHaveLength(3);
    expect(picked.filter((c) => c.question_id === 'q2')).toHaveLength(3);
  });
  it('leaves out clips teachers disagree on, unless asked to keep them', () => {
    const mixed = [clip('a', 'q', 1), clip('b', 'q', 2, 2), clip('c', 'q', 3, 2, true)];
    expect(sampleClips(mixed, 10, true).map((c) => c.clip_id)).toEqual(['a', 'c']);
    expect(sampleClips(mixed, 10, false)).toHaveLength(3);
    expect(isSettled(clip('d', 'q', 1, 3, false))).toBe(false);
  });
  it('returns everything when there are fewer clips than the limit', () => {
    expect(sampleClips(clips.slice(0, 4), 10, true)).toHaveLength(4);
  });
});

describe('shuffled', () => {
  it('keeps every item and is repeatable for a fixed random source', () => {
    const seq = [0.9, 0.1, 0.5, 0.3];
    const make = () => { let i = 0; return () => seq[i++ % seq.length]; };
    const a = shuffled([1, 2, 3, 4, 5], make());
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(shuffled([1, 2, 3, 4, 5], make())).toEqual(a);
  });
});

describe('compareStats', () => {
  it('measures agreement and which way a student errs', () => {
    const s = compareStats([{ mine: 2, teacher: 2 }, { mine: 3, teacher: 2 }, { mine: 4, teacher: 2 }, { mine: 1, teacher: 2 }]);
    expect(s).toEqual({ compared: 4, exact_pct: 25, within_one_pct: 75, mean_abs_diff: 1, mean_signed_diff: 0.5 });
  });
  it('is empty for no marks', () => {
    expect(compareStats([]).exact_pct).toBeNull();
  });
  it('describes bias in words', () => {
    expect(biasNote(0.1)).toContain('very close');
    expect(biasNote(0.6)).toContain('higher');
    expect(biasNote(-1.2)).toContain('lower');
    expect(biasNote(null)).toBeNull();
  });
});

describe('histogram and tokens', () => {
  it('counts marks', () => expect(histogram([0, 1, 1, 3, 9], 3)).toEqual([1, 2, 0, 1]));
  it('makes unguessable, url-safe tokens', () => {
    const t = newLinkToken();
    expect(t).toMatch(/^[\w-]{32}$/);
    expect(newLinkToken()).not.toBe(t);
  });
});
