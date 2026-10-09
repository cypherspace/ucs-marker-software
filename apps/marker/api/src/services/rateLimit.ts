// Spaces out calls to Gemini so a free-tier key (a handful of requests per minute) is not hit faster than
// it allows. Calls are queued in order and released one every 60/rpm seconds. When a paid key is in use,
// raise GEMINI_MAX_RPM (or set it to 0 for no pacing).
//
// The limit is per running API instance, which is enough while there is one marking run at a time.

export interface Pacer {
  // Resolves when it is this call's turn. Rejects with waitSeconds if the queue is longer than maxWaitMs.
  acquire(): Promise<void>;
}

export class QueueTooLong extends Error {
  constructor(public waitSeconds: number) { super(`Gemini queue is ${waitSeconds}s long`); }
}

export function createPacer(opts: {
  rpm: number;
  maxWaitMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Pacer {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gapMs = opts.rpm > 0 ? 60_000 / opts.rpm : 0;
  let nextSlot = 0;

  return {
    async acquire() {
      if (gapMs === 0) return;
      const slot = Math.max(now(), nextSlot);
      const wait = slot - now();
      if (wait > opts.maxWaitMs) throw new QueueTooLong(Math.ceil(wait / 1000));
      nextSlot = slot + gapMs;
      if (wait > 0) await sleep(wait);
    },
  };
}
