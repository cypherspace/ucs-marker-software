import { db } from '../db.js';
import { getClipBytes } from './clipImages.js';

// Reference points shown to the AI so it calibrates against what teachers have
// already decided on the same question.

export interface MarkAnchor { image: Buffer; marks: number; max: number }
export interface JudgementAnchor { imageA: Buffer; imageB: Buffer; winner: 'A' | 'B' }

// Evenly spread picks across a sorted list, always including both ends.
export function spread<T>(sorted: T[], limit: number): T[] {
  if (sorted.length <= limit) return sorted;
  if (limit <= 1) return sorted.slice(0, 1);
  const picked = new Set<number>();
  for (let i = 0; i < limit; i++) picked.add(Math.round((i * (sorted.length - 1)) / (limit - 1)));
  return [...picked].sort((a, b) => a - b).map((i) => sorted[i]);
}

export async function markingAnchors(
  questionId: string, excludeClipId: string, leadTeacherId: string, maxMarks: number, limit = 4,
): Promise<MarkAnchor[]> {
  const rows = (await db.raw(
    `SELECT DISTINCT ON (sm.clip_id) sc.clip_image_url, sm.marks_awarded
       FROM script_marks sm JOIN script_clips sc ON sc.id = sm.clip_id
      WHERE sc.question_id = ? AND sc.id <> ? AND sm.mark_source = 'human'
        AND sm.status <> 'pending' AND sm.marks_awarded IS NOT NULL
      ORDER BY sm.clip_id, sm.marked_at DESC NULLS LAST`,
    [questionId, excludeClipId],
  )).rows as { clip_image_url: string; marks_awarded: number }[];
  rows.sort((a, b) => a.marks_awarded - b.marks_awarded);
  const chosen = spread(rows, limit);
  const out: MarkAnchor[] = [];
  for (const r of chosen) {
    try {
      out.push({ image: await getClipBytes(r.clip_image_url, leadTeacherId), marks: r.marks_awarded, max: maxMarks });
    } catch { /* an unreadable example is simply skipped */ }
  }
  return out;
}

export async function humanMarkFor(clipId: string): Promise<number | null> {
  const row = await db('script_marks')
    .where({ clip_id: clipId, mark_source: 'human' })
    .whereNot({ status: 'pending' })
    .whereNotNull('marks_awarded')
    .orderByRaw('marked_at DESC NULLS LAST')
    .first<{ marks_awarded: number }>('marks_awarded');
  return row?.marks_awarded ?? null;
}

export async function judgementAnchors(
  questionId: string, excludePairId: string, leadTeacherId: string, limit = 3,
): Promise<JudgementAnchor[]> {
  const rows = (await db.raw(
    `SELECT j.winner_clip_id, p.clip_a_id, a.clip_image_url AS a_url, b.clip_image_url AS b_url
       FROM comparative_judgements j
       JOIN comparative_pairs p ON p.id = j.pair_id
       JOIN script_clips a ON a.id = p.clip_a_id
       JOIN script_clips b ON b.id = p.clip_b_id
      WHERE p.question_id = ? AND j.source = 'human' AND p.id <> ?
      ORDER BY j.created_at DESC LIMIT ?`,
    [questionId, excludePairId, limit],
  )).rows as { winner_clip_id: string; clip_a_id: string; a_url: string; b_url: string }[];
  const out: JudgementAnchor[] = [];
  for (const r of rows) {
    try {
      out.push({
        imageA: await getClipBytes(r.a_url, leadTeacherId),
        imageB: await getClipBytes(r.b_url, leadTeacherId),
        winner: r.winner_clip_id === r.clip_a_id ? 'A' : 'B',
      });
    } catch { /* skip */ }
  }
  return out;
}
