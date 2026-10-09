import { describe, expect, it } from 'vitest';
import { createPacer, QueueTooLong } from './rateLimit.js';

function fakeClock() {
  let t = 1_000_000;
  const waits: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { waits.push(ms); t += ms; }, waits };
}

describe('createPacer', () => {
  it('lets the first call straight through and spaces the rest by 60/rpm seconds', async () => {
    const c = fakeClock();
    const p = createPacer({ rpm: 6, maxWaitMs: 120_000, ...c });
    await p.acquire(); await p.acquire(); await p.acquire();
    expect(c.waits).toEqual([10_000, 10_000]);
  });

  it('queues calls made at the same moment, and refuses once the queue is longer than the cap', async () => {
    const t = 5_000;
    const waits: number[] = [];
    // The clock never moves, so every call joins the back of the queue
    const p = createPacer({ rpm: 6, maxWaitMs: 15_000, now: () => t, sleep: async (ms) => { waits.push(ms); } });
    await p.acquire(); // now
    await p.acquire(); // +10s
    expect(waits).toEqual([10_000]);
    await expect(p.acquire()).rejects.toMatchObject({ waitSeconds: 20 }); // +20s is past the 15s cap
    await expect(p.acquire()).rejects.toBeInstanceOf(QueueTooLong);
  });

  it('does nothing when rpm is 0', async () => {
    const c = fakeClock();
    const p = createPacer({ rpm: 0, maxWaitMs: 0, ...c });
    for (let i = 0; i < 50; i++) await p.acquire();
    expect(c.waits).toEqual([]);
  });
});
