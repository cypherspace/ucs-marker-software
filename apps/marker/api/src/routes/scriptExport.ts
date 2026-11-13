import { Router, type Request, type Response } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireExamMember } from '../services/access.js';
import { recordAudit } from '../services/audit.js';
import { extractorFetch, describeExtractorFailure } from '../services/extractor.js';
import { finalMarks } from '../services/finalMark.js';
import { normaliseQuestionLabel as questionLabel } from '../services/questionLabel.js';
import { scriptPdfSource } from '../services/scriptSource.js';
import {
  annotationOps, annotationsOf, markStamp, pdfSafeText, pickAnnotationRow, safeFilePart, stackRegions,
  type DrawOp, type MarkRow, type Region,
} from '../services/scriptExport.js';
import type { MarkCombine } from '../services/markCombine.js';
import { sortByQuestionLabel } from '../services/questionLabel.js';

// Whole scripts as PDFs with the marking drawn on, for the lead teacher or an admin. The marks and annotations are the
// ones that count (moderated, else the exam's combine setting), see pickAnnotationRow.
const router = Router();
const staff = [requireAuth, requireRole(['teacher', 'admin'])];

interface ScriptInfo {
  id: string; exam_id: string; student_number: string; class_group: string | null; original_pdf_url: string;
  student_name: string | null; exam_name: string; lead_teacher_id: string; mark_combine: MarkCombine;
}

async function loadScript(req: Request, res: Response, scriptId: string): Promise<ScriptInfo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(scriptId)) { res.status(404).json({ error: 'Script not found', code: 'NOT_FOUND' }); return null; }
  const s = await db('student_scripts as ss')
    .join('exams as e', 'e.id', 'ss.exam_id')
    .leftJoin('users as u', 'u.id', 'ss.student_id')
    .where('ss.id', scriptId)
    .first<ScriptInfo>('ss.id', 'ss.exam_id', 'ss.student_number', 'ss.class_group', 'ss.original_pdf_url', 'u.name as student_name',
      'e.name as exam_name', 'e.lead_teacher_id', 'e.mark_combine');
  if (!s) { res.status(404).json({ error: 'Script not found', code: 'NOT_FOUND' }); return null; }
  if (!(await requireExamMember(req, res, s.exam_id, { leadOnly: true }))) return null;
  return s;
}

interface ClipRow {
  clip_id: string; regions: Region[] | null; clip_name_zones: Region[] | null; changed_after_marking: boolean;
  question_number: string; max_marks: number; clip_coordinates: Region[] | null; name_zones: Region[] | null;
  marks_awarded: number | null; mark_source: string | null;
}

// The script's pages with the annotations drawn on. includeNames=false redacts every known name zone first.
async function buildPdf(script: ScriptInfo, includeNames: boolean): Promise<{ bytes: Buffer; filename: string; notes: string[] }> {
  const clips = await db('script_clips as sc')
    .join('exam_questions as eq', 'eq.id', 'sc.question_id')
    .leftJoin(finalMarks('fm', script.mark_combine), 'fm.clip_id', 'sc.id')
    .where('sc.script_id', script.id)
    .select<ClipRow[]>(
      'sc.id as clip_id', 'sc.regions', 'sc.name_zones as clip_name_zones',
      db.raw(`(sc.reclipped_at IS NOT NULL AND EXISTS (
                SELECT 1 FROM script_marks hm WHERE hm.clip_id = sc.id AND hm.mark_source = 'human' AND hm.marked_at < sc.reclipped_at)) AS changed_after_marking`),
      'eq.question_number', 'eq.max_marks', 'eq.clip_coordinates', 'eq.name_zones', 'fm.marks_awarded', 'fm.mark_source',
    );
  const ordered = sortByQuestionLabel(clips);
  const marks = ordered.length
    ? await db('script_marks').whereIn('clip_id', ordered.map((c) => c.clip_id)).where({ mark_source: 'human' }).whereNot('status', 'pending')
      .select<(MarkRow & { clip_id: string })[]>('clip_id', 'marker_id', 'mark_source', 'status', 'marked_at', 'annotation_data')
    : [];

  const ops: DrawOp[] = [];
  const notes: string[] = [];
  const lines: string[] = [];
  let total = 0;
  let possible = 0;
  for (const c of ordered) {
    const label = questionLabel(c.question_number);
    const regions = c.regions?.length ? c.regions : c.clip_coordinates ?? [];
    const mark = c.marks_awarded;
    if (mark !== null) { total += mark; possible += c.max_marks; }
    lines.push(`${label}: ${mark === null ? 'not marked' : `${mark} / ${c.max_marks}${c.mark_source === 'ai' ? ' (AI suggestion)' : ''}`}`);
    if (regions.length === 0) continue;
    if (mark !== null) ops.push(...markStamp(regions[0], label, `${mark} / ${c.max_marks}${c.mark_source === 'ai' ? ' (AI)' : ''}`));
    if (c.changed_after_marking) {
      notes.push(`Question ${label}: the answer's pages were changed after it was marked, so its ticks are not drawn.`);
      continue;
    }
    const row = pickAnnotationRow(marks.filter((m) => m.clip_id === c.clip_id), script.mark_combine, script.lead_teacher_id);
    const stack = stackRegions(regions);
    for (const a of annotationsOf(row)) ops.push(...annotationOps(a, stack));
  }

  const redact = includeNames ? [] : [
    ...clips.flatMap((c) => c.name_zones ?? []),
    ...clips.flatMap((c) => c.clip_name_zones ?? []),
  ];
  // The question zones of questions this script has no clip for are also hidden
  if (!includeNames) {
    const more = await db('exam_questions').where({ exam_id: script.exam_id }).whereNotNull('name_zones').select<{ name_zones: Region[] }[]>('name_zones');
    redact.push(...more.flatMap((q) => q.name_zones));
  }

  const who = includeNames && script.student_name ? `Script ${script.student_number} (${script.student_name})` : `Script ${script.student_number}`;
  const cover = [
    `**${pdfSafeText(script.exam_name)}`,
    ...(script.class_group ? [`Class: ${pdfSafeText(script.class_group)}`] : []),
    '',
    `**Total: ${total} / ${possible}${ordered.some((c) => c.marks_awarded === null) ? '  (marked questions only)' : ''}`,
    '',
    ...lines.map(pdfSafeText),
    ...(notes.length ? ['', '**Notes', ...notes.map(pdfSafeText)] : []),
    '',
    'Ticks and marks are those of the mark that counts for each answer.',
  ];

  const { url: pdfUri, headers: pdfHeaders } = await scriptPdfSource(script.original_pdf_url, script.lead_teacher_id);
  const resp = await extractorFetch('/annotate-script', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pdf_uri: pdfUri, pdf_headers: pdfHeaders, ops, redact_zones: redact, cover_title: who, cover_lines: cover }),
  });
  if (!resp.ok) {
    let detail = '';
    try { detail = String(((await resp.json()) as { detail?: unknown }).detail ?? ''); } catch { /* not JSON */ }
    throw new ExportError(`The annotated PDF could not be made (${resp.status}${detail ? `: ${detail}` : ''})`);
  }
  const filename = `${safeFilePart(includeNames && script.student_name ? `${script.student_number} - ${script.student_name}` : `Script ${script.student_number}`)}.pdf`;
  return { bytes: Buffer.from(await resp.arrayBuffer()), filename, notes };
}

class ExportError extends Error {}

// The scripts that can be exported, for the "download all" run (the browser fetches them one at a time)
router.get('/exams/:id/annotated-scripts', ...staff, async (req, res, next) => {
  try {
    if (!(await requireExamMember(req, res, req.params.id, { leadOnly: true }))) return;
    const rows = await db('student_scripts as ss')
      .leftJoin('script_clips as sc', 'sc.script_id', 'ss.id')
      .where('ss.exam_id', req.params.id)
      .groupBy('ss.id')
      .orderBy('ss.student_number')
      .select<{ id: string; student_number: string; class_group: string | null; clips: string }[]>(
        'ss.id', 'ss.student_number', 'ss.class_group', db.raw('COUNT(sc.id) AS clips'));
    const exam = await db('exams').where({ id: req.params.id }).first<{ name: string }>('name');
    res.json({ data: { exam_name: exam?.name ?? 'Exam', scripts: rows.map((r) => ({ ...r, clips: Number(r.clips) })) } });
  } catch (err) { next(err); }
});

router.get('/scripts/:scriptId/annotated.pdf', ...staff, async (req, res, next) => {
  try {
    const script = await loadScript(req, res, req.params.scriptId);
    if (!script) return;
    const includeNames = req.query.names === '1';
    let out;
    try {
      out = await buildPdf(script, includeNames);
    } catch (err) {
      if (err instanceof ExportError) { res.status(502).json({ error: err.message, code: 'EXPORT_FAILED' }); return; }
      res.status(502).json({ error: `Could not reach the PDF maker: ${describeExtractorFailure(err)}`, code: 'EXTRACTOR_UNREACHABLE' }); return;
    }
    if (includeNames) await recordAudit(req, 'script.export_annotated_named', 'script', script.id, { exam_id: script.exam_id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(out.bytes);
  } catch (err) { next(err); }
});

export default router;
