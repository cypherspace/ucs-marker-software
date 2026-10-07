import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { storage } from '../services/storage.js';
import { uploadFile } from '../services/drive.js';
import { scriptPdfSource } from '../services/scriptSource.js';
import { extractorFetch, describeExtractorFailure } from '../services/extractor.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireQuestionAccess } from '../services/access.js';
import { recordAudit } from '../services/audit.js';

// Per-script clips: a script with a different layout (typed, scribed, pages missing)
// can have its own regions for one question, instead of the question's standard ones.

const router = Router();

const RegionSchema = z.object({
  page: z.number().int().min(1).max(1000),
  x: z.number().min(0).max(20000),
  y: z.number().min(0).max(20000),
  width: z.number().min(1).max(20000),
  height: z.number().min(1).max(20000),
});
type Region = z.infer<typeof RegionSchema>;

const SetClipSchema = z.object({
  regions: z.array(RegionSchema).min(1).max(12),
  // Lead teacher / admin only. Empty or omitted means "use the question's name zones".
  name_zones: z.array(RegionSchema).max(12).optional(),
});

interface ScriptRow {
  id: string;
  exam_id: string;
  student_number: string;
  original_pdf_url: string;
  lead_teacher_id: string;
  use_drive_storage: boolean;
  drive_folder_id: string | null;
}

type MadeClip = { uri: string } | { fail: { status: number; error: string; code: string } };

async function makeClip(script: ScriptRow, questionId: string, regions: Region[], nameZones: Region[]): Promise<MadeClip> {
  const src = await scriptPdfSource(script.original_pdf_url, script.lead_teacher_id);
  let resp: Response;
  try {
    resp = await extractorFetch('/clip-scripts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scripts: [{ id: script.id, student_number: script.student_number, pdf_url: src.url, pdf_headers: src.headers }],
        questions: [{ id: questionId, clip_coordinates: regions, name_zones: nameZones }],
      }),
    });
  } catch (err) {
    console.error('Extractor unreachable:', err);
    return { fail: { status: 502, error: `Could not reach the clipping service: ${describeExtractorFailure(err)}`, code: 'EXTRACTOR_UNREACHABLE' } };
  }
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Extractor clip error (${resp.status}):`, body);
    let detail = '';
    try { detail = String((JSON.parse(body) as { detail?: unknown }).detail ?? ''); } catch { /* not JSON */ }
    return { fail: { status: 502, error: `Clipping failed (extractor returned ${resp.status}${detail ? `: ${detail}` : ''})`, code: 'EXTRACTOR_ERROR' } };
  }
  const result = (await resp.json()) as { clips: { clip_image_url: string }[] };
  let uri = result.clips[0]?.clip_image_url;
  if (!uri) return { fail: { status: 502, error: 'The clipping service returned no image', code: 'EXTRACTOR_ERROR' } };

  if (script.use_drive_storage && script.drive_folder_id) {
    try {
      uri = await uploadFile(
        script.lead_teacher_id,
        script.drive_folder_id,
        `clip_${questionId}_${script.id}.png`,
        await storage.read(uri),
        'image/png',
      );
    } catch (err) {
      console.error('[drive] Clip upload failed:', (err as Error).message);
    }
  }
  return { uri };
}

async function loadPair(req: import('express').Request, res: import('express').Response) {
  const script = await db('student_scripts as ss')
    .join('exams as e', 'e.id', 'ss.exam_id')
    .where('ss.id', req.params.scriptId)
    .first<ScriptRow>(
      'ss.id', 'ss.exam_id', 'ss.student_number', 'ss.original_pdf_url',
      'e.lead_teacher_id', 'e.use_drive_storage', 'e.drive_folder_id',
    );
  if (!script) { res.status(404).json({ error: 'Script not found', code: 'NOT_FOUND' }); return null; }
  const access = await requireQuestionAccess(req, res, req.params.questionId, { examId: script.exam_id });
  if (!access) return null;
  const question = await db('exam_questions')
    .where({ id: req.params.questionId })
    .first<{ clip_coordinates: Region[] | null; name_zones: Region[] | null }>('clip_coordinates', 'name_zones');
  const user = req.user!;
  const isLead = user.role === 'admin' || access.lead_teacher_id === user.sub;
  return { script, question: question!, isLead };
}

const CHANGED_AFTER_MARKING = `(sc.reclipped_at IS NOT NULL AND EXISTS (
  SELECT 1 FROM script_marks hm
   WHERE hm.clip_id = sc.id AND hm.mark_source = 'human' AND hm.marked_at < sc.reclipped_at)) AS changed_after_marking`;

// Current clip settings for one script and question (the standard clip if none were set by hand)
router.get('/scripts/:scriptId/questions/:questionId/clip', requireAuth, async (req, res, next) => {
  try {
    const ctx = await loadPair(req, res);
    if (!ctx) return;
    const row = await db('script_clips as sc')
      .where({ 'sc.script_id': ctx.script.id, 'sc.question_id': req.params.questionId })
      .first<{ clip_source: string; regions: Region[] | null; name_zones: Region[] | null; reclipped_at: string | null; changed_after_marking: boolean }>(
        'sc.clip_source', 'sc.regions', 'sc.name_zones', 'sc.reclipped_at', db.raw(CHANGED_AFTER_MARKING),
      );
    res.json({
      data: {
        ...(row ?? { clip_source: 'auto', regions: null, name_zones: null, reclipped_at: null, changed_after_marking: false }),
        can_edit_name_zones: ctx.isLead,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Choose the pages/areas to use for this script and question
router.put('/scripts/:scriptId/questions/:questionId/clip', requireAuth, async (req, res, next) => {
  try {
    const body = SetClipSchema.parse(req.body);
    const ctx = await loadPair(req, res);
    if (!ctx) return;
    const { script, question, isLead } = ctx;
    const questionId = req.params.questionId;

    const existing = await db('script_clips')
      .where({ script_id: script.id, question_id: questionId })
      .first<{ id: string; name_zones: Region[] | null }>('id', 'name_zones');

    // Only the lead teacher or an admin can change this script's name zones; everyone else keeps what is set.
    const nameZones: Region[] | null = isLead && body.name_zones !== undefined
      ? (body.name_zones.length ? body.name_zones : null)
      : existing?.name_zones ?? null;

    const made = await makeClip(script, questionId, body.regions, nameZones ?? question.name_zones ?? []);
    if ('fail' in made) { res.status(made.fail.status).json({ error: made.fail.error, code: made.fail.code }); return; }

    const values = {
      clip_image_url: made.uri,
      regions: JSON.stringify(body.regions),
      name_zones: nameZones ? JSON.stringify(nameZones) : null,
      clip_source: 'manual',
      reclipped_at: db.fn.now(),
      reclipped_by: req.user!.sub,
      ocr_text: null,
    };
    const [clip] = await db('script_clips')
      .insert({ script_id: script.id, question_id: questionId, ...values })
      .onConflict(['script_id', 'question_id'])
      .merge(values)
      .returning(['id']);

    const hadMarks = existing
      ? await db('script_marks').where({ clip_id: existing.id, mark_source: 'human' }).first('id')
      : undefined;
    await recordAudit(req, 'clip.set_manual', 'script_clip', clip.id as string, {
      script_id: script.id, question_id: questionId, regions: body.regions.length, marked_before: Boolean(hadMarks),
    });
    res.json({ data: { clip_id: clip.id, clip_source: 'manual', marked_before: Boolean(hadMarks) } });
  } catch (err) {
    next(err);
  }
});

// Go back to the question's standard regions for this script
router.delete('/scripts/:scriptId/questions/:questionId/clip', requireAuth, async (req, res, next) => {
  try {
    const ctx = await loadPair(req, res);
    if (!ctx) return;
    const { script, question } = ctx;
    const questionId = req.params.questionId;

    const existing = await db('script_clips')
      .where({ script_id: script.id, question_id: questionId })
      .first<{ id: string; clip_source: string }>('id', 'clip_source');
    if (!existing || existing.clip_source !== 'manual') {
      res.status(409).json({ error: 'This clip already uses the standard regions', code: 'NOT_MANUAL' }); return;
    }
    if (!question.clip_coordinates?.length) {
      res.status(422).json({ error: 'The question has no standard regions to go back to', code: 'NO_REGIONS' }); return;
    }

    const made = await makeClip(script, questionId, question.clip_coordinates, question.name_zones ?? []);
    if ('fail' in made) { res.status(made.fail.status).json({ error: made.fail.error, code: made.fail.code }); return; }

    await db('script_clips').where({ id: existing.id }).update({
      clip_image_url: made.uri,
      regions: null,
      name_zones: null,
      clip_source: 'auto',
      reclipped_at: db.fn.now(),
      reclipped_by: req.user!.sub,
      ocr_text: null,
    });
    await recordAudit(req, 'clip.reset', 'script_clip', existing.id, { script_id: script.id, question_id: questionId });
    res.json({ data: { clip_id: existing.id, clip_source: 'auto' } });
  } catch (err) {
    next(err);
  }
});

export default router;
