import { describe, expect, it } from 'vitest';
import { pdfProblem } from './pdfCheck.js';

describe('pdfProblem', () => {
  it('accepts a PDF', () => {
    expect(pdfProblem({ originalname: 'a.pdf', buffer: Buffer.from('%PDF-1.7\n...') })).toBeNull();
  });
  it('accepts a PDF with a few bytes before the header', () => {
    expect(pdfProblem({ originalname: 'a.pdf', buffer: Buffer.from('\n\n%PDF-1.4') })).toBeNull();
  });
  it('refuses an empty file and says where it may have come from', () => {
    const msg = pdfProblem({ originalname: 'ms.pdf', buffer: Buffer.alloc(0) });
    expect(msg).toContain('"ms.pdf" is empty');
    expect(msg).toContain('Google Drive');
  });
  it('refuses a file that is not a PDF', () => {
    expect(pdfProblem({ originalname: 'x.pdf', buffer: Buffer.from('<html>Sign in</html>') })).toContain('not a PDF');
  });
});
