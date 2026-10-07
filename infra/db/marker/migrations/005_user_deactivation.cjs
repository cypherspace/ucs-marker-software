/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // A deactivated user keeps their account, marks and exams but cannot sign in.
  pgm.addColumn('users', {
    disabled_at: { type: 'timestamptz', notNull: false },
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropColumn('users', 'disabled_at');
};
