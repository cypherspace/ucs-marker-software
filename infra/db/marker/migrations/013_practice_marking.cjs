/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // Practice marking: a teacher picks some already-marked clips into a "set", shares a link per class, and students
  // mark them and compare their marks with the teachers'. Student marks live in their own table so they can never be
  // mixed into a teacher's marks, progress, results or exports.
  pgm.createTable('practice_sets', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    exam_id: { type: 'uuid', notNull: true, references: 'exams(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    created_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    show_mark_scheme: { type: 'boolean', notNull: true, default: true },
    closed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('practice_sets', 'exam_id');

  // The id of an item is what a student sees: it says nothing about which script or student the clip came from
  pgm.createTable('practice_set_items', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    set_id: { type: 'uuid', notNull: true, references: 'practice_sets(id)', onDelete: 'CASCADE' },
    clip_id: { type: 'uuid', notNull: true, references: 'script_clips(id)', onDelete: 'CASCADE' },
    position: { type: 'integer', notNull: true },
  });
  pgm.addConstraint('practice_set_items', 'practice_set_items_unique', { unique: ['set_id', 'clip_id'] });
  pgm.createIndex('practice_set_items', ['set_id', 'position']);

  pgm.createTable('practice_links', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    set_id: { type: 'uuid', notNull: true, references: 'practice_sets(id)', onDelete: 'CASCADE' },
    class_name: { type: 'text', notNull: true },
    token: { type: 'text', notNull: true, unique: true },
    created_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    expires_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('practice_links', 'set_id');

  pgm.createTable('practice_enrolments', {
    link_id: { type: 'uuid', notNull: true, references: 'practice_links(id)', onDelete: 'CASCADE' },
    student_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('practice_enrolments', 'practice_enrolments_pkey', { primaryKey: ['link_id', 'student_id'] });
  pgm.createIndex('practice_enrolments', 'student_id');

  // A row exists only once a student has submitted, and is never changed afterwards
  pgm.createTable('student_marks', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    item_id: { type: 'uuid', notNull: true, references: 'practice_set_items(id)', onDelete: 'CASCADE' },
    student_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    link_id: { type: 'uuid', references: 'practice_links(id)', onDelete: 'SET NULL' },
    marks_awarded: { type: 'integer', notNull: true },
    annotation_data: { type: 'jsonb' },
    submitted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('student_marks', 'student_marks_unique', { unique: ['item_id', 'student_id'] });
  pgm.createIndex('student_marks', 'student_id');
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable('student_marks');
  pgm.dropTable('practice_enrolments');
  pgm.dropTable('practice_links');
  pgm.dropTable('practice_set_items');
  pgm.dropTable('practice_sets');
};
