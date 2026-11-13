// "about 4 minutes" for a run of `calls` Gemini requests paced at `rpm` per minute (0 = not limited)
export function estimateRun(calls: number, rpm: number): string | null {
  if (rpm <= 0 || calls <= 1) return null;
  const minutes = Math.ceil(((calls - 1) * 60) / rpm / 60);
  if (minutes <= 1) return 'about a minute';
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `about ${hours} hours`;
}

export interface RunEstimate {
  requests: number;            // Gemini requests the run needs (several answers go in each)
  duration: string | null;     // "about 3 minutes"
  overDailyLimit: boolean;     // more requests than the key allows in a day
}

// What a run of `items` answers costs: answers are packed `batchSize` to a request, requests are paced at
// `rpm` a minute, and the key allows `rpd` requests a day (0 = not known)
export function describeRun(items: number, batchSize: number, rpm: number, rpd: number): RunEstimate {
  const requests = items <= 0 ? 0 : Math.ceil(items / Math.max(1, batchSize));
  return { requests, duration: estimateRun(requests, rpm), overDailyLimit: rpd > 0 && requests > rpd };
}
