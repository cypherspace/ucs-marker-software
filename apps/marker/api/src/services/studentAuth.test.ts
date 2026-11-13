import { describe, expect, it } from 'vitest';
import { isStudentEmail, safeNext } from './studentAuth.js';

describe('safeNext', () => {
  it('allows the practice pages and join links', () => {
    expect(safeNext('/practice')).toBe('/practice');
    expect(safeNext('/practice/abc-123/def')).toBe('/practice/abc-123/def');
    expect(safeNext('/join/Abcdefgh12345678')).toBe('/join/Abcdefgh12345678');
    expect(safeNext('/')).toBe('/');
  });
  it('refuses anything else', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/admin', '/exams/1', '/join/x', '/practice/../admin', '/practice?x=1', undefined, 5]) {
      expect(safeNext(bad)).toBeNull();
    }
  });
});

describe('isStudentEmail', () => {
  const domains = ['ucs.org.uk'];
  it('matches the school domain only', () => {
    expect(isStudentEmail('pupil@ucs.org.uk', domains)).toBe(true);
    expect(isStudentEmail('Pupil@UCS.org.uk', domains)).toBe(true);
    expect(isStudentEmail('pupil@gmail.com', domains)).toBe(false);
    expect(isStudentEmail('pupil@notucs.org.uk', domains)).toBe(false);
    expect(isStudentEmail('pupil@ucs.org.uk.evil.com', domains)).toBe(false);
    expect(isStudentEmail('nodomain', domains)).toBe(false);
  });
});
