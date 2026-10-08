/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // Archived exams leave the main lists but keep all their data. NULL = active.
  pgm.addColumn('exams', {
    archived_at: { type: 'timestamptz' },
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropColumn('exams', 'archived_at');
};
