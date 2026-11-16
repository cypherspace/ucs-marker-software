import { uploadFile } from './drive.js';
import { storage } from './storage.js';

// Where the extractor writes a clip image before the API moves it: the same key every time for a script and question,
// so a re-clip overwrites it (see clips/ in services/extractor/app.py).
export const clipTempKey = (questionId: string, scriptId: string): string => `clips/${questionId}/${scriptId}.png`;

// Move a freshly made file into the lead teacher's Drive and remove the temporary copy from the bucket, so a Drive exam
// keeps its student work only in Drive. If the Drive upload fails the file stays where it is and its URI is returned,
// so nothing is lost; if only the clean-up fails, the Drive copy is still used and the leftover is logged.
export async function moveToDrive(
  leadTeacherId: string, folderId: string, filename: string, tempUri: string, mimeType: string,
): Promise<string> {
  let driveUri: string;
  try {
    driveUri = await uploadFile(leadTeacherId, folderId, filename, await storage.read(tempUri), mimeType);
  } catch (err) {
    console.error('[drive] Upload failed, keeping the file in storage:', (err as Error).message);
    return tempUri;
  }
  try {
    await storage.delete(tempUri);
  } catch (err) {
    console.error('[drive] Could not remove the temporary copy', tempUri, (err as Error).message);
  }
  return driveUri;
}
