import { describe, expect, it } from 'vitest';
import { HIDDEN_LABEL, shownEmail, shownName } from './hiddenStaff.js';

describe('hidden staff SQL', () => {
  it('replaces the email with a label for a hidden account, for any alias', () => {
    expect(shownEmail('u')).toBe(`CASE WHEN u.hidden THEN '${HIDDEN_LABEL}' ELSE u.email END`);
    expect(shownEmail('x')).toContain('x.hidden');
    expect(shownEmail('x')).toContain('x.email');
  });
  it('gives no name for a hidden account, so screens use the label', () => {
    expect(shownName('u')).toBe('CASE WHEN u.hidden THEN NULL ELSE u.name END');
  });
  it('the label has no @, so code that shows the part before the @ still shows the label whole', () => {
    expect(HIDDEN_LABEL.split('@')[0]).toBe(HIDDEN_LABEL);
  });
});
