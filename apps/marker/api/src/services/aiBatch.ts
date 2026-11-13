// Helpers for sending several answers to Gemini in one request.
//
// The free tier allows very few requests per day but many tokens, so AI marking and judging put a batch of
// answers into each request and ask for one JSON result per answer, numbered 1..N in the order they were sent.

// Match the numbered results in a reply to the N items that were sent.
// Gemini sometimes drops, repeats or renumbers an item; those items come back as null and are retried by the
// caller, instead of one bad item spoiling the others.
export function matchNumbered<T extends { n: number }>(count: number, results: T[]): (T | null)[] {
  const out: (T | null)[] = Array.from({ length: count }, () => null);
  for (const r of results) {
    const i = Math.round(r.n) - 1;
    if (i >= 0 && i < count && out[i] === null) out[i] = r;
  }
  // A reply with exactly one result per item but numbered oddly is read in order
  if (out.every((x) => x === null) && results.length === count) return [...results];
  return out;
}

// Split a list into batches of at most `size`
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(items.slice(i, i + Math.max(1, size)));
  return out;
}

// How many Gemini requests a run of `items` will take
export const requestsFor = (items: number, batchSize: number): number => (items <= 0 ? 0 : Math.ceil(items / Math.max(1, batchSize)));
