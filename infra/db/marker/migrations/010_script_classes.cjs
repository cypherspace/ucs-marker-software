/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // Scripts are uploaded per class: the uploading teacher types a class name, and each script
  // remembers it and who uploaded it. Both NULL for scripts uploaded before this existed.
  pgm.addColumns('student_scripts', {
    class_group: { type: 'text' },
    uploaded_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
  });
  pgm.createIndex('student_scripts', ['exam_id', 'class_group']);
  pgm.createIndex('student_scripts', 'uploaded_by');
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropIndex('student_scripts', 'uploaded_by');
  pgm.dropIndex('student_scripts', ['exam_id', 'class_group']);
  pgm.dropColumns('student_scripts', ['class_group', 'uploaded_by']);
};
