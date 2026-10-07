import { storage } from './storage.js';
import { downloadFile, fileIdFromUri, isDriveUri } from './drive.js';

// Clips live in local storage, GCS or the lead teacher's Drive (drive:// URIs).
export async function getClipBytes(uri: string, leadTeacherId: string): Promise<Buffer> {
  if (isDriveUri(uri)) return downloadFile(leadTeacherId, fileIdFromUri(uri));
  return storage.read(uri);
}
