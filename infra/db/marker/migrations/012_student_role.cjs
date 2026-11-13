/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // Students sign in with a school account and can only reach the practice-marking pages. The role is kept apart
  // from 'teacher' so nothing a teacher can do is open to them by accident.
  pgm.addTypeValue('user_role', 'student', { ifNotExists: true });
};

// A value cannot be removed from a Postgres enum, so there is nothing to undo.
exports.down = () => {};
