import { describe, expect, it } from 'vitest';
import { bradleyTerry, mulberry32, neighbourPairs, orient, pairKey, randomPairs } from './ranking.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

describe('bradleyTerry', () => {
  it('recovers a known order from consistent results', () => {
    const items = ['A', 'B', 'C', 'D'];
    const comps = [
      { winner: 'A', loser: 'B' }, { winner: 'A', loser: 'C' }, { winner: 'A', loser: 'D' },
      { winner: 'B', loser: 'C' }, { winner: 'B', loser: 'D' }, { winner: 'C', loser: 'D' },
    ];
    const scores = bradleyTerry(items, comps);
    const order = [...items].sort((x, y) => scores.get(y)! - scores.get(x)!);
    expect(order).toEqual(['A', 'B', 'C', 'D']);
    for (const s of scores.values()) expect(Number.isFinite(s)).toBe(true);
  });

  it('keeps scores finite for items that only win or only lose and centres them on 0', () => {
    const scores = bradleyTerry(['A', 'B'], [{ winner: 'A', loser: 'B' }, { winner: 'A', loser: 'B' }]);
    expect(Number.isFinite(scores.get('A')!)).toBe(true);
    expect(scores.get('A')!).toBeGreaterThan(scores.get('B')!);
    expect(scores.get('A')! + scores.get('B')!).toBeCloseTo(0, 6);
  });

  it('copes with a noisy upset and still puts the stronger item first', () => {
    const comps = [
      ...Array.from({ length: 9 }, () => ({ winner: 'A', loser: 'B' })),
      { winner: 'B', loser: 'A' },
    ];
    const scores = bradleyTerry(['A', 'B'], comps);
    expect(scores.get('A')!).toBeGreaterThan(scores.get('B')!);
  });

  it('weights count: a heavy result outweighs a light contradicting one', () => {
    const scores = bradleyTerry(['A', 'B'], [
      { winner: 'A', loser: 'B', weight: 3 },
      { winner: 'B', loser: 'A', weight: 1 },
    ]);
    expect(scores.get('A')!).toBeGreaterThan(scores.get('B')!);
  });

  it('ignores unknown items and self comparisons, and handles no data', () => {
    expect(bradleyTerry([], []).size).toBe(0);
    const scores = bradleyTerry(['A', 'B'], [{ winner: 'A', loser: 'A' }, { winner: 'Z', loser: 'B' }]);
    expect(scores.get('A')).toBeCloseTo(scores.get('B')!, 6);
  });
});

describe('randomPairs', () => {
  it('has no self pairs or duplicates, reaches every item and connects them', () => {
    const items = ids(40);
    const pairs = randomPairs(items, 6, new Set(), mulberry32(7));
    const keys = new Set(pairs.map(([a, b]) => pairKey(a, b)));
    expect(keys.size).toBe(pairs.length);
    expect(pairs.every(([a, b]) => a !== b)).toBe(true);
    const deg = new Map<string, number>();
    for (const [a, b] of pairs) { deg.set(a, (deg.get(a) ?? 0) + 1); deg.set(b, (deg.get(b) ?? 0) + 1); }
    for (const i of items) expect(deg.get(i) ?? 0).toBeGreaterThanOrEqual(6);
    // connected: flood fill from c0
    const adj = new Map<string, string[]>(items.map((i) => [i, []]));
    for (const [a, b] of pairs) { adj.get(a)!.push(b); adj.get(b)!.push(a); }
    const seen = new Set(['c0']);
    const stack = ['c0'];
    while (stack.length) for (const nb of adj.get(stack.pop()!)!) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
    expect(seen.size).toBe(items.length);
  });

  it('skips pairs that already exist and is capped when there are few items', () => {
    const items = ids(4);
    const existing = new Set([pairKey('c0', 'c1')]);
    const pairs = randomPairs(items, 10, existing, mulberry32(1));
    expect(pairs.some(([a, b]) => pairKey(a, b) === pairKey('c0', 'c1'))).toBe(false);
    expect(pairs.length).toBe(5); // 6 possible pairs minus the existing one
  });

  it('returns nothing for fewer than two items and is deterministic for a seed', () => {
    expect(randomPairs(['only'], 6, new Set(), mulberry32(1))).toEqual([]);
    const a = randomPairs(ids(10), 4, new Set(), mulberry32(42));
    const b = randomPairs(ids(10), 4, new Set(), mulberry32(42));
    expect(a).toEqual(b);
  });
});

describe('neighbourPairs and orient', () => {
  it('pairs neighbours within the window, skipping existing pairs', () => {
    const ranked = ['a', 'b', 'c', 'd'];
    const pairs = neighbourPairs(ranked, 2, new Set([pairKey('a', 'b')]));
    expect(pairs.map(([x, y]) => pairKey(x, y)).sort()).toEqual(
      [pairKey('a', 'c'), pairKey('b', 'c'), pairKey('b', 'd'), pairKey('c', 'd')].sort(),
    );
  });

  it('orient keeps the same pairs but mixes the order', () => {
    const pairs: [string, string][] = Array.from({ length: 200 }, (_, i) => [`a${i}`, `b${i}`]);
    const out = orient(pairs, mulberry32(3));
    expect(out.every(([x, y], i) => pairKey(x, y) === pairKey(...pairs[i]))).toBe(true);
    const flipped = out.filter(([x], i) => x !== pairs[i][0]).length;
    expect(flipped).toBeGreaterThan(60);
    expect(flipped).toBeLessThan(140);
  });
});
