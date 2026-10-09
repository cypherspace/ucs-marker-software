import { createHash } from 'node:crypto';
import { db } from '../db.js';
import { storage } from './storage.js';
import { uploadFile } from './drive.js';
import { describeExtractorFailure, extractorFetch } from './extractor.js';

// Converted handwriting: the transcription of a clip (script_clips.ocr_text) rendered once as a page
// image and stored beside the clip image. Teachers annotate that image, so it must never be
// re-rendered differently: it is kept until the clip itself changes.

/** Same-origin URL of a clip's converted page; the v= value changes whenever the stored image does. */
export function convertedUrl(clipId: string, uri: string | null | undefined): string | null {
  if (!uri) return null;
  const v = createHash('sha1').update(uri).digest('hex').slice(0, 10);
  return `/api/v1/clips/${clipId}/text-image?v=${v}`;
}

export type RenderResult = { png: Buffer } | { fail: { status: number; error: string; code: string } };

/** Ask the extractor to typeset the text as a page image. */
export async function renderConvertedPage(text: string): Promise<RenderResult> {
  let resp: Response;
  try {
    resp = await extractorFetch('/render-text', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    return { fail: { status: 502, error: `Could not reach the rendering service: ${describeExtractorFailure(err)}`, code: 'EXTRACTOR_UNREACHABLE' } };
  }
  if (!resp.ok) {
    console.error(`render-text failed (${resp.status}):`, await resp.text());
    return { fail: { status: 502, error: `Rendering the converted text failed (service returned ${resp.status})`, code: 'RENDER_ERROR' } };
  }
  return { png: Buffer.from(await resp.arrayBuffer()) };
}

interface ClipPlace {
  clipId: string;
  questionId: string;
  scriptId: string;
  leadTeacherId: string;
  examId: string;
}

/** Store the page image where the clip images live: the exam's Drive folder for Drive exams, else the bucket. */
export async function saveConvertedImage(place: ClipPlace, png: Buffer): Promise<string> {
  const exam = await db('exams').where({ id: place.examId })
    .first<{ use_drive_storage: boolean; drive_folder_id: string | null }>('use_drive_storage', 'drive_folder_id');
  const stamp = Date.now();
  if (exam?.use_drive_storage && exam.drive_folder_id) {
    try {
      return await uploadFile(place.leadTeacherId, exam.drive_folder_id, `converted_${place.questionId}_${place.scriptId}_${stamp}.png`, png, 'image/png');
    } catch (err) {
      console.error('[drive] Converted-page upload failed, keeping it in storage:', (err as Error).message);
    }
  }
  return storage.write(`text-clips/${place.questionId}/${place.scriptId}-${stamp}.png`, png);
}

/**
 * Remove the converted-layer annotations from every mark on the given clips. Run when a conversion
 * is discarded (Convert again, or the clip image changed), because those annotations sit at
 * positions on a page that no longer exists.
 */
export async function stripTextLayer(clipIds: string[]): Promise<void> {
  if (!clipIds.length) return;
  await db.raw(
    `UPDATE script_marks
        SET annotation_data = jsonb_set(
              annotation_data, '{annotations}',
              COALESCE((SELECT jsonb_agg(a)
                          FROM jsonb_array_elements(annotation_data->'annotations') a
                         WHERE COALESCE(a->>'layer', 'clip') <> 'text'), '[]'::jsonb))
      WHERE clip_id IN (${clipIds.map(() => '?').join(', ')})
        AND annotation_data IS NOT NULL
        AND jsonb_typeof(annotation_data->'annotations') = 'array'`,
    clipIds,
  );
}
