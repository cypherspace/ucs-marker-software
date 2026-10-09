import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireQuestionAccess } from '../services/access.js';
import { aiJudgePair, failureOf } from '../services/ai.js';
import { neighbourPairs, orient, pairKey, randomPairs } from '../services/ranking.js';
import { computeRanking } from '../services/rankingData.js';
import type { ComparativeNextPair, ComparativeStatus } from '@marker/shared-types';

const router = Router();

const aiConfigured = () => config.aiStub || Boolean(config.googleApiKey);
const num = (v: unknown) => Number(v ?? 0);

// Pairs joined with their (at most one) human and (at most one) AI judgement.
const PAIR_JUDGEMENTS = `
  FROM comparative_pairs p
  LEFT JOIN comparative_judgements h ON h.pair_id = p.id AND h.source = 'human'
  LEFT JOIN comparative_judgements a ON a.pair_id = p.id AND a.source = 'ai'`;

const base = '/exams/:examId/compare/:questionId';

router.get(`${base}/status`, requireAuth, async (req, res, next) => {
  try {
    const q = await requireQuestionAccess(req, res, req.params.questionId, { examId: req.params.examId });
    if (!q) return;
    const row = (await db.raw(
      `SELECT COUNT(*) AS pairs_total, COALESCE(MAX(p.round), 0) AS rounds,
              COUNT(*) FILTER (WHERE h.id IS NOT NULL) AS human_judged,
              COUNT(*) FILTER (WHERE h.id IS NULL AND a.id IS NOT NULL) AS ai_judged,
              COUNT(*) FILTER (WHERE h.id IS NULL AND a.id IS NULL) AS unjudged,
              COUNT(*) FILTER (WHERE h.id IS NULL) AS human_available,
              COUNT(*) FILTER (WHERE h.judged_by = ?) AS my_judged
       ${PAIR_JUDGEMENTS}
       WHERE p.question_id = ?`,
      [req.user!.sub, q.question_id],
    )).rows[0] as Record<string, string>;
    const clips = await db('script_clips').where({ question_id: q.question_id }).count('id as n').first<{ n: string }>();
    const status: ComparativeStatus = {
      marking_mode: q.marking_mode,
      max_marks: q.max_marks,
      clips: num(clips?.n),
      pairs_total: num(row.pairs_total),
      rounds: num(row.rounds),
      human_judged: num(row.human_judged),
      ai_judged: num(row.ai_judged),
      unjudged: num(row.unjudged),
      human_available: num(row.human_available),
      my_judged: num(row.my_judged),
    };
    res.json({ data: status });
  } catch (err) {
    next(err);
  }
});

// Create the next round of pairs. Round 1 is a connected random pairing; later
// rounds compare scripts that are neighbours in the current ranking.
router.post(`${base}/pairs`, requireAuth, async (req, res, next) => {
  try {
    const body = z.object({
      per_item: z.number().int().min(1).max(20).default(6),
      preview: z.boolean().default(false),
    }).parse(req.body ?? {});
    const q = await requireQuestionAccess(req, res, req.params.questionId, { leadOnly: true, examId: req.params.examId });
    if (!q) return;
    if (q.marking_mode !== 'comparative') {
      res.status(409).json({ error: 'Switch this question to "Rank by comparison" first.', code: 'NOT_COMPARATIVE' }); return;
    }

    const clips = await db('script_clips').where({ question_id: q.question_id }).select<{ id: string }[]>('id');
    if (clips.length < 2) {
      res.status(409).json({ error: 'At least two clipped scripts are needed to compare.', code: 'NEED_CLIPS' }); return;
    }

    const existing = (await db.raw(
      `SELECT p.clip_a_id, p.clip_b_id, p.round, (h.id IS NOT NULL OR a.id IS NOT NULL) AS judged ${PAIR_JUDGEMENTS}
        WHERE p.question_id = ?`,
      [q.question_id],
    )).rows as { clip_a_id: string; clip_b_id: string; round: number; judged: boolean }[];

    const unjudged = existing.filter((p) => !p.judged).length;
    if (unjudged > 0) {
      res.status(409).json({
        error: `${unjudged} comparison${unjudged === 1 ? '' : 's'} from the last round ${unjudged === 1 ? 'has' : 'have'} not been judged yet. Finish those first.`,
        code: 'ROUND_INCOMPLETE',
      }); return;
    }

    const round = existing.length ? Math.max(...existing.map((p) => p.round)) + 1 : 1;
    const used = new Set(existing.map((p) => pairKey(p.clip_a_id, p.clip_b_id)));
    const ids = clips.map((c) => c.id);
    const rng = Math.random;
    const raw = round === 1
      ? randomPairs(ids, body.per_item, used, rng)
      : neighbourPairs((await computeRanking(q.question_id)).ranked.map((r) => r.clip_id), Math.max(1, Math.floor(body.per_item / 3)), used);
    const pairs = orient(raw, rng);

    if (body.preview || pairs.length === 0) {
      res.json({ data: { round, count: pairs.length, created: 0 } }); return;
    }
    try {
      await db('comparative_pairs').insert(pairs.map(([a, b]) => ({
        exam_id: req.params.examId, question_id: q.question_id, clip_a_id: a, clip_b_id: b, round,
      })));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'Another round was created at the same time. Refresh and try again.', code: 'CONFLICT' }); return;
      }
      throw err;
    }
    res.status(201).json({ data: { round, count: pairs.length, created: pairs.length } });
  } catch (err) {
    next(err);
  }
});

// A random pair a teacher can still judge: scripts nobody has judged first,
// then pairs only the AI has judged (a human judgement overrides the AI's).
router.get(`${base}/next`, requireAuth, async (req, res, next) => {
  try {
    const q = await requireQuestionAccess(req, res, req.params.questionId, { examId: req.params.examId });
    if (!q) return;
    const pair = (await db.raw(
      `SELECT p.id, p.clip_a_id, p.clip_b_id ${PAIR_JUDGEMENTS}
        WHERE p.question_id = ? AND h.id IS NULL
        ORDER BY (a.id IS NOT NULL), random() LIMIT 1`,
      [q.question_id],
    )).rows[0] as { id: string; clip_a_id: string; clip_b_id: string } | undefined;
    if (!pair) { res.json({ data: null, meta: { message: 'No more pairs to compare' } }); return; }
    const remaining = (await db.raw(
      `SELECT COUNT(*) AS n ${PAIR_JUDGEMENTS} WHERE p.question_id = ? AND h.id IS NULL`,
      [q.question_id],
    )).rows[0].n;
    const out: ComparativeNextPair = {
      pair_id: pair.id, clip_a_id: pair.clip_a_id, clip_b_id: pair.clip_b_id, remaining: num(remaining),
    };
    res.json({ data: out });
  } catch (err) {
    next(err);
  }
});

router.post('/compare/pairs/:pairId/judge', requireAuth, async (req, res, next) => {
  try {
    const pairId = z.string().uuid().parse(req.params.pairId);
    const body = z.object({ winner_clip_id: z.string().uuid() }).parse(req.body);
    const pair = await db('comparative_pairs').where({ id: pairId })
      .first<{ id: string; question_id: string; clip_a_id: string; clip_b_id: string }>();
    if (!pair) { res.status(404).json({ error: 'Pair not found', code: 'NOT_FOUND' }); return; }
    if (!(await requireQuestionAccess(req, res, pair.question_id))) return;
    if (body.winner_clip_id !== pair.clip_a_id && body.winner_clip_id !== pair.clip_b_id) {
      res.status(422).json({ error: 'The winner must be one of the two scripts in the pair', code: 'VALIDATION' }); return;
    }
    try {
      await db('comparative_judgements').insert({
        pair_id: pair.id, source: 'human', judged_by: req.user!.sub, winner_clip_id: body.winner_clip_id,
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'Someone else has already judged this pair.', code: 'ALREADY_JUDGED' }); return;
      }
      throw err;
    }
    res.status(201).json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

// AI judges the pairs nobody has judged. Driven in small steps by the browser
// (see the note in routes/ai.ts).
router.post(`${base}/ai-judge/plan`, requireAuth, async (req, res, next) => {
  try {
    const q = await requireQuestionAccess(req, res, req.params.questionId, { leadOnly: true, examId: req.params.examId });
    if (!q) return;
    if (!aiConfigured()) {
      res.status(503).json({ error: 'AI judging is not set up (no Gemini key configured).', code: 'AI_NOT_CONFIGURED' }); return;
    }
    const rows = (await db.raw(
      `SELECT p.id ${PAIR_JUDGEMENTS} WHERE p.question_id = ? AND h.id IS NULL AND a.id IS NULL ORDER BY p.round, p.created_at`,
      [q.question_id],
    )).rows as { id: string }[];
    res.json({ data: { pair_ids: rows.map((r) => r.id), total: rows.length, has_mark_scheme: Boolean(q.ms_clip_image_url) } });
  } catch (err) {
    next(err);
  }
});

router.post(`${base}/ai-judge/step`, requireAuth, async (req, res, next) => {
  try {
    const body = z.object({
      pair_ids: z.array(z.string().uuid()).min(1).max(3),
      guidance: z.string().max(4000).optional(),
      use_examples: z.boolean().default(true),
    }).parse(req.body);
    const q = await requireQuestionAccess(req, res, req.params.questionId, { leadOnly: true, examId: req.params.examId });
    if (!q) return;
    if (!aiConfigured()) {
      res.status(503).json({ error: 'AI judging is not set up (no Gemini key configured).', code: 'AI_NOT_CONFIGURED' }); return;
    }
    const pairs = await db('comparative_pairs').whereIn('id', body.pair_ids).andWhere({ question_id: q.question_id })
      .select<{ id: string; clip_a_id: string; clip_b_id: string }[]>('id', 'clip_a_id', 'clip_b_id');
    const byId = new Map(pairs.map((p) => [p.id, p]));
    const results = await Promise.all(body.pair_ids.map(async (id) => {
      const pair = byId.get(id);
      if (!pair) return { pair_id: id, ok: false, error: 'Pair not found for this question' };
      try {
        await aiJudgePair(pair, q, { guidance: body.guidance, useExamples: body.use_examples });
        return { pair_id: id, ok: true };
      } catch (err) {
        const failure = failureOf(err);
        console.error(`AI judging failed for pair ${id} [${failure.code}]:`, (err as Error).message);
        return {
          pair_id: id, ok: false, error: failure.message, code: failure.code,
          retryable: failure.retryable, fatal: failure.fatal, retry_after_seconds: failure.retry_after_seconds,
        };
      }
    }));
    res.json({ data: { results } });
  } catch (err) {
    next(err);
  }
});

router.get(`${base}/ranking`, requireAuth, async (req, res, next) => {
  try {
    const q = await requireQuestionAccess(req, res, req.params.questionId, { leadOnly: true, examId: req.params.examId });
    if (!q) return;
    res.json({ data: await computeRanking(q.question_id) });
  } catch (err) {
    next(err);
  }
});

export default router;
