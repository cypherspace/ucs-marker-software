/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // A tracing-paper overlay for a question: the correct graph or picture as drawn shapes, laid over a candidate's
  // answer while marking. Stored as vector shapes in the pixels of the clip it was drawn on (see OverlayData in
  // packages/shared-types). Null means the question has no overlay.
  pgm.addColumn('exam_questions', { overlay_data: { type: 'jsonb' } });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropColumn('exam_questions', 'overlay_data');
};
