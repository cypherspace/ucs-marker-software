import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({ db: {} }));
vi.mock('./storage.js', () => ({ storage: {} }));
vi.mock('./drive.js', () => ({
  uploadFile: vi.fn(), deleteFile: vi.fn(), fileChecksum: vi.fn(), downloadFile: vi.fn(),
  isDriveUri: (u: string) => u.startsWith('drive://'), fileIdFromUri: (u: string) => u.slice(8),
  DriveNotConnectedError: class extends Error { readonly code = 'DRIVE_NOT_CONNECTED'; },
}));
vi.mock('./driveFolder.js', () => ({ ensureExamFolder: vi.fn() }));

import { classifyMoveError, moveOne, parseRef, refToId, uploadIsGood, type MoveDeps, type MoveItem } from './bucketMove.js';

const ID = '11111111-1111-1111-1111-111111111111';
const bytes = Buffer.from('%PDF-1.4 some pages');
const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
const item = (uri = 'gs://bucket/scripts/e/001.pdf'): MoveItem => ({
  ref: { kind: 'script_pdf', id: ID }, examId: 'e', uri, table: 'student_scripts', column: 'original_pdf_url', filename: '001.pdf', mime: 'application/pdf',
});

function deps(over: Partial<MoveDeps> = {}): MoveDeps & { calls: string[] } {
  const calls: string[] = [];
  const d: MoveDeps = {
    storage: {
      exists: vi.fn(async () => true), read: vi.fn(async () => bytes),
      delete: vi.fn(async () => { calls.push('delete-bucket'); }),
    },
    upload: vi.fn(async () => { calls.push('upload'); return 'drive://new1'; }),
    checksum: vi.fn(async () => ({ size: bytes.length, md5: md5(bytes), trashed: false })),
    download: vi.fn(async () => bytes),
    discard: vi.fn(async () => { calls.push('discard-drive'); }),
    swap: vi.fn(async () => { calls.push('swap'); return 1; }),
    current: vi.fn(async () => 'gs://bucket/scripts/e/001.pdf'),
    ...over,
  };
  return Object.assign(d, { calls });
}

describe('parseRef / refToId', () => {
  it('round-trips and rejects anything else', () => {
    const ref = { kind: 'clip' as const, id: ID };
    expect(parseRef(refToId(ref))).toEqual(ref);
    expect(parseRef('nonsense')).toBeNull();
    expect(parseRef(`other:${ID}`)).toBeNull();
    expect(parseRef('clip:not-a-uuid')).toBeNull();
  });
});

describe('uploadIsGood', () => {
  it('compares Drive\'s own checksum with our bytes', async () => {
    expect(await uploadIsGood(deps(), 'drive://x', bytes)).toBe(true);
    expect(await uploadIsGood(deps({ checksum: async () => ({ size: bytes.length, md5: 'deadbeef', trashed: false }) }), 'drive://x', bytes)).toBe(false);
    expect(await uploadIsGood(deps({ checksum: async () => ({ size: 3, md5: md5(bytes), trashed: false }) }), 'drive://x', bytes)).toBe(false);
    expect(await uploadIsGood(deps({ checksum: async () => ({ size: bytes.length, md5: md5(bytes), trashed: true }) }), 'drive://x', bytes)).toBe(false);
  });
  it('reads the file back when Drive gives no checksum', async () => {
    const d = deps({ checksum: async () => ({ size: null, md5: null, trashed: false }) });
    expect(await uploadIsGood(d, 'drive://x', bytes)).toBe(true);
    const bad = deps({ checksum: async () => ({ size: null, md5: null, trashed: false }), download: async () => Buffer.from('other') });
    expect(await uploadIsGood(bad, 'drive://x', bytes)).toBe(false);
  });
});

describe('moveOne', () => {
  it('uploads, checks, points the row at Drive, and only then deletes the bucket copy', async () => {
    const d = deps();
    const r = await moveOne(item(), d);
    expect(r).toEqual({ id: `script_pdf:${ID}`, ok: true });
    expect(d.calls).toEqual(['upload', 'swap', 'delete-bucket']);
    expect(d.upload).toHaveBeenCalledWith('001.pdf', bytes, 'application/pdf');
  });

  it('leaves everything alone when the Drive copy does not match', async () => {
    const d = deps({ checksum: async () => ({ size: bytes.length, md5: 'bad', trashed: false }) });
    const r = await moveOne(item(), d);
    expect(r).toMatchObject({ ok: false, code: 'VERIFY_FAILED', retryable: true });
    expect(d.calls).toEqual(['upload', 'discard-drive']);   // no swap, no bucket delete
  });

  it('reports a file that is missing from the bucket and changes nothing', async () => {
    const d = deps({ storage: { exists: async () => false, read: vi.fn(), delete: vi.fn() } });
    expect(await moveOne(item(), d)).toMatchObject({ ok: false, code: 'BUCKET_MISSING' });
    expect(d.upload).not.toHaveBeenCalled();
  });

  it('does not upload an empty file', async () => {
    const d = deps({ storage: { exists: async () => true, read: async () => Buffer.alloc(0), delete: vi.fn() } });
    expect(await moveOne(item(), d)).toMatchObject({ ok: false, code: 'EMPTY_FILE' });
    expect(d.upload).not.toHaveBeenCalled();
  });

  it('skips a file that is already in Drive', async () => {
    const d = deps();
    expect(await moveOne(item('drive://abc'), d)).toMatchObject({ ok: true, skipped: true });
    expect(d.upload).not.toHaveBeenCalled();
  });

  it('removes the new Drive file and keeps the bucket copy when the row changed meanwhile', async () => {
    const d = deps({ swap: vi.fn(async () => 0), current: async () => 'gs://bucket/other.pdf' });
    expect(await moveOne(item(), d)).toMatchObject({ ok: false, code: 'CHANGED' });
    expect(d.discard).toHaveBeenCalledWith('drive://new1');
    expect(d.storage.delete).not.toHaveBeenCalled();
  });

  it('treats "already moved by someone else" as done', async () => {
    const d = deps({ swap: vi.fn(async () => 0), current: async () => 'drive://elsewhere' });
    expect(await moveOne(item(), d)).toMatchObject({ ok: true, skipped: true });
    expect(d.storage.delete).not.toHaveBeenCalled();
  });

  it('still counts as moved, with a warning, when the bucket copy cannot be deleted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ storage: { exists: async () => true, read: async () => bytes, delete: async () => { throw new Error('denied'); } } });
    expect(await moveOne(item(), d)).toMatchObject({ ok: true, warning: expect.stringContaining('could not be deleted') });
  });

  it('cleans up the Drive file and reports a retryable problem when Drive is busy after the upload', async () => {
    const d = deps({ checksum: async () => { throw Object.assign(new Error('x'), { response: { status: 503 } }); } });
    expect(await moveOne(item(), d)).toMatchObject({ ok: false, retryable: true, code: 'DRIVE_BUSY' });
    expect(d.discard).toHaveBeenCalledWith('drive://new1');
    expect(d.storage.delete).not.toHaveBeenCalled();
  });
});

describe('classifyMoveError', () => {
  it('stops the run when Drive is not connected or full', () => {
    expect(classifyMoveError(Object.assign(new Error('gone'), { code: 'DRIVE_NOT_CONNECTED' }))).toMatchObject({ fatal: true, code: 'DRIVE_NOT_CONNECTED' });
    expect(classifyMoveError({ response: { status: 403, data: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } } } })).toMatchObject({ fatal: true, code: 'DRIVE_FULL' });
  });
  it('retries rate limits and server errors, and reports anything else against the one file', () => {
    expect(classifyMoveError({ response: { status: 429 } })).toMatchObject({ retryable: true });
    expect(classifyMoveError({ response: { status: 500 } })).toMatchObject({ retryable: true });
    expect(classifyMoveError(new Error('boom'))).toMatchObject({ code: 'MOVE_FAILED' });
    expect(classifyMoveError(new Error('boom')).retryable).toBeUndefined();
  });
});
