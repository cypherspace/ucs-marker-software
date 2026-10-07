import { storage } from './storage.js';
import { isDriveUri, fileIdFromUri, getDriveMediaRequest } from './drive.js';

export interface PdfSource {
  url: string;
  headers?: Record<string, string>;
}

// How the extractor should fetch a stored script PDF: Drive files need the lead teacher's token.
export async function scriptPdfSource(originalPdfUrl: string, leadTeacherId: string): Promise<PdfSource> {
  if (isDriveUri(originalPdfUrl)) return getDriveMediaRequest(leadTeacherId, fileIdFromUri(originalPdfUrl));
  return { url: storage.rawUri(originalPdfUrl) };
}
