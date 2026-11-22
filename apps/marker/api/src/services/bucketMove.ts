import { createHash } from 'node:crypto';
import { db } from '../db.js';
import { storage } from './storage.js';
import {
  uploadFile, deleteFile, fileChecksum, downloadFile, isDriveUri, fileIdFromUri, DriveNotConnectedError,
} from './drive.js';
import { ensureExamFolder, type FolderExam } from './driveFolder.js';

// One-off tool: move student files that are still in the storage bucket into the lead teacher's Drive.
// Every file is checked after it is uploaded (Drive's own checksum is compared with the bytes we sent), the database is
// pointed at the Drive file only if it still holds the old value, and only then is the bucket copy deleted. Anything that
// goes wrong leaves the bucket file and the database exactly as they were.

export const MOVE_KINDS = ['mark_scheme_pdf', 'mark_scheme_clip', 'script_pdf', 'clip', 'converted'] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];
export interface MoveRef { kind: MoveKind; id: string }

export const KIND_LABEL: Record<MoveKind, string> = {
  mark_scheme_pdf: 'mark scheme PDF',
  mark_scheme_clip: 'mark scheme image',
  script_pdf: 'script PDF',
  clip: 'clip image',
  converted: 'converted-handwriting image',
};

export const refToId = (r: MoveRef): string => `${r.kind}:${r.id}`;

export function parseRef(s: string): MoveRef | null {
  const i = s.indexOf(':');
  if (i < 0) return null;
  const kind = s.slice(0, i) as MoveKind;
  const id = s.slice(i + 1);
  if (!MOVE_KINDS.includes(kind) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { kind, id };
}

/** What one stored file is: where its value lives, and what to call it in Drive (the same names new uploads get). */
export interface MoveItem {
  ref: MoveRef;
  examId: string;
  uri: string;
  table: string;
  column: string;
  filename: string;
  mime: string;
}

export interface MoveResult {
  id: string;
  ok: boolean;
  error?: string;
  code?: string;
  retryable?: boolean;
  fatal?: boolean;
  /** Moved, but something minor needs a look (the bucket copy could not be deleted) */
  warning?: string;
  /** Nothing to do: already in Drive, or the row has gone */
  skipped?: boolean;
}

/** Classify a failure so the browser knows whether to retry it, stop, or report it against the one file. */
export function classifyMoveError(err: unknown): Pick<MoveResult, 'error' | 'code' | 'retryable' | 'fatal'> {
  if (err instanceof DriveNotConnectedError || (err as { code?: string })?.code === 'DRIVE_NOT_CONNECTED') {
    return { error: (err as Error).message, code: 'DRIVE_NOT_CONNECTED', fatal: true };
  }
  const e = err as { code?: number | string; status?: number; message?: string; response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } } };
  const status = e?.response?.status ?? e?.status ?? (typeof e?.code === 'number' ? e.code : undefined);
  const reason = e?.response?.data?.error?.errors?.[0]?.reason ?? '';
  if (reason === 'storageQuotaExceeded' || /storage quota/i.test(e?.message ?? '')) {
    return { error: 'The lead teacher\'s Google Drive is full.', code: 'DRIVE_FULL', fatal: true };
  }
  if (status === 429 || (status !== undefined && status >= 500) || /rateLimit/i.test(reason) || /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(e?.message ?? '')) {
    return { error: 'Google Drive is busy or did not answer. Trying again.', code: 'DRIVE_BUSY', retryable: true };
  }
  return { error: `Could not move the file: ${(err as Error)?.message ?? 'unknown error'}`, code: 'MOVE_FAILED' };
}

export interface MoveDeps {
  storage: Pick<typeof storage, 'exists' | 'read' | 'delete'>;
  upload: (filename: string, data: Buffer, mime: string) => Promise<string>;
  checksum: (driveUri: string) => Promise<{ size: number | null; md5: string | null; trashed: boolean }>;
  download: (driveUri: string) => Promise<Buffer>;
  discard: (driveUri: string) => Promise<void>;
  /** Point the row at the Drive file only if it still holds `oldUri`. Returns the number of rows changed. */
  swap: (item: MoveItem, newUri: string) => Promise<number>;
  /** The value the row holds now (null if the row is gone) */
  current: (item: MoveItem) => Promise<string | null>;
}

const md5Of = (data: Buffer): string => createHash('md5').update(data).digest('hex');

/** Ask Drive what it stored and compare it with what we sent. */
export async function uploadIsGood(deps: MoveDeps, driveUri: string, data: Buffer): Promise<boolean> {
  const info = await deps.checksum(driveUri);
  if (info.trashed) return false;
  if (info.size !== null && info.size !== data.length) return false;
  if (info.md5) return info.md5.toLowerCase() === md5Of(data);
  // Drive gave no checksum: read the file back and compare the bytes
  const back = await deps.download(driveUri);
  return back.length === data.length && back.equals(data);
}

/** Move one file. Never throws: a problem comes back as a failed result. */
export async function moveOne(item: MoveItem, deps: MoveDeps): Promise<MoveResult> {
  const id = refToId(item.ref);
  let newUri: string | null = null;
  try {
    if (isDriveUri(item.uri)) return { id, ok: true, skipped: true };
    if (!(await deps.storage.exists(item.uri))) {
      return {
        id, ok: false, code: 'BUCKET_MISSING',
        error: 'The file is no longer in storage, so there is nothing to move. Re-clip it, or upload it again.',
      };
    }
    const data = await deps.storage.read(item.uri);
    if (data.length === 0) return { id, ok: false, code: 'EMPTY_FILE', error: 'The stored file is empty, so it was left alone.' };

    newUri = await deps.upload(item.filename, data, item.mime);
    if (!(await uploadIsGood(deps, newUri, data))) {
      await deps.discard(newUri);
      return { id, ok: false, code: 'VERIFY_FAILED', retryable: true, error: 'Google Drive did not keep an identical copy. The file in storage was left alone.' };
    }

    const changed = await deps.swap(item, newUri);
    if (changed === 0) {
      // Someone changed it while we were copying. If it is in Drive now there is nothing left to do.
      await deps.discard(newUri);
      newUri = null;
      const now = await deps.current(item);
      if (now === null || isDriveUri(now)) return { id, ok: true, skipped: true };
      return { id, ok: false, code: 'CHANGED', error: 'The file changed while it was being moved. Check again.' };
    }
    newUri = null;

    try {
      await deps.storage.delete(item.uri);
    } catch (err) {
      console.error('[move] Moved, but could not delete the storage copy', item.uri, (err as Error).message);
      return { id, ok: true, warning: 'Moved to Drive, but the copy in storage could not be deleted.' };
    }
    return { id, ok: true };
  } catch (err) {
    if (newUri) { try { await deps.discard(newUri); } catch { /* best effort */ } }
    return { id, ok: false, ...classifyMoveError(err) };
  }
}

// ── Database side ───────────────────────────────────────────────────────────

const NOT_DRIVE = (col: string): string => `${col} IS NOT NULL AND ${col} NOT LIKE 'drive://%'`;

export interface ExamMoveSummary {
  exam_id: string;
  name: string;
  status: string;
  archived: boolean;
  lead_teacher_id: string;
  lead_email: string | null;
  drive_connected: boolean;
  counts: Record<MoveKind, number>;
  total: number;
}

/** Per exam, how many files are still in the bucket (not Drive), by kind. Read-only. */
export async function summariseBucketFiles(): Promise<ExamMoveSummary[]> {
  const counts = (await db.raw(
    `SELECT exam_id, kind, COUNT(*)::int AS n FROM (
       SELECT id AS exam_id, 'mark_scheme_pdf' AS kind FROM exams WHERE ${NOT_DRIVE('mark_scheme_pdf_url')}
       UNION ALL SELECT exam_id, 'mark_scheme_clip' FROM exam_questions WHERE ${NOT_DRIVE('ms_clip_image_url')}
       UNION ALL SELECT exam_id, 'script_pdf' FROM student_scripts WHERE ${NOT_DRIVE('original_pdf_url')}
       UNION ALL SELECT s.exam_id, 'clip' FROM script_clips c JOIN student_scripts s ON s.id = c.script_id WHERE ${NOT_DRIVE('c.clip_image_url')}
       UNION ALL SELECT s.exam_id, 'converted' FROM script_clips c JOIN student_scripts s ON s.id = c.script_id WHERE ${NOT_DRIVE('c.text_image_url')}
     ) t GROUP BY exam_id, kind`,
  )).rows as { exam_id: string; kind: MoveKind; n: number }[];
  if (counts.length === 0) return [];

  const byExam = new Map<string, Record<MoveKind, number>>();
  for (const r of counts) {
    const c = byExam.get(r.exam_id) ?? { mark_scheme_pdf: 0, mark_scheme_clip: 0, script_pdf: 0, clip: 0, converted: 0 };
    c[r.kind] = r.n;
    byExam.set(r.exam_id, c);
  }
  const exams = await db('exams as e')
    .leftJoin('users as u', 'u.id', 'e.lead_teacher_id')
    .whereIn('e.id', [...byExam.keys()])
    .select('e.id', 'e.name', 'e.status', 'e.archived_at', 'e.lead_teacher_id',
      db.raw(`CASE WHEN u.hidden THEN 'Administrator' ELSE u.email END AS lead_email`),
      db.raw('(u.google_drive_refresh_token IS NOT NULL AND u.disabled_at IS NULL) AS drive_connected'))
    .orderBy('e.created_at', 'desc') as {
      id: string; name: string; status: string; archived_at: Date | null; lead_teacher_id: string;
      lead_email: string | null; drive_connected: boolean;
    }[];
  return exams.map((e) => {
    const c = byExam.get(e.id)!;
    return {
      exam_id: e.id, name: e.name, status: e.status, archived: !!e.archived_at,
      lead_teacher_id: e.lead_teacher_id, lead_email: e.lead_email, drive_connected: !!e.drive_connected,
      counts: c, total: Object.values(c).reduce((a, b) => a + b, 0),
    };
  });
}

/** Every file of one exam that is still in the bucket, as `kind:id` strings, in a sensible order. */
export async function listBucketFiles(examId: string): Promise<string[]> {
  const ids = async (sql: string): Promise<string[]> => ((await db.raw(sql, [examId])).rows as { id: string }[]).map((r) => r.id);
  const out: MoveRef[] = [];
  for (const id of await ids(`SELECT id FROM exams WHERE id = ? AND ${NOT_DRIVE('mark_scheme_pdf_url')}`)) out.push({ kind: 'mark_scheme_pdf', id });
  for (const id of await ids(`SELECT id FROM exam_questions WHERE exam_id = ? AND ${NOT_DRIVE('ms_clip_image_url')} ORDER BY id`)) out.push({ kind: 'mark_scheme_clip', id });
  for (const id of await ids(`SELECT id FROM student_scripts WHERE exam_id = ? AND ${NOT_DRIVE('original_pdf_url')} ORDER BY student_number`)) out.push({ kind: 'script_pdf', id });
  for (const id of await ids(`SELECT c.id FROM script_clips c JOIN student_scripts s ON s.id = c.script_id WHERE s.exam_id = ? AND ${NOT_DRIVE('c.clip_image_url')} ORDER BY c.id`)) out.push({ kind: 'clip', id });
  for (const id of await ids(`SELECT c.id FROM script_clips c JOIN student_scripts s ON s.id = c.script_id WHERE s.exam_id = ? AND ${NOT_DRIVE('c.text_image_url')} ORDER BY c.id`)) out.push({ kind: 'converted', id });
  return out.map(refToId);
}

/** Read the row a reference points at (null when it is gone). */
export async function loadItem(ref: MoveRef): Promise<MoveItem | null> {
  switch (ref.kind) {
    case 'mark_scheme_pdf': {
      const r = await db('exams').where({ id: ref.id }).select('id', 'mark_scheme_pdf_url').first<{ id: string; mark_scheme_pdf_url: string | null }>();
      if (!r?.mark_scheme_pdf_url) return null;
      return { ref, examId: r.id, uri: r.mark_scheme_pdf_url, table: 'exams', column: 'mark_scheme_pdf_url', filename: 'mark_scheme.pdf', mime: 'application/pdf' };
    }
    case 'mark_scheme_clip': {
      const r = await db('exam_questions').where({ id: ref.id }).select('id', 'exam_id', 'ms_clip_image_url').first<{ id: string; exam_id: string; ms_clip_image_url: string | null }>();
      if (!r?.ms_clip_image_url) return null;
      return { ref, examId: r.exam_id, uri: r.ms_clip_image_url, table: 'exam_questions', column: 'ms_clip_image_url', filename: `mark_scheme_${r.id}.png`, mime: 'image/png' };
    }
    case 'script_pdf': {
      const r = await db('student_scripts').where({ id: ref.id }).select('id', 'exam_id', 'student_number', 'original_pdf_url').first<{ id: string; exam_id: string; student_number: string; original_pdf_url: string | null }>();
      if (!r?.original_pdf_url) return null;
      return { ref, examId: r.exam_id, uri: r.original_pdf_url, table: 'student_scripts', column: 'original_pdf_url', filename: `${r.student_number}.pdf`, mime: 'application/pdf' };
    }
    case 'clip':
    case 'converted': {
      const col = ref.kind === 'clip' ? 'clip_image_url' : 'text_image_url';
      const r = await db('script_clips as c').join('student_scripts as s', 's.id', 'c.script_id').where('c.id', ref.id)
        .select('c.id', 'c.question_id', 'c.script_id', 's.exam_id', `c.${col} as uri`).first<{ id: string; question_id: string; script_id: string; exam_id: string; uri: string | null }>();
      if (!r?.uri) return null;
      const filename = ref.kind === 'clip' ? `clip_${r.question_id}_${r.script_id}.png` : `converted_${r.question_id}_${r.script_id}_${Date.now()}.png`;
      return { ref, examId: r.exam_id, uri: r.uri, table: 'script_clips', column: col, filename, mime: 'image/png' };
    }
  }
}

function realDeps(leadTeacherId: string, folderId: string): MoveDeps {
  return {
    storage,
    upload: (filename, data, mime) => uploadFile(leadTeacherId, folderId, filename, data, mime),
    checksum: (uri) => fileChecksum(leadTeacherId, fileIdFromUri(uri)),
    download: (uri) => downloadFile(leadTeacherId, fileIdFromUri(uri)),
    discard: (uri) => deleteFile(leadTeacherId, fileIdFromUri(uri)),
    swap: async (item, newUri) => db(item.table).where({ id: item.ref.id, [item.column]: item.uri }).update({ [item.column]: newUri }),
    current: async (item) => {
      const loaded = await loadItem(item.ref);
      return loaded ? loaded.uri : null;
    },
  };
}

/**
 * Move up to a few files of one exam. A Drive problem that affects everything (not connected, Drive full) comes back as a
 * fatal result for every file so the browser stops the run; the files stay queued and the run can be resumed.
 */
export async function moveFiles(examId: string, ids: string[]): Promise<MoveResult[]> {
  const exam = await db('exams').where({ id: examId }).select<FolderExam[]>('id', 'name', 'lead_teacher_id', 'drive_folder_id').first();
  const fail = (error: string, code: string, fatal = true, retryable = false): MoveResult[] => ids.map((id) => ({ id, ok: false, error, code, fatal, retryable }));
  if (!exam) return fail('That exam no longer exists.', 'NOT_FOUND');

  let folderId: string | null;
  try {
    folderId = await ensureExamFolder(exam);
  } catch (err) {
    const c = classifyMoveError(err);
    // The folder is needed for every file, so a problem with it affects them all: stop the run unless it is only busy
    return fail(c.error ?? 'Google Drive cannot be used for this exam.', c.code ?? 'DRIVE_ERROR', !c.retryable, !!c.retryable);
  }
  if (!folderId) return fail('Google Drive is not connected, so nothing can be moved.', 'DRIVE_NOT_CONNECTED');

  const deps = realDeps(exam.lead_teacher_id, folderId);
  const results: MoveResult[] = [];
  for (const raw of ids) {
    const ref = parseRef(raw);
    if (!ref) { results.push({ id: raw, ok: false, code: 'BAD_ID', error: 'Not a file reference.' }); continue; }
    const item = await loadItem(ref);
    if (!item) { results.push({ id: raw, ok: true, skipped: true }); continue; }
    if (item.examId !== exam.id) { results.push({ id: raw, ok: false, code: 'WRONG_EXAM', error: 'That file belongs to another exam.' }); continue; }
    const r = await moveOne(item, deps);
    results.push(r);
    if (r.fatal) {
      // Everything after this would fail the same way
      for (const rest of ids.slice(results.length)) results.push({ id: rest, ok: false, fatal: true, code: r.code, error: r.error });
      break;
    }
  }
  return results;
}
