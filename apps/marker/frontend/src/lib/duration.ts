// "about 4 minutes" for a run of `calls` Gemini requests paced at `rpm` per minute (0 = not limited)
export function estimateRun(calls: number, rpm: number): string | null {
  if (rpm <= 0 || calls <= 1) return null;
  const minutes = Math.ceil(((calls - 1) * 60) / rpm / 60);
  if (minutes <= 1) return 'about a minute';
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `about ${hours} hours`;
}
