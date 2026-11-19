import { uploadFile, updateFile, deleteFile, fileIdFromUri, isDriveUri } from './drive.js';
import { storage } from './storage.js';

// Where the extractor writes a clip image before the API moves it: the same key every time for a script and question,
// so a re-clip overwrites it (see clips/ in services/extractor/app.py).
export const clipTempKey = (questionId: string, scriptId: string): string => `clips/${questionId}/${scriptId}.png`;

// Move a freshly made file into the lead teacher's Drive and remove the temporary copy from the bucket, so student
// work is kept only in Drive. If the Drive upload fails this THROWS (the temporary file is left where it is, so a
// retry can use it; nothing is quietly kept in the bucket). If only the clean-up fails, the Drive copy is used and the
// leftover is logged. With `replaceUri` (the file's previous `drive://` value) the Drive file is updated in place, so a
// re-made file does not leave the old one behind.
export async function moveToDrive(
  leadTeacherId: string, folderId: string, filename: string, tempUri: string, mimeType: string,
  replaceUri?: string | null,
): Promise<string> {
  const data = await storage.read(tempUri);
  let driveUri: string;
  if (replaceUri && isDriveUri(replaceUri)) {
    try {
      await updateFile(leadTeacherId, fileIdFromUri(replaceUri), data, mimeType);
      driveUri = replaceUri;
    } catch (err) {
      // The old file may be gone or no longer visible to the app: make a new one
      if ((err as { code?: string }).code === 'DRIVE_NOT_CONNECTED') throw err;
      driveUri = await uploadFile(leadTeacherId, folderId, filename, data, mimeType);
    }
  } else {
    driveUri = await uploadFile(leadTeacherId, folderId, filename, data, mimeType);
  }
  try {
    await storage.delete(tempUri);
  } catch (err) {
    console.error('[drive] Could not remove the temporary copy', tempUri, (err as Error).message);
  }
  return driveUri;
}

/** Best effort: bin a stored file that is no longer used (a Drive file, or a bucket/local one). Never throws. */
export async function discardStored(leadTeacherId: string, uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  try {
    if (isDriveUri(uri)) await deleteFile(leadTeacherId, fileIdFromUri(uri));
    else await storage.delete(uri);
  } catch (err) {
    console.error('[drive] Could not remove an unused file', uri, (err as Error).message);
  }
}
