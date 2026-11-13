// Typing a number anywhere on the marking page sets the mark. Digits typed in quick succession build one number
// (1 then 0 within a moment is 10, if the question is worth that much); otherwise each digit replaces the last.

export const DIGIT_JOIN_MS = 900;

export interface DigitBuffer { text: string; at: number }

export function applyDigit(prev: DigitBuffer, digit: string, now: number, maxMarks: number): string {
  if (prev.text === '' || prev.text === '0' || now - prev.at > DIGIT_JOIN_MS) return digit;
  const joined = prev.text + digit;
  return Number(joined) <= maxMarks ? joined : digit;
}

// Should this key press set the mark? Not while typing in a field (the Marks box, a text note), with a shortcut key
// held, or while the Text tool is selected.
export function isMarkDigitKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: unknown }, tool: string): boolean {
  if (!/^[0-9]$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey || tool === 'text') return false;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = t?.tagName;
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable);
}
