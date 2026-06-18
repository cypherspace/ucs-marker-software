import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { storage } from '../services/storage.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { GoogleGenAI } from '@google/genai';

const router = Router();

function gemini() {
  if (!config.googleApiKey) throw new Error('GOOGLE_API_KEY not configured');
  return new GoogleGenAI({ apiKey: config.googleApiKey });
}

// Trigger OCR on a clip
router.post('/clips/:id/ocr', requireAuth, async (req, res, next) => {
  try {
    const clip = await db('script_clips').where({ id: req.params.id }).first<{ clip_image_url: string }>();
    if (!clip) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }

    // Call the Python extractor OCR endpoint
    const resp = await fetch(`${config.extractorUrl}/ocr`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image_url: storage.rawUri(clip.clip_image_url) }),
    });
    if (!resp.ok) {
      res.status(502).json({ error: 'OCR failed', code: 'OCR_ERROR' }); return;
    }
    const result = (await resp.json()) as { text: string };
    await db('script_clips').where({ id: req.params.id }).update({ ocr_text: result.text });
    res.json({ data: { ocr_text: result.text } });
  } catch (err) {
    next(err);
  }
});

// AI mark a clip
router.post('/clips/:id/ai-mark', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const body = z.object({
      mark_scheme_text: z.string().min(1),
      examiner_report_text: z.string().optional(),
      generate_feedback: z.boolean().default(false),
    }).parse(req.body);

    const clip = await db('script_clips as sc')
      .join('exam_questions as eq', 'eq.id', 'sc.question_id')
      .where('sc.id', req.params.id)
      .first<{ clip_image_url: string; max_marks: number; question_number: string; ocr_text: string | null }>();
    if (!clip) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }

    // Read image bytes
    const imageBytes = await storage.read(clip.clip_image_url);
    const imageBase64 = imageBytes.toString('base64');

    const ai = gemini();
    const prompt = buildMarkingPrompt(clip.max_marks, body.mark_scheme_text, body.examiner_report_text, body.generate_feedback);

    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
    });

    const text = response.text ?? '';
    const parsed = parseMarkingResponse(text, clip.max_marks);

    // Save AI mark
    const [mark] = await db('script_marks')
      .insert({
        clip_id: req.params.id,
        marker_id: null,
        mark_source: 'ai',
        marks_awarded: parsed.marks,
        ai_feedback: parsed.feedback ?? null,
        status: 'marked',
        marked_at: db.fn.now(),
      })
      .returning('*');

    res.json({ data: { mark, reasoning: parsed.reasoning } });
  } catch (err) {
    next(err);
  }
});

// Trigger AI marking for all unmarked clips in an exam
router.post('/exams/:id/ai-mark', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const body = z.object({
      question_id: z.string().uuid(),
      mark_scheme_text: z.string().min(1),
      examiner_report_text: z.string().optional(),
      generate_feedback: z.boolean().default(false),
    }).parse(req.body);

    const clips = await db('script_clips as sc')
      .leftJoin('script_marks as sm', function () {
        this.on('sm.clip_id', 'sc.id').andOnVal('sm.mark_source', 'ai');
      })
      .where('sc.question_id', body.question_id)
      .whereNull('sm.id')
      .select('sc.id');

    res.json({ data: { queued: clips.length, message: 'AI marking job accepted. Results will appear as clips are processed.' } });

    // Process asynchronously (fire and forget for now — production would use a job queue)
    setImmediate(async () => {
      for (const { id } of clips) {
        try {
          await fetch(`${req.protocol}://${req.get('host')}/api/v1/clips/${id}/ai-mark`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: req.headers.cookie ?? '' },
            body: JSON.stringify({ mark_scheme_text: body.mark_scheme_text, examiner_report_text: body.examiner_report_text, generate_feedback: body.generate_feedback }),
          });
        } catch (err) {
          console.error(`AI mark failed for clip ${id}:`, err);
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

function buildMarkingPrompt(maxMarks: number, markScheme: string, examinersReport?: string, generateFeedback = false): string {
  return `You are an experienced examiner marking a student's handwritten exam response.

MARK SCHEME (max ${maxMarks} marks):
${markScheme}
${examinersReport ? `\nEXAMINER REPORT:\n${examinersReport}` : ''}

The image shows a student's handwritten answer. Award marks strictly according to the mark scheme.

Respond in this exact JSON format:
{
  "marks": <integer 0–${maxMarks}>,
  "reasoning": "<brief explanation of which mark points were awarded>",
  "feedback": ${generateFeedback ? '"<constructive feedback for the student>"' : 'null'}
}

Do not include the student's name or any identifying information in your response.`;
}

function parseMarkingResponse(text: string, maxMarks: number): { marks: number; reasoning: string; feedback: string | null } {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        marks: Math.min(Math.max(0, Number(parsed.marks ?? 0)), maxMarks),
        reasoning: String(parsed.reasoning ?? ''),
        feedback: parsed.feedback ? String(parsed.feedback) : null,
      };
    }
  } catch { /* fall through */ }
  return { marks: 0, reasoning: text.slice(0, 500), feedback: null };
}

export default router;
