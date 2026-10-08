import { Router, type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db.js';
import { storage } from '../services/storage.js';
import { uploadFile, createExamFolder } from '../services/drive.js';
import { scriptPdfSource } from '../services/scriptSource.js';
import { extractorFetch, describeExtractorFailure } from '../services/extractor.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Upload student scripts for an exam
router.post('/exams/:id/scripts', requireAuth, requireRole(['teacher', 'admin']), upload.array('scripts', 100), async (req, res, next) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) {
      res.status(422).json({ error: 'No files uploaded', code: 'NO_FILES' }); return;
    }

    // Optionally accept a CSV mapping: student_number,student_name
    // For now, auto-assign sequential student numbers if not provided
    const exam = await db('exams').where({ id: req.params.id }).first();
    if (!exam) { res.status(404).json({ error: 'Exam not found', code: 'NOT_FOUND' }); return; }

    const existingCount = await db('student_scripts')
      .where({ exam_id: req.params.id })
      .count('id as n')
      .first<{ n: string }>();
    const startIndex = Number(existingCount?.n ?? 0) + 1;

    // Ensure Drive folder exists for this exam
    let driveFolderId: string | null = exam.drive_folder_id ?? null;
    if (exam.use_drive_storage && !driveFolderId) {
      try {
        driveFolderId = await createExamFolder(exam.lead_teacher_id, exam.name);
        await db('exams').where({ id: req.params.id }).update({ drive_folder_id: driveFolderId });
      } catch (err) {
        console.warn('[drive] Folder creation failed during upload:', (err as Error).message);
      }
    }

    const inserted: { id: string; student_number: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const studentNumber = String(startIndex + i).padStart(3, '0');
      let uri: string;
      if (exam.use_drive_storage && driveFolderId) {
        uri = await uploadFile(exam.lead_teacher_id, driveFolderId, `${studentNumber}.pdf`, file.buffer, 'application/pdf');
      } else {
        const key = `scripts/${req.params.id}/${studentNumber}.pdf`;
        uri = await storage.write(key, file.buffer);
      }
      const [row] = await db('student_scripts')
        .insert({ exam_id: req.params.id, student_number: studentNumber, original_pdf_url: uri })
        .returning(['id', 'student_number']);
      inserted.push(row as { id: string; student_number: string });
    }
    res.status(201).json({ data: inserted });
  } catch (err) {
    next(err);
  }
});

// Upload the mark scheme PDF for an exam (one per exam)
router.post('/exams/:id/mark-scheme', requireAuth, requireRole(['teacher', 'admin']), upload.single('mark_scheme'), async (req, res, next) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) { res.status(422).json({ error: 'No file uploaded', code: 'NO_FILE' }); return; }

    const exam = await loadLeadExam(req, res);
    if (!exam) return;

    const key = `mark-schemes/${req.params.id}.pdf`;
    const uri = await storage.write(key, file.buffer);
    await db('exams').where({ id: req.params.id }).update({ mark_scheme_pdf_url: uri });
    res.status(201).json({ data: { mark_scheme_pdf_url: uri } });
  } catch (err) {
    next(err);
  }
});

// List scripts for an exam
router.get('/exams/:id/scripts', requireAuth, async (req, res, next) => {
  try {
    const rows = await db('student_scripts')
      .where({ exam_id: req.params.id })
      .orderBy('student_number');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ── Clip generation ──────────────────────────────────────────────────────────
// Clipping a whole class takes minutes (every script is fetched from storage and every clip
// uploaded), longer than one Cloud Run request may last. So the browser drives it in small
// steps: `plan` lists the scripts, `step` clips up to a few scripts per request, `finish`
// does the mark scheme and marks the exam as ready. The old single-call route is kept and
// simply runs the same steps in one go.

interface ClipExam {
  id: string;
  lead_teacher_id: string;
  use_drive_storage: boolean;
  drive_folder_id: string | null;
  mark_scheme_pdf_url: string | null;
}
interface ClipScript { id: string; student_number: string; original_pdf_url: string }
interface ClipQuestion {
  id: string;
  clip_coordinates: unknown[] | null;
  name_zones: unknown[] | null;
  ms_clip_coordinates: unknown[] | null;
}
interface Failure { status: number; error: string; code: string }

const ClipBodySchema = z.object({ question_ids: z.array(z.string().uuid()).optional() });

// The exam in the URL, if the signed-in user may set it up (its lead teacher, or an admin)
async function loadLeadExam(req: ExpressRequest, res: ExpressResponse): Promise<ClipExam | null> {
  const exam = await db('exams').where({ id: req.params.id }).first<ClipExam>(
    'id', 'lead_teacher_id', 'use_drive_storage', 'drive_folder_id', 'mark_scheme_pdf_url',
  );
  if (!exam) { res.status(404).json({ error: 'Exam not found', code: 'NOT_FOUND' }); return null; }
  const user = req.user!;
  if (user.role !== 'admin' && exam.lead_teacher_id !== user.sub) {
    res.status(403).json({ error: 'Only the exam\'s lead teacher can set this up', code: 'FORBIDDEN' }); return null;
  }
  return exam;
}

// Ask the extractor for one page of a PDF as a PNG and pass it on (with the page count in X-Page-Count).
// max_width is fixed high so the render scale is always 150/72: the frontend relies on that to convert
// the regions it draws (image pixels) back to PDF points before saving.
async function sendRenderedPage(
  res: ExpressResponse,
  opts: { pdfUri: string; pdfHeaders?: Record<string, string>; page: number; maskZones?: unknown[] },
): Promise<void> {
  let resp: Response;
  try {
    resp = await extractorFetch('/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pdf_uri: opts.pdfUri, pdf_headers: opts.pdfHeaders, page_number: opts.page, max_width: 2000, mask_zones: opts.maskZones,
      }),
    });
  } catch (err) {
    console.error('Extractor unreachable:', err);
    res.status(502).json({
      error: `Could not reach the page renderer: ${describeExtractorFailure(err)}`,
      code: 'EXTRACTOR_UNREACHABLE',
    });
    return;
  }
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Extractor render error (${resp.status}):`, body);
    let detail = '';
    try { detail = String((JSON.parse(body) as { detail?: unknown }).detail ?? ''); } catch { /* not JSON */ }
    if (resp.status === 400) {
      res.status(400).json({ error: detail || 'Invalid page', code: 'BAD_REQUEST' }); return;
    }
    res.status(502).json({
      error: `Page render failed (extractor returned ${resp.status}${detail ? `: ${detail}` : ''})`,
      code: 'EXTRACTOR_ERROR',
    });
    return;
  }
  const pageCount = resp.headers.get('x-page-count');
  if (pageCount) res.setHeader('X-Page-Count', pageCount);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(Buffer.from(await resp.arrayBuffer()));
}

async function loadClipJob(
  req: ExpressRequest, res: ExpressResponse, questionIds?: string[],
): Promise<{ exam: ClipExam; scripts: ClipScript[]; questions: ClipQuestion[] } | null> {
  const exam = await loadLeadExam(req, res);
  if (!exam) return null;
  const scripts = await db('student_scripts').where({ exam_id: exam.id }).orderBy('student_number')
    .select<ClipScript[]>('id', 'student_number', 'original_pdf_url');
  const questionsQuery = db('exam_questions').where({ exam_id: exam.id });
  if (questionIds) questionsQuery.whereIn('id', questionIds);
  const questions = await questionsQuery.select<ClipQuestion[]>('id', 'clip_coordinates', 'name_zones', 'ms_clip_coordinates');
  if (!scripts.length) { res.status(422).json({ error: 'No scripts uploaded', code: 'NO_SCRIPTS' }); return null; }
  if (!questions.length) { res.status(422).json({ error: 'No questions defined', code: 'NO_QUESTIONS' }); return null; }
  return { exam, scripts, questions };
}

// Clip every question for one script. Clips chosen by hand for this script are left alone.
// `fatal` means every other script would fail the same way (the clipping service is down).
async function clipOneScript(
  exam: ClipExam, script: ClipScript, questions: ClipQuestion[],
): Promise<{ made: number; kept: number } | (Failure & { fatal: boolean })> {
  const manual = new Set((await db('script_clips')
    .where({ script_id: script.id, clip_source: 'manual' })
    .whereIn('question_id', questions.map((q) => q.id))
    .select<{ question_id: string }[]>('question_id')).map((r) => r.question_id));
  const todo = questions.filter((q) => !manual.has(q.id));
  if (!todo.length) return { made: 0, kept: manual.size };

  let src;
  try {
    src = await scriptPdfSource(script.original_pdf_url, exam.lead_teacher_id);
  } catch (err) {
    return { status: 502, error: `Could not open the script: ${(err as Error).message}`, code: 'SCRIPT_UNAVAILABLE', fatal: false };
  }

  let resp: Response;
  try {
    resp = await extractorFetch('/clip-scripts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scripts: [{ id: script.id, student_number: script.student_number, pdf_url: src.url, pdf_headers: src.headers }],
        questions: todo.map((q) => ({ id: q.id, clip_coordinates: q.clip_coordinates ?? [], name_zones: q.name_zones ?? [] })),
      }),
    });
  } catch (err) {
    console.error('Extractor unreachable:', err);
    return {
      status: 502, code: 'EXTRACTOR_UNREACHABLE', fatal: true,
      error: `Could not reach the clipping service: ${describeExtractorFailure(err)}`,
    };
  }
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Extractor clip error (${resp.status}):`, body);
    let detail = '';
    try { detail = String((JSON.parse(body) as { detail?: unknown }).detail ?? ''); } catch { /* not JSON */ }
    return {
      status: 502, code: 'EXTRACTOR_ERROR', fatal: false,
      error: `Clipping failed (extractor returned ${resp.status}${detail ? `: ${detail}` : ''})`,
    };
  }
  const result = (await resp.json()) as { clips: { script_id: string; question_id: string; clip_image_url: string }[] };

  // Move the clip images into the lead teacher's Drive when the exam stores files there
  if (exam.use_drive_storage && exam.drive_folder_id) {
    await Promise.all(result.clips.map(async (c) => {
      try {
        c.clip_image_url = await uploadFile(
          exam.lead_teacher_id, exam.drive_folder_id!, `clip_${c.question_id}_${c.script_id}.png`,
          await storage.read(c.clip_image_url), 'image/png',
        );
      } catch (err) {
        console.error('[drive] Clip upload failed:', (err as Error).message);
      }
    }));
  }

  if (result.clips.length) {
    await db('script_clips')
      .insert(result.clips.map((c) => ({ script_id: c.script_id, question_id: c.question_id, clip_image_url: c.clip_image_url })))
      .onConflict(['script_id', 'question_id']).merge(['clip_image_url']);
  }
  return { made: result.clips.length, kept: manual.size };
}

// One mark-scheme clip per question (not per script), stored on the question. A question whose
// mark-scheme region was cleared loses its old image so markers never see a stale one.
async function clipMarkScheme(exam: ClipExam, questions: ClipQuestion[]): Promise<{ created: number; error?: string }> {
  if (!exam.mark_scheme_pdf_url) return { created: 0 };
  const withRegions = questions.filter((q) => Array.isArray(q.ms_clip_coordinates) && q.ms_clip_coordinates.length);
  const withoutRegions = questions.filter((q) => !withRegions.includes(q)).map((q) => q.id);
  if (withoutRegions.length) {
    await db('exam_questions').whereIn('id', withoutRegions).update({ ms_clip_image_url: null });
  }
  if (!withRegions.length) return { created: 0 };
  try {
    const msResp = await extractorFetch('/clip-mark-scheme', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ms_pdf_url: storage.rawUri(exam.mark_scheme_pdf_url),
        questions: withRegions.map((q) => ({ id: q.id, ms_clip_coordinates: q.ms_clip_coordinates })),
      }),
    });
    if (!msResp.ok) {
      const body = await msResp.text();
      console.error('Mark scheme clip error:', body);
      let detail = '';
      try { detail = String((JSON.parse(body) as { detail?: unknown }).detail ?? ''); } catch { /* not JSON */ }
      return { created: 0, error: `Mark scheme clipping failed (extractor returned ${msResp.status}${detail ? `: ${detail}` : ''})` };
    }
    const msResult = (await msResp.json()) as { clips: { question_id: string; ms_clip_image_url: string }[] };
    for (const c of msResult.clips) {
      await db('exam_questions').where({ id: c.question_id }).update({ ms_clip_image_url: c.ms_clip_image_url });
    }
    return { created: msResult.clips.length };
  } catch (err) {
    console.error('Mark scheme clipping failed:', err);
    return { created: 0, error: `Could not reach the clipping service: ${describeExtractorFailure(err)}` };
  }
}

// Mark scheme, then the exam is ready to mark.
async function finishClipping(exam: ClipExam, questions: ClipQuestion[]): Promise<number> {
  const { created } = await clipMarkScheme(exam, questions);
  await db('exams').where({ id: exam.id }).update({ status: 'marking' });
  return created;
}

const clipAuth = [requireAuth, requireRole(['teacher', 'admin'])];

// 1. Which scripts need clipping
router.post('/exams/:id/clip/plan', ...clipAuth, async (req, res, next) => {
  try {
    const { question_ids } = ClipBodySchema.parse(req.body ?? {});
    const job = await loadClipJob(req, res, question_ids);
    if (!job) return;
    res.json({ data: { script_ids: job.scripts.map((s) => s.id), questions: job.questions.length } });
  } catch (err) {
    next(err);
  }
});

// 2. Clip a few scripts (one failed script does not stop the rest; an unreachable service does)
router.post('/exams/:id/clip/step', ...clipAuth, async (req, res, next) => {
  try {
    const body = ClipBodySchema.extend({ script_ids: z.array(z.string().uuid()).min(1).max(5) }).parse(req.body ?? {});
    const job = await loadClipJob(req, res, body.question_ids);
    if (!job) return;
    const results: { id: string; ok: boolean; error?: string; clips?: number; kept?: number }[] = [];
    for (const id of body.script_ids) {
      const script = job.scripts.find((s) => s.id === id);
      if (!script) { results.push({ id, ok: false, error: 'Script not found' }); continue; }
      const out = await clipOneScript(job.exam, script, job.questions);
      if ('error' in out) {
        if (out.fatal) { res.status(out.status).json({ error: out.error, code: out.code }); return; }
        results.push({ id, ok: false, error: out.error });
      } else {
        results.push({ id, ok: true, clips: out.made, kept: out.kept });
      }
    }
    res.json({ data: { results } });
  } catch (err) {
    next(err);
  }
});

// 3. Mark scheme and status
router.post('/exams/:id/clip/finish', ...clipAuth, async (req, res, next) => {
  try {
    const { question_ids } = ClipBodySchema.parse(req.body ?? {});
    const job = await loadClipJob(req, res, question_ids);
    if (!job) return;
    res.json({ data: { ms_clips_created: await finishClipping(job.exam, job.questions) } });
  } catch (err) {
    next(err);
  }
});

// Clip just the mark scheme (one image per question that has a mark-scheme region). Does not touch the
// scripts or the exam status, so it can be run as soon as mark-scheme regions have been drawn.
router.post('/exams/:id/mark-scheme/clip', ...clipAuth, async (req, res, next) => {
  try {
    const exam = await loadLeadExam(req, res);
    if (!exam) return;
    if (!exam.mark_scheme_pdf_url) {
      res.status(422).json({ error: 'No mark scheme has been uploaded for this exam', code: 'NO_MARK_SCHEME' }); return;
    }
    const questions = await db('exam_questions').where({ exam_id: exam.id })
      .select<ClipQuestion[]>('id', 'clip_coordinates', 'name_zones', 'ms_clip_coordinates');
    const { created, error } = await clipMarkScheme(exam, questions);
    if (error) { res.status(502).json({ error, code: 'EXTRACTOR_ERROR' }); return; }
    res.json({ data: { ms_clips_created: created } });
  } catch (err) {
    next(err);
  }
});

// Everything in one request (fine for a handful of scripts; the setup page uses the steps above)
router.post('/exams/:id/clip', ...clipAuth, async (req, res, next) => {
  try {
    const { question_ids } = ClipBodySchema.parse(req.body ?? {});
    const job = await loadClipJob(req, res, question_ids);
    if (!job) return;
    let made = 0;
    let kept = 0;
    for (const script of job.scripts) {
      const out = await clipOneScript(job.exam, script, job.questions);
      if ('error' in out) { res.status(out.status).json({ error: out.error, code: out.code }); return; }
      made += out.made;
      kept = Math.max(kept, out.kept);
    }
    const ms = await finishClipping(job.exam, job.questions);
    res.json({ data: { clips_created: made, ms_clips_created: ms, manual_clips_kept: kept } });
  } catch (err) {
    next(err);
  }
});

// Render a page of a script PDF to PNG for the CoordinatePicker admin UI.
// Proxies the Python extractor. Looks the script up by id so callers can't ask
// the extractor to read arbitrary files. max_width is fixed high so the render
// scale is always 150/72 — the frontend relies on that to convert the regions
// it draws (image pixels) back to PDF points before saving.
router.get('/scripts/:scriptId/render', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const script = await db('student_scripts as ss')
      .join('exams as e', 'e.id', 'ss.exam_id')
      .where('ss.id', req.params.scriptId)
      .first<{ exam_id: string; original_pdf_url: string; lead_teacher_id: string }>(
        'ss.exam_id', 'ss.original_pdf_url', 'e.lead_teacher_id',
      );
    if (!script) { res.status(404).json({ error: 'Script not found', code: 'NOT_FOUND' }); return; }

    const page = Number(req.query.page ?? 1);
    if (!Number.isInteger(page) || page < 1) {
      res.status(400).json({ error: 'Invalid page', code: 'BAD_REQUEST' }); return;
    }

    // Only the lead teacher and admins may see an unmasked page (needed to draw name zones).
    // Other teachers must be assigned to a question on this exam, and see pages with every
    // known name zone blacked out so student names stay hidden while they browse a script.
    const user = req.user!;
    const isLead = user.role === 'admin' || script.lead_teacher_id === user.sub;
    if (!isLead) {
      const assigned = await db('marking_assignments').where({ exam_id: script.exam_id, teacher_id: user.sub }).first('teacher_id');
      if (!assigned) { res.status(403).json({ error: 'You are not assigned to this exam', code: 'FORBIDDEN' }); return; }
    }
    let maskZones: unknown[] | undefined;
    if (!isLead || req.query.masked === '1') {
      const [qRows, cRows] = await Promise.all([
        db('exam_questions').where({ exam_id: script.exam_id }).whereNotNull('name_zones').select<{ name_zones: unknown[] }[]>('name_zones'),
        db('script_clips').where({ script_id: req.params.scriptId }).whereNotNull('name_zones').select<{ name_zones: unknown[] }[]>('name_zones'),
      ]);
      maskZones = [...qRows, ...cRows].flatMap((r) => r.name_zones);
    }

    const { url: pdfUri, headers: pdfHeaders } = await scriptPdfSource(script.original_pdf_url, script.lead_teacher_id);
    await sendRenderedPage(res, { pdfUri, pdfHeaders, page, maskZones });
  } catch (err) {
    next(err);
  }
});

// The mark scheme PDF, page by page, so mark-scheme regions can be drawn on the real mark scheme.
// Lead teacher or admin only. A mark scheme holds no student data, and markers only ever see the clipped image.
router.get('/exams/:id/mark-scheme/render', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const exam = await loadLeadExam(req, res);
    if (!exam) return;
    if (!exam.mark_scheme_pdf_url) {
      res.status(404).json({ error: 'No mark scheme has been uploaded for this exam', code: 'NO_MARK_SCHEME' }); return;
    }
    const page = Number(req.query.page ?? 1);
    if (!Number.isInteger(page) || page < 1) {
      res.status(400).json({ error: 'Invalid page', code: 'BAD_REQUEST' }); return;
    }
    await sendRenderedPage(res, { pdfUri: storage.rawUri(exam.mark_scheme_pdf_url), page });
  } catch (err) {
    next(err);
  }
});

export default router;
