/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // Store encrypted Google Drive OAuth refresh token per user
  pgm.addColumn('users', {
    google_drive_refresh_token: { type: 'text', notNull: false },
  });

  // Per-exam Drive storage opt-out + folder reference
  pgm.addColumn('exams', {
    use_drive_storage: { type: 'boolean', notNull: true, default: true },
    drive_folder_id: { type: 'text', notNull: false },
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropColumn('exams', 'drive_folder_id');
  pgm.dropColumn('exams', 'use_drive_storage');
  pgm.dropColumn('users', 'google_drive_refresh_token');
};
