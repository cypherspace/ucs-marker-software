/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // A clip normally uses its question's regions. A script with a different layout
  // (typed, scribed, missing pages) can carry its own regions for one question.
  pgm.addColumns('script_clips', {
    // PDF-point regions that replace the question's for this script; NULL = use the question's
    regions: { type: 'jsonb' },
    // Name zones that replace the question's for this script; NULL = use the question's
    name_zones: { type: 'jsonb' },
    clip_source: { type: 'text', notNull: true, default: 'auto' },
    // Set whenever the clip is re-selected by hand (or reset); compared with marked_at to flag stale marks
    reclipped_at: { type: 'timestamptz' },
    reclipped_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
  });
  pgm.addConstraint('script_clips', 'script_clips_clip_source_check', "CHECK (clip_source IN ('auto', 'manual'))");
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropConstraint('script_clips', 'script_clips_clip_source_check');
  pgm.dropColumns('script_clips', ['regions', 'name_zones', 'clip_source', 'reclipped_at', 'reclipped_by']);
};
