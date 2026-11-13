// Small pure helpers for student sign-in (kept apart so they can be tested without Google).

// Where a student may be sent after signing in: only our own practice pages, never an arbitrary address
export function safeNext(raw: unknown): string | null {
  return typeof raw === 'string' && /^\/(join\/[\w-]{8,80}|practice(\/[\w-]{1,80}){0,3})?$/.test(raw) ? raw : null;
}

// Is this address on one of the school's student domains?
export function isStudentEmail(email: string, domains: readonly string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  return domains.includes(email.slice(at + 1).toLowerCase());
}
