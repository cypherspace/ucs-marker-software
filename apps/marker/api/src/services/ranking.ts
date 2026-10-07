// Pure helpers for comparative marking: Bradley-Terry ranking and pair generation.

export interface Comparison {
  winner: string;
  loser: string;
  weight?: number;
}

// Fits a Bradley-Terry model with the minorisation-maximisation updates and
// returns a score (log strength, mean 0) per item. Each item also gets one
// half-win/half-loss against a virtual item of average strength, which keeps
// scores finite for items that have only won or only lost.
export function bradleyTerry(items: string[], comparisons: Comparison[], iterations = 500): Map<string, number> {
  if (items.length === 0) return new Map();
  const p = new Map(items.map((i) => [i, 1]));
  const wins = new Map(items.map((i) => [i, 0]));
  const against = new Map<string, { other: string; w: number }[]>(items.map((i) => [i, []]));

  for (const c of comparisons) {
    if (!p.has(c.winner) || !p.has(c.loser) || c.winner === c.loser) continue;
    const w = c.weight ?? 1;
    wins.set(c.winner, wins.get(c.winner)! + w);
    against.get(c.winner)!.push({ other: c.loser, w });
    against.get(c.loser)!.push({ other: c.winner, w });
  }

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, number>();
    for (const i of items) {
      const pi = p.get(i)!;
      let denom = 1 / (pi + 1);
      for (const { other, w } of against.get(i)!) denom += w / (pi + p.get(other)!);
      next.set(i, (wins.get(i)! + 0.5) / denom);
    }
    const meanLog = items.reduce((a, i) => a + Math.log(next.get(i)!), 0) / items.length;
    let maxChange = 0;
    for (const i of items) {
      const v = next.get(i)! / Math.exp(meanLog);
      maxChange = Math.max(maxChange, Math.abs(Math.log(v) - Math.log(p.get(i)!)));
      p.set(i, v);
    }
    if (maxChange < 1e-10) break;
  }
  return new Map(items.map((i) => [i, Math.log(p.get(i)!)]));
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// First round: a connected random pairing in which every item appears in about
// `perItem` new pairs. No self-pairs and nothing already in `existing`.
export function randomPairs(ids: string[], perItem: number, existing: Set<string>, rng: () => number): [string, string][] {
  const n = ids.length;
  if (n < 2) return [];
  const target = Math.max(1, Math.min(perItem, n - 1));
  const used = new Set(existing);
  const deg = new Map(ids.map((i) => [i, 0]));
  const out: [string, string][] = [];
  const add = (a: string, b: string): boolean => {
    const k = pairKey(a, b);
    if (a === b || used.has(k)) return false;
    used.add(k);
    deg.set(a, deg.get(a)! + 1);
    deg.set(b, deg.get(b)! + 1);
    out.push([a, b]);
    return true;
  };

  const order = shuffle(ids, rng);
  if (target >= 2 && n > 2) {
    for (let i = 0; i < n; i++) add(order[i], order[(i + 1) % n]);
  }
  for (let tries = 0; tries < n * target * 20; tries++) {
    const needy = ids.filter((i) => deg.get(i)! < target);
    if (needy.length === 0) break;
    const a = needy[Math.floor(rng() * needy.length)];
    let candidates = needy.filter((b) => b !== a && !used.has(pairKey(a, b)));
    if (candidates.length === 0) candidates = ids.filter((b) => b !== a && !used.has(pairKey(a, b)));
    if (candidates.length === 0) { deg.set(a, target); continue; }
    add(a, candidates[Math.floor(rng() * candidates.length)]);
  }
  return out;
}

// Later rounds: pair each item with the next few items in the current ranking,
// where extra comparisons tell us the most.
export function neighbourPairs(ranked: string[], window: number, existing: Set<string>): [string, string][] {
  const used = new Set(existing);
  const out: [string, string][] = [];
  for (let i = 0; i < ranked.length; i++) {
    for (let d = 1; d <= window && i + d < ranked.length; d++) {
      const k = pairKey(ranked[i], ranked[i + d]);
      if (used.has(k)) continue;
      used.add(k);
      out.push([ranked[i], ranked[i + d]]);
    }
  }
  return out;
}

// Randomise which script appears as A, so position can't leak the ranking.
export function orient(pairs: [string, string][], rng: () => number): [string, string][] {
  return pairs.map(([a, b]) => (rng() < 0.5 ? [a, b] : [b, a]));
}
