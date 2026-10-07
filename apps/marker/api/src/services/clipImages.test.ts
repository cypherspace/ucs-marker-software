import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloadFile = vi.fn();
const read = vi.fn();
vi.mock('./drive.js', () => ({
  isDriveUri: (u: string) => u.startsWith('drive://'),
  fileIdFromUri: (u: string) => u.slice('drive://'.length),
  downloadFile: (...a: unknown[]) => downloadFile(...a),
}));
vi.mock('./storage.js', () => ({ storage: { read: (...a: unknown[]) => read(...a) } }));

import { getClipBytes } from './clipImages.js';

describe('getClipBytes', () => {
  beforeEach(() => { downloadFile.mockReset(); read.mockReset(); });

  it('reads Drive clips with the exam lead teacher\'s Drive access', async () => {
    downloadFile.mockResolvedValue(Buffer.from('drive'));
    const out = await getClipBytes('drive://abc123', 'lead-1');
    expect(downloadFile).toHaveBeenCalledWith('lead-1', 'abc123');
    expect(read).not.toHaveBeenCalled();
    expect(out.toString()).toBe('drive');
  });

  it('reads local and GCS clips through storage', async () => {
    read.mockResolvedValue(Buffer.from('local'));
    expect((await getClipBytes('gs://bucket/clips/a.png', 'lead-1')).toString()).toBe('local');
    expect(read).toHaveBeenCalledWith('gs://bucket/clips/a.png');
    expect(downloadFile).not.toHaveBeenCalled();
  });
});
