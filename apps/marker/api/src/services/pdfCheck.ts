// An upload must be a real PDF: an empty or damaged file (for example from a Drive download that failed quietly)
// would otherwise be stored and only fail later, when a page is first shown.
export function pdfProblem(file: { originalname: string; buffer?: Buffer }): string | null {
  if (!file.buffer || file.buffer.length === 0) {
    return `"${file.originalname}" is empty (0 bytes). If it came from Google Drive, download it again or upload it from your computer.`;
  }
  if (!file.buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) return `"${file.originalname}" is not a PDF file.`;
  return null;
}
