import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(), read: vi.fn(), del: vi.fn(),
}));
vi.mock('./drive.js', () => ({ uploadFile: mocks.uploadFile }));
vi.mock('./storage.js', () => ({ storage: { read: mocks.read, delete: mocks.del } }));

import { clipTempKey, moveToDrive } from './driveCopy.js';

beforeEach(() => {
  mocks.uploadFile.mockReset(); mocks.read.mockReset(); mocks.del.mockReset();
  mocks.read.mockResolvedValue(Buffer.from('png'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('moveToDrive', () => {
  it('uploads to Drive, then deletes the temporary copy and returns the Drive URI', async () => {
    mocks.uploadFile.mockResolvedValue('drive://abc');
    const out = await moveToDrive('lead', 'folder', 'clip.png', 'gs://b/clips/q/s.png', 'image/png');
    expect(out).toBe('drive://abc');
    expect(mocks.uploadFile).toHaveBeenCalledWith('lead', 'folder', 'clip.png', Buffer.from('png'), 'image/png');
    expect(mocks.del).toHaveBeenCalledWith('gs://b/clips/q/s.png');
  });

  it('keeps the file where it is when the Drive upload fails', async () => {
    mocks.uploadFile.mockRejectedValue(new Error('quota'));
    const out = await moveToDrive('lead', 'folder', 'clip.png', 'gs://b/clips/q/s.png', 'image/png');
    expect(out).toBe('gs://b/clips/q/s.png');
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('still returns the Drive URI when only the clean-up fails', async () => {
    mocks.uploadFile.mockResolvedValue('drive://abc');
    mocks.del.mockRejectedValue(new Error('denied'));
    await expect(moveToDrive('lead', 'folder', 'clip.png', 'gs://b/x.png', 'image/png')).resolves.toBe('drive://abc');
  });

  it('never deletes before the upload has succeeded', async () => {
    const order: string[] = [];
    mocks.uploadFile.mockImplementation(async () => { order.push('upload'); return 'drive://abc'; });
    mocks.del.mockImplementation(async () => { order.push('delete'); });
    await moveToDrive('lead', 'folder', 'clip.png', 'gs://b/x.png', 'image/png');
    expect(order).toEqual(['upload', 'delete']);
  });
});

describe('clipTempKey', () => {
  it('matches the key the extractor writes', () => {
    expect(clipTempKey('Q', 'S')).toBe('clips/Q/S.png');
  });
});
