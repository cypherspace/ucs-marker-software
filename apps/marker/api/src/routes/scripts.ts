import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db.js';
import { storage, isGcsUri } from '../services/storage.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
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

    const inserted: { id: string; student_number: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const studentNumber = String(startIndex + i).padStart(3, '0');
      const key = `scripts/${req.params.id}/${studentNumber}.pdf`;
      const uri = await storage.write(key, file.buffer);
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
    const scripts = await db('student_scripts').where({ exam_id: req.params.id });
    const questions = await db('exam_questions').where({ exam_id: req.params.id });

    if (!scripts.length) { res.status(422).json({ error: 'No scripts uploaded', code: 'NO_SCRIPTS' }); return; }
    if (!questions.length) { res.status(422).json({ error: 'No questions defined', code: 'NO_QUESTIONS' }); return; }

    // Resolve public URIs for the extractor (GCS raw URIs or local paths)
    const scriptPayload = scripts.map((s) => ({
      id: s.id,
      student_number: s.student_number,
      pdf_url: storage.rawUri(s.original_pdf_url),
    }));
    const questionPayload = questions.map((q) => ({
      id: q.id,
      clip_coordinates: q.clip_coordinates ?? [],
      name_zones: q.name_zones ?? [],
    }));

    const resp = await fetch(`${config.extractorUrl}/clip-scripts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scripts: scriptPayload, questions: questionPayload }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error('Extractor error:', body);
      res.status(502).json({ error: 'Extractor failed', code: 'EXTRACTOR_ERROR' }); return;
    }
    const result = (await resp.json()) as { clips: { script_id: string; question_id: string; clip_image_url: string }[] };

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

    // Update exam status to marking
    await db('exams').where({ id: req.params.id }).update({ status: 'marking' });

    res.json({ data: { clips_created: result.clips.length } });
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
    const script = await db('student_scripts')
      .where({ id: req.params.scriptId })
      .first<{ original_pdf_url: string }>();
    if (!script) { res.status(404).json({ error: 'Script not found', code: 'NOT_FOUND' }); return; }

    const page = Number(req.query.page ?? 1);
    if (!Number.isInteger(page) || page < 1) {
      res.status(400).json({ error: 'Invalid page', code: 'BAD_REQUEST' }); return;
    }

    const resp = await fetch(`${config.extractorUrl}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pdf_uri: storage.rawUri(script.original_pdf_url), page_number: page, max_width: 2000 }),
    });
    if (!resp.ok) {
      console.error('Extractor render error:', await resp.text());
      res.status(502).json({ error: 'Render failed', code: 'EXTRACTOR_ERROR' }); return;
    }
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
    const clip = await db('script_clips as sc')
      .join('student_scripts as ss', 'ss.id', 'sc.script_id')
      .where('sc.id', req.params.id)
      .first<{ original_pdf_url: string }>();
    if (!clip) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
    const url = await storage.publicUrl(clip.original_pdf_url);
    res.json({ data: { url } });
  } catch (err) {
    next(err);
  }
});

// Serve local file contents via /files/<rel-path>
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
