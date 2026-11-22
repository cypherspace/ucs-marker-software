/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // A staff account that is kept out of every list other people see (the teacher picker, assignments, progress, the
  // admin lists), and shown as "Administrator" wherever its name or email would appear beside marks. Set by hand:
  //   UPDATE users SET hidden = true WHERE email = '...';
  pgm.addColumn('users', { hidden: { type: 'boolean', notNull: true, default: false } });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropColumn('users', 'hidden');
};
