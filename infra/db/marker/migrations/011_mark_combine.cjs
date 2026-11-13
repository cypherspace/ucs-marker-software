/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // Several teachers can mark the same clip and each mark is stored on its own. This says how they are combined
  // into the one mark used in results and exports: 'latest' (the newest teacher mark, how it has always worked),
  // 'average' (mean of the teachers' marks, rounded half up) or 'lead' (the lead teacher's mark, else the average).
  pgm.addColumn('exams', {
    mark_combine: { type: 'text', notNull: true, default: 'latest' },
  });
  pgm.addConstraint('exams', 'exams_mark_combine_check', {
    check: "mark_combine IN ('latest','average','lead')",
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropConstraint('exams', 'exams_mark_combine_check');
  pgm.dropColumn('exams', 'mark_combine');
};
