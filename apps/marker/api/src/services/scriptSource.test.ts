import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDriveMediaRequest = vi.fn();
vi.mock('./drive.js', () => ({
  isDriveUri: (u: string) => u.startsWith('drive://'),
  fileIdFromUri: (u: string) => u.slice('drive://'.length),
  getDriveMediaRequest: (...a: unknown[]) => getDriveMediaRequest(...a),
}));
vi.mock('./storage.js', () => ({ storage: { rawUri: (u: string) => u } }));

import { scriptPdfSource } from './scriptSource.js';

// The same helper now serves mark scheme PDFs (render and clip), so both storage kinds must work.
describe('scriptPdfSource', () => {
  beforeEach(() => getDriveMediaRequest.mockReset());

  it('gives a Drive PDF a clean URL plus the lead teacher\'s Authorization header', async () => {
    getDriveMediaRequest.mockResolvedValue({ url: 'https://www.googleapis.com/drive/v3/files/f1?alt=media', headers: { Authorization: 'Bearer t' } });
    const src = await scriptPdfSource('drive://f1', 'lead-1');
    expect(getDriveMediaRequest).toHaveBeenCalledWith('lead-1', 'f1');
    expect(src.headers).toEqual({ Authorization: 'Bearer t' });
    expect(src.url).not.toContain('Bearer');
  });

  it('gives a bucket PDF as is, with no headers', async () => {
    const src = await scriptPdfSource('gs://bucket/mark-schemes/e1.pdf', 'lead-1');
    expect(src).toEqual({ url: 'gs://bucket/mark-schemes/e1.pdf' });
    expect(getDriveMediaRequest).not.toHaveBeenCalled();
  });
});
