import { randomBytes } from 'node:crypto';
import { spread } from './anchors.js';

// Pure helpers for practice marking (sampling clips into a set, and comparing student marks with teachers').

export const newLinkToken = (): string => randomBytes(24).toString('base64url');

export interface EligibleClip {
  clip_id: string;
  question_id: string;
  reference: number;      // the teachers' combined mark
  distinct_marks: number; // how many different marks teachers gave
  moderated: boolean;
}

// A clip is "settled" when teachers agree (or only one marked it) or a moderated mark exists
export const isSettled = (c: Pick<EligibleClip, 'distinct_marks' | 'moderated'>): boolean => c.moderated || c.distinct_marks <= 1;

// Up to `perQuestion` clips for each question, spread across the range of teacher marks so students see
// weak and strong answers, not just the middle. Deterministic for a given input.
export function sampleClips(clips: EligibleClip[], perQuestion: number, onlySettled: boolean): EligibleClip[] {
  const byQuestion = new Map<string, EligibleClip[]>();
  for (const c of clips) {
    if (onlySettled && !isSettled(c)) continue;
    byQuestion.set(c.question_id, [...(byQuestion.get(c.question_id) ?? []), c]);
  }
  const out: EligibleClip[] = [];
  for (const list of byQuestion.values()) {
    list.sort((a, b) => a.reference - b.reference || a.clip_id.localeCompare(b.clip_id));
    out.push(...spread(list, perQuestion));
  }
  return out;
}

// Fisher-Yates with an injectable random source (so tests can be exact)
export function shuffled<T>(items: T[], rng: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Pair { mine: number; teacher: number }

export interface AgreementStats {
  compared: number;
  exact_pct: number | null;
  within_one_pct: number | null;
  mean_abs_diff: number | null;
  // Positive: the student marks higher than the teachers on average
  mean_signed_diff: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function compareStats(pairs: Pair[]): AgreementStats {
  const n = pairs.length;
  if (n === 0) return { compared: 0, exact_pct: null, within_one_pct: null, mean_abs_diff: null, mean_signed_diff: null };
  const diffs = pairs.map((p) => p.mine - p.teacher);
  const pct = (k: number) => Math.round((k / n) * 100);
  return {
    compared: n,
    exact_pct: pct(diffs.filter((d) => d === 0).length),
    within_one_pct: pct(diffs.filter((d) => Math.abs(d) <= 1).length),
    mean_abs_diff: round2(diffs.reduce((a, d) => a + Math.abs(d), 0) / n),
    mean_signed_diff: round2(diffs.reduce((a, d) => a + d, 0) / n),
  };
}

// A sentence about which way a student tends to err, for their summary
export function biasNote(meanSigned: number | null): string | null {
  if (meanSigned === null) return null;
  if (Math.abs(meanSigned) < 0.25) return 'On average your marking is very close to your teachers\'.';
  const by = Math.abs(meanSigned).toFixed(1);
  return meanSigned > 0 ? `You tend to mark about ${by} marks higher than your teachers.` : `You tend to mark about ${by} marks lower than your teachers.`;
}

// How many students gave each mark 0..max
export function histogram(marks: number[], max: number): number[] {
  const h = Array.from({ length: Math.max(0, max) + 1 }, () => 0);
  for (const m of marks) if (m >= 0 && m <= max) h[m] += 1;
  return h;
}
