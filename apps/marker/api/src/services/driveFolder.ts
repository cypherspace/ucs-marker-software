import { db } from '../db.js';
import { config } from '../config.js';
import { createExamFolder, DriveNotConnectedError, folderState } from './drive.js';

export interface FolderExam {
  id: string;
  name: string;
  lead_teacher_id: string;
  drive_folder_id: string | null;
}

// A folder checked a moment ago is not checked again: a class upload or a clip run calls this many times.
const VERIFIED_FOR_MS = 5 * 60 * 1000;
const verified = new Map<string, { folderId: string; until: number }>();

/** Forget what was checked (tests, and after a folder id changes). */
export function resetFolderCache(): void { verified.clear(); }

/** A new folder for an exam that does not exist yet (null only with DRIVE_OPTIONAL=1 and no Drive connection). */
export async function newExamFolder(leadTeacherId: string, examName: string): Promise<string | null> {
  try {
    return await createExamFolder(leadTeacherId, examName);
  } catch (err) {
    if (err instanceof DriveNotConnectedError && config.driveOptional) {
      console.warn('[drive] Not connected; DRIVE_OPTIONAL is on, keeping files in local storage');
      return null;
    }
    throw err;
  }
}

/**
 * The exam's Drive folder in its lead teacher's Drive: the one place every path asks for it.
 * Creates the folder if the exam has none, or if the stored one was deleted or put in the bin, and saves its id.
 * Throws DriveNotConnectedError (HTTP 409) when Drive cannot be used, so nothing is ever quietly kept in the bucket.
 * Returns null only in local development with DRIVE_OPTIONAL=1 and no Drive connection.
 */
export async function ensureExamFolder(exam: FolderExam): Promise<string | null> {
  const hit = verified.get(exam.id);
  if (hit && hit.until > Date.now() && (!exam.drive_folder_id || exam.drive_folder_id === hit.folderId)) return hit.folderId;
  try {
    let folderId = exam.drive_folder_id;
    if (folderId) {
      const state = await folderState(exam.lead_teacher_id, folderId);
      if (state !== 'ok') folderId = null;
    }
    if (!folderId) {
      folderId = await createExamFolder(exam.lead_teacher_id, exam.name);
      await db('exams').where({ id: exam.id }).update({ drive_folder_id: folderId });
      exam.drive_folder_id = folderId;
    }
    verified.set(exam.id, { folderId, until: Date.now() + VERIFIED_FOR_MS });
    return folderId;
  } catch (err) {
    if (err instanceof DriveNotConnectedError && config.driveOptional) {
      console.warn('[drive] Not connected; DRIVE_OPTIONAL is on, keeping files in local storage');
      return null;
    }
    throw err;
  }
}
