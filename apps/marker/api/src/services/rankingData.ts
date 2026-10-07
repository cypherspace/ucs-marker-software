import { db } from '../db.js';
import { bradleyTerry, type Comparison } from './ranking.js';
import type { RankedClip, Ranking } from '@marker/shared-types';

// Rank every clip of a question from all judgements so far. Where a pair has
// both a human and an AI judgement, the human one decides.
export async function computeRanking(questionId: string): Promise<Ranking> {
  const clips = await db('script_clips as sc')
    .join('student_scripts as ss', 'ss.id', 'sc.script_id')
    .where('sc.question_id', questionId)
    .select<{ id: string; student_number: string }[]>('sc.id', 'ss.student_number');

  const pairs = (await db.raw(
    `SELECT p.id, p.clip_a_id, p.clip_b_id,
            h.winner_clip_id AS human_winner, a.winner_clip_id AS ai_winner
       FROM comparative_pairs p
       LEFT JOIN comparative_judgements h ON h.pair_id = p.id AND h.source = 'human'
       LEFT JOIN comparative_judgements a ON a.pair_id = p.id AND a.source = 'ai'
      WHERE p.question_id = ?`,
    [questionId],
  )).rows as { id: string; clip_a_id: string; clip_b_id: string; human_winner: string | null; ai_winner: string | null }[];

  const comparisons: Comparison[] = [];
  const stats = new Map(clips.map((c) => [c.id, { judgements: 0, human: 0, ai: 0 }]));
  for (const p of pairs) {
    const winner = p.human_winner ?? p.ai_winner;
    if (!winner) continue;
    const loser = winner === p.clip_a_id ? p.clip_b_id : p.clip_a_id;
    comparisons.push({ winner, loser });
    for (const id of [p.clip_a_id, p.clip_b_id]) {
      const s = stats.get(id);
      if (!s) continue;
      s.judgements++;
      if (p.human_winner) s.human++; else s.ai++;
    }
  }

  const scores = bradleyTerry(clips.map((c) => c.id), comparisons);
  const sorted = [...clips].sort((a, b) =>
    (scores.get(b.id)! - scores.get(a.id)!) || a.student_number.localeCompare(b.student_number));
  const ranked: RankedClip[] = [];
  sorted.forEach((c, i) => {
    const score = Math.round(scores.get(c.id)! * 1000) / 1000;
    const prev = ranked[i - 1];
    ranked.push({
      // Equal scores share a rank.
      rank: prev && prev.score === score ? prev.rank : i + 1,
      clip_id: c.id,
      student_number: c.student_number,
      score,
      ...stats.get(c.id)!,
    });
  });
  return {
    ranked,
    judged_pairs: comparisons.length,
    total_pairs: pairs.length,
  };
}
