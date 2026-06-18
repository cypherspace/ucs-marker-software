/* eslint-disable @typescript-eslint/no-var-requires */
// App-specific tables for the UCS Marking System.

exports.up = (pgm) => {
  // ── Exams ──────────────────────────────────────────────────────────────────
  pgm.createType('exam_status', ['setup', 'clipping', 'marking', 'complete']);

  pgm.createTable('exams', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    subject: { type: 'text' },
    year: { type: 'integer' },
    year_group: { type: 'text' },
    exam_board: { type: 'text' },
    exam_series: { type: 'text' },
    lead_teacher_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'RESTRICT' },
    status: { type: 'exam_status', notNull: true, default: 'setup' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('exams', 'lead_teacher_id');

  // ── Question/part definitions ─────────────────────────────────────────────
  pgm.createTable('exam_questions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    exam_id: { type: 'uuid', notNull: true, references: 'exams(id)', onDelete: 'CASCADE' },
    question_number: { type: 'text', notNull: true },
    max_marks: { type: 'integer', notNull: true },
    // Array of {page, x, y, width, height} in PDF user-space points (72 DPI)
    clip_coordinates: { type: 'jsonb' },
    ms_clip_coordinates: { type: 'jsonb' },
    // Name zones to black out before AI processing
    name_zones: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('exam_questions', 'exam_id');

  // ── Teacher-question assignments ──────────────────────────────────────────
  pgm.createTable('marking_assignments', {
    exam_id: { type: 'uuid', notNull: true, references: 'exams(id)', onDelete: 'CASCADE' },
    teacher_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    question_id: { type: 'uuid', notNull: true, references: 'exam_questions(id)', onDelete: 'CASCADE' },
    assigned_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    assigned_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('marking_assignments', 'marking_assignments_pkey', 'PRIMARY KEY (exam_id, teacher_id, question_id)');

  // ── Student scripts (uploaded PDFs) ───────────────────────────────────────
  pgm.createTable('student_scripts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    exam_id: { type: 'uuid', notNull: true, references: 'exams(id)', onDelete: 'CASCADE' },
    // Nullable: script may be uploaded before student has a platform account
    student_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    // Anonymization token — the only identifier used during marking and AI processing
    student_number: { type: 'text', notNull: true },
    original_pdf_url: { type: 'text', notNull: true },
    uploaded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('student_scripts', 'student_scripts_exam_number_unique', 'UNIQUE (exam_id, student_number)');
  pgm.createIndex('student_scripts', 'exam_id');

  // ── Clipped question images ───────────────────────────────────────────────
  pgm.createTable('script_clips', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    script_id: { type: 'uuid', notNull: true, references: 'student_scripts(id)', onDelete: 'CASCADE' },
    question_id: { type: 'uuid', notNull: true, references: 'exam_questions(id)', onDelete: 'CASCADE' },
    clip_image_url: { type: 'text', notNull: true },
    // OCR transcription of handwritten content (populated on demand)
    ocr_text: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('script_clips', 'script_clips_unique', 'UNIQUE (script_id, question_id)');
  pgm.createIndex('script_clips', ['script_id', 'question_id']);

  // ── Marks awarded on each clip ────────────────────────────────────────────
  pgm.createType('mark_source', ['human', 'ai']);
  pgm.createType('mark_status', ['pending', 'marked', 'moderated']);

  pgm.createTable('script_marks', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    clip_id: { type: 'uuid', notNull: true, references: 'script_clips(id)', onDelete: 'CASCADE' },
    // NULL for AI-generated marks
    marker_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    mark_source: { type: 'mark_source', notNull: true },
    marks_awarded: { type: 'integer' },
    // Serialized AnnotationData JSON
    annotation_data: { type: 'jsonb' },
    ai_feedback: { type: 'text' },
    status: { type: 'mark_status', notNull: true, default: 'pending' },
    marked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // One human mark per clip per marker; AI marks are separate rows
  pgm.addConstraint('script_marks', 'script_marks_clip_marker_unique', 'UNIQUE (clip_id, marker_id)');
  pgm.createIndex('script_marks', 'clip_id');
  pgm.createIndex('script_marks', 'marker_id');

  // ── Comparative pairs (essay ranking) ─────────────────────────────────────
  pgm.createTable('comparative_pairs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    exam_id: { type: 'uuid', notNull: true, references: 'exams(id)', onDelete: 'CASCADE' },
    question_id: { type: 'uuid', notNull: true, references: 'exam_questions(id)', onDelete: 'CASCADE' },
    clip_a_id: { type: 'uuid', notNull: true, references: 'script_clips(id)', onDelete: 'CASCADE' },
    clip_b_id: { type: 'uuid', notNull: true, references: 'script_clips(id)', onDelete: 'CASCADE' },
    winner_clip_id: { type: 'uuid', references: 'script_clips(id)', onDelete: 'SET NULL' },
    gemini_reasoning: { type: 'text' },
    compared_at: { type: 'timestamptz' },
  });
  pgm.createIndex('comparative_pairs', ['exam_id', 'question_id']);
};

exports.down = (pgm) => {
  pgm.dropTable('comparative_pairs');
  pgm.dropTable('script_marks');
  pgm.dropType('mark_status');
  pgm.dropType('mark_source');
  pgm.dropTable('script_clips');
  pgm.dropTable('student_scripts');
  pgm.dropTable('marking_assignments');
  pgm.dropTable('exam_questions');
  pgm.dropTable('exams');
  pgm.dropType('exam_status');
};
