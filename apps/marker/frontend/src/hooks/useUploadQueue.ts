import { useCallback, useRef, useState } from 'react';
import { HttpError } from '../api';
import { downloadDriveFile, type DriveRef } from '../components/DrivePicker';

// Cloud Run rejects request bodies over 32 MB; leave a little room for the form envelope.
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024 - 128 * 1024;

export type QueueStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface QueueItem {
  key: string;
  name: string;
  size: number | null;
  file?: File;
  drive?: DriveRef;
  status: QueueStatus;
  error?: string;
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const byName = (a: QueueItem, b: QueueItem) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

function tooLarge(name: string, size: number): string {
  return `${name} is ${mb(size)}, over the 32 MB upload limit. Reduce the scan size or split the PDF.`;
}

function friendly(err: unknown, name: string, size: number | null): string {
  if (err instanceof HttpError && err.status === 413) return tooLarge(name, size ?? MAX_UPLOAD_BYTES);
  if (err instanceof TypeError) return 'Network problem. Check your connection and retry.';
  return (err as Error).message || 'Upload failed';
}

// Uploads picked files one request at a time (so one big or failing file never
// takes the rest down), in name order so student numbers are predictable.
// Drive files are downloaded just before their own upload.
export function useUploadQueue(
  uploadOne: (file: File) => Promise<unknown>,
  opts: { single?: boolean; onDone?: () => void } = {},
) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [runTotal, setRunTotal] = useState(0);
  const [runDone, setRunDone] = useState(0);
  const itemsRef = useRef<QueueItem[]>([]);
  const uploadRef = useRef(uploadOne);
  uploadRef.current = uploadOne;
  const onDoneRef = useRef(opts.onDone);
  onDoneRef.current = opts.onDone;

  const commit = useCallback((next: QueueItem[]) => { itemsRef.current = next; setItems(next); }, []);
  const patch = useCallback((key: string, change: Partial<QueueItem>) => {
    commit(itemsRef.current.map((i) => (i.key === key ? { ...i, ...change } : i)));
  }, [commit]);

  const add = useCallback((incoming: QueueItem[]) => {
    const base = opts.single ? [] : itemsRef.current;
    const known = new Set(base.map((i) => i.key));
    const fresh = (opts.single ? incoming.slice(0, 1) : incoming).filter((i) => !known.has(i.key));
    const finished = base.filter((i) => i.status === 'done');
    const waiting = [...base.filter((i) => i.status !== 'done'), ...fresh].sort(byName);
    commit([...finished, ...waiting]);
  }, [commit, opts.single]);

  const addFiles = useCallback((files: File[]) => {
    add(files.map((f) => ({ key: `file:${f.name}:${f.size}:${f.lastModified}`, name: f.name, size: f.size, file: f, status: 'pending' as const })));
  }, [add]);

  const addDrive = useCallback((refs: DriveRef[]) => {
    add(refs.map((r) => ({ key: `drive:${r.id}`, name: r.name, size: r.size, drive: r, status: 'pending' as const })));
  }, [add]);

  const remove = useCallback((key: string) => {
    commit(itemsRef.current.filter((i) => i.key !== key || i.status === 'uploading'));
  }, [commit]);

  const clearDone = useCallback(() => commit(itemsRef.current.filter((i) => i.status !== 'done')), [commit]);

  const run = useCallback(async () => {
    const keys = itemsRef.current.filter((i) => i.status === 'pending' || i.status === 'error').map((i) => i.key);
    if (keys.length === 0) return;
    setRunning(true);
    setRunTotal(keys.length);
    setRunDone(0);
    let anyDone = false;
    for (const key of keys) {
      const item = itemsRef.current.find((i) => i.key === key);
      if (!item) continue;
      patch(key, { status: 'uploading', error: undefined });
      try {
        if (item.size !== null && item.size > MAX_UPLOAD_BYTES) throw new Error(tooLarge(item.name, item.size));
        const file = item.file ?? await downloadDriveFile(item.drive!);
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(tooLarge(item.name, file.size));
        await uploadRef.current(file);
        patch(key, { status: 'done' });
        anyDone = true;
      } catch (err) {
        patch(key, { status: 'error', error: friendly(err, item.name, item.size) });
      }
      setRunDone((n) => n + 1);
    }
    setRunning(false);
    if (anyDone) onDoneRef.current?.();
  }, [patch]);

  return { items, running, runTotal, runDone, addFiles, addDrive, remove, clearDone, run };
}

export type UploadQueue = ReturnType<typeof useUploadQueue>;
