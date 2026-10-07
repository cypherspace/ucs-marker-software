/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // ── AI marks live alongside human marks ───────────────────────────────────
  pgm.addColumns('script_marks', {
    ai_reasoning: { type: 'text' },
    ai_model: { type: 'text' },
  });
  // Re-running AI marking used to stack rows (marker_id is NULL for AI, so the
  // (clip_id, marker_id) unique constraint never fired). Keep the latest per clip.
  pgm.sql(`
    DELETE FROM script_marks a USING script_marks b
     WHERE a.mark_source = 'ai' AND b.mark_source = 'ai' AND a.clip_id = b.clip_id
       AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));
  `);
  pgm.createIndex('script_marks', 'clip_id', {
    name: 'script_marks_one_ai_per_clip',
    unique: true,
    where: "mark_source = 'ai'",
  });

  // ── Per-question marking style ────────────────────────────────────────────
  pgm.addColumn('exam_questions', {
    marking_mode: { type: 'text', notNull: true, default: 'marks' },
  });
  pgm.addConstraint('exam_questions', 'exam_questions_marking_mode_check', "CHECK (marking_mode IN ('marks', 'comparative'))");

  // ── Comparative marking ───────────────────────────────────────────────────
  pgm.addColumns('comparative_pairs', {
    round: { type: 'integer', notNull: true, default: 1 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('comparative_pairs', 'comparative_pairs_distinct_clips', 'CHECK (clip_a_id <> clip_b_id)');
  // A pair of scripts is compared at most once per question, whichever way round.
  pgm.sql(`
    CREATE UNIQUE INDEX comparative_pairs_unique_pair
      ON comparative_pairs (question_id, LEAST(clip_a_id, clip_b_id), GREATEST(clip_a_id, clip_b_id));
  `);

  pgm.createTable('comparative_judgements', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    pair_id: { type: 'uuid', notNull: true, references: 'comparative_pairs(id)', onDelete: 'CASCADE' },
    source: { type: 'text', notNull: true },
    judged_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    winner_clip_id: { type: 'uuid', notNull: true, references: 'script_clips(id)', onDelete: 'CASCADE' },
    reasoning: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('comparative_judgements', 'comparative_judgements_source_check', "CHECK (source IN ('human', 'ai'))");
  // One human and one AI judgement per pair; a human judgement overrides the AI one.
  pgm.createIndex('comparative_judgements', 'pair_id', { name: 'comparative_judgements_one_human', unique: true, where: "source = 'human'" });
  pgm.createIndex('comparative_judgements', 'pair_id', { name: 'comparative_judgements_one_ai', unique: true, where: "source = 'ai'" });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable('comparative_judgements');
  pgm.sql('DROP INDEX IF EXISTS comparative_pairs_unique_pair');
  pgm.dropConstraint('comparative_pairs', 'comparative_pairs_distinct_clips');
  pgm.dropColumns('comparative_pairs', ['round', 'created_at']);
  pgm.dropConstraint('exam_questions', 'exam_questions_marking_mode_check');
  pgm.dropColumn('exam_questions', 'marking_mode');
  pgm.dropIndex('script_marks', 'clip_id', { name: 'script_marks_one_ai_per_clip' });
  pgm.dropColumns('script_marks', ['ai_reasoning', 'ai_model']);
};
