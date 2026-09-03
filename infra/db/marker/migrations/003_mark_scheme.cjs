/* eslint-disable @typescript-eslint/no-var-requires */
// Mark scheme storage: one MS PDF per exam, one clipped MS image per question.

exports.up = (pgm) => {
  pgm.addColumn('exams', {
    mark_scheme_pdf_url: { type: 'text' },
  });
  pgm.addColumn('exam_questions', {
    // Clipped mark-scheme image for this question, rendered from the exam's MS PDF
    ms_clip_image_url: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('exam_questions', 'ms_clip_image_url');
  pgm.dropColumn('exams', 'mark_scheme_pdf_url');
};
