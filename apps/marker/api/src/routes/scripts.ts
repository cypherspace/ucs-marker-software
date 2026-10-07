import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db.js';
import { storage, isGcsUri } from '../services/storage.js';
import { isDriveUri, fileIdFromUri, getDownloadUrl, getDriveMediaRequest, uploadFile, createExamFolder } from '../services/drive.js';
import { extractorFetch, describeExtractorFailure } from '../services/extractor.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireClipAccess } from '../services/access.js';
import { createReadStream, existsSync, statSync } from 'node:fs';

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

    const exam = await db('exams').where({ id: req.params.id }).first();
    if (!exam) { res.status(404).json({ error: 'Exam not found', code: 'NOT_FOUND' }); return; }

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

// Trigger clipping job — calls Python extractor
router.post('/exams/:id/clip', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const exam = await db('exams').where({ id: req.params.id }).first();
    if (!exam) { res.status(404).json({ error: 'Exam not found', code: 'NOT_FOUND' }); return; }
    const { question_ids } = z.object({ question_ids: z.array(z.string().uuid()).optional() }).parse(req.body ?? {});
    const scripts = await db('student_scripts').where({ exam_id: req.params.id });
    const questionsQuery = db('exam_questions').where({ exam_id: req.params.id });
    if (question_ids) questionsQuery.whereIn('id', question_ids);
    const questions = await questionsQuery;

    if (!scripts.length) { res.status(422).json({ error: 'No scripts uploaded', code: 'NO_SCRIPTS' }); return; }
    if (!questions.length) { res.status(422).json({ error: 'No questions defined', code: 'NO_QUESTIONS' }); return; }

    // Resolve URIs for the extractor; Drive URIs need a temporary download URL
    const scriptPayload = await Promise.all(scripts.map(async (s) => {
      if (isDriveUri(s.original_pdf_url)) {
        const { url, headers } = await getDriveMediaRequest(exam.lead_teacher_id, fileIdFromUri(s.original_pdf_url));
        return { id: s.id, student_number: s.student_number, pdf_url: url, pdf_headers: headers };
      }
      return { id: s.id, student_number: s.student_number, pdf_url: storage.rawUri(s.original_pdf_url) };
    }));

    const questionPayload = questions.map((q) => ({
      id: q.id,
      clip_coordinates: q.clip_coordinates ?? [],
      name_zones: q.name_zones ?? [],
    }));

    let resp: Response;
    try {
      resp = await extractorFetch('/clip-scripts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scripts: scriptPayload, questions: questionPayload }),
      });
    } catch (err) {
      console.error('Extractor unreachable:', err);
      res.status(502).json({
        error: `Could not reach the clipping service: ${describeExtractorFailure(err)}`,
        code: 'EXTRACTOR_UNREACHABLE',
      });
      return;
    }
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`Extractor clip error (${resp.status}):`, body);
      let detail = '';
      try { detail = String((JSON.parse(body) as { detail?: unknown }).detail ?? ''); } catch { /* not JSON */ }
      res.status(502).json({
        error: `Clipping failed (extractor returned ${resp.status}${detail ? `: ${detail}` : ''})`,
        code: 'EXTRACTOR_ERROR',
      }); return;
    }
    const result = (await resp.json()) as { clips: { script_id: string; question_id: string; clip_image_url: string }[] };

    // Re-upload clip PNGs to Drive if exam uses Drive storage
    if (exam.use_drive_storage && exam.drive_folder_id && result.clips.length) {
      for (const c of result.clips) {
        try {
          const imgBytes = await storage.read(c.clip_image_url);
          const driveUri = await uploadFile(
            exam.lead_teacher_id,
            exam.drive_folder_id,
            `clip_${c.question_id}_${c.script_id}.png`,
            imgBytes,
            'image/png',
          );
          c.clip_image_url = driveUri;
        } catch (err) {
          console.error('[drive] Clip upload failed:', (err as Error).message);
        }
      }
    }

    // Save clips to DB
    if (result.clips.length) {
      await db('script_clips')
        .insert(result.clips.map((c) => ({
          script_id: c.script_id,
          question_id: c.question_id,
          clip_image_url: c.clip_image_url,
        })))
        .onConflict(['script_id', 'question_id']).merge(['clip_image_url']);
    }

    // Clip the mark scheme too, if one has been uploaded and any question has
    // MS regions defined. One MS clip per question, stored on the question.
    let msClipsCreated = 0;
    const msQuestions = questions.filter((q) => Array.isArray(q.ms_clip_coordinates) && q.ms_clip_coordinates.length);
    if (exam?.mark_scheme_pdf_url && msQuestions.length) {
      try {
        const msResp = await extractorFetch('/clip-mark-scheme', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ms_pdf_url: storage.rawUri(exam.mark_scheme_pdf_url),
            questions: msQuestions.map((q) => ({ id: q.id, ms_clip_coordinates: q.ms_clip_coordinates })),
          }),
        });
        if (msResp.ok) {
          const msResult = (await msResp.json()) as { clips: { question_id: string; ms_clip_image_url: string }[] };
          for (const c of msResult.clips) {
            await db('exam_questions').where({ id: c.question_id }).update({ ms_clip_image_url: c.ms_clip_image_url });
          }
          msClipsCreated = msResult.clips.length;
        } else {
          console.error('Mark scheme clip error:', await msResp.text());
        }
      } catch (msErr) {
        console.error('Mark scheme clipping failed:', msErr);
      }
    }

    // Update exam status to marking
    await db('exams').where({ id: req.params.id }).update({ status: 'marking' });

    res.json({ data: { clips_created: result.clips.length, ms_clips_created: msClipsCreated } });
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
      .first<{ original_pdf_url: string; lead_teacher_id: string }>();
    if (!script) { res.status(404).json({ error: 'Script not found', code: 'NOT_FOUND' }); return; }

    const page = Number(req.query.page ?? 1);
    if (!Number.isInteger(page) || page < 1) {
      res.status(400).json({ error: 'Invalid page', code: 'BAD_REQUEST' }); return;
    }

    let pdfUri: string;
    let pdfHeaders: Record<string, string> | undefined;
    if (isDriveUri(script.original_pdf_url)) {
      ({ url: pdfUri, headers: pdfHeaders } = await getDriveMediaRequest(script.lead_teacher_id, fileIdFromUri(script.original_pdf_url)));
    } else {
      pdfUri = storage.rawUri(script.original_pdf_url);
    }

    let resp: Response;
    try {
      resp = await extractorFetch('/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pdf_uri: pdfUri, pdf_headers: pdfHeaders, page_number: page, max_width: 2000 }),
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
  } catch (err) {
    next(err);
  }
});

// Get a signed/local URL for a script's full PDF
router.get('/clips/:id/script', requireAuth, async (req, res, next) => {
  try {
    if (!(await requireClipAccess(req, res, req.params.id))) return;
    const clip = await db('script_clips as sc')
      .join('student_scripts as ss', 'ss.id', 'sc.script_id')
      .join('exams as e', 'e.id', 'ss.exam_id')
      .where('sc.id', req.params.id)
      .first<{ original_pdf_url: string; lead_teacher_id: string }>();
    if (!clip) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
    let url: string;
    if (isDriveUri(clip.original_pdf_url)) {
      url = await getDownloadUrl(clip.lead_teacher_id, fileIdFromUri(clip.original_pdf_url));
    } else {
      url = await storage.publicUrl(clip.original_pdf_url);
    }
    res.json({ data: { url } });
  } catch (err) {
    next(err);
  }
});

// Serve local file contents via /files/*?u=<uri>
router.get('/files/*', async (req, res, next) => {
  try {
    const uri = String(req.query.u ?? '');
    if (!uri) { res.status(400).json({ error: 'Missing u param', code: 'BAD_REQUEST' }); return; }
    if (isGcsUri(uri)) {
      const signed = await storage.publicUrl(uri);
      res.redirect(302, signed); return;
    }
    if (!existsSync(uri)) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
    const stat = statSync(uri);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Type', uri.endsWith('.pdf') ? 'application/pdf' : 'image/png');
    createReadStream(uri).pipe(res);
  } catch (err) {
    next(err);
  }
});

export default router;
