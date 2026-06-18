/* eslint-disable @typescript-eslint/no-var-requires */
// Shared tables present in every app: users, sessions, allowed_emails, audit_log.

exports.up = (pgm) => {
  pgm.createType('user_role', ['admin', 'teacher']);

  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    google_sub: { type: 'text', unique: true },
    email: { type: 'text', notNull: true, unique: true },
    name: { type: 'text' },
    role: { type: 'user_role', notNull: true, default: 'teacher' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_login_at: { type: 'timestamptz' },
  });

  // Seed initial staff accounts
  pgm.sql(`
    INSERT INTO users (id, email, name, role) VALUES
      ('00000000-0000-0000-0000-000000000001', 'admin@marker.local', 'Admin', 'admin'),
      (gen_random_uuid(), 'richard.wood@ucs.org.uk',     'Richard Wood',     'teacher'),
      (gen_random_uuid(), 'peter.edmunds@ucs.org.uk',    'Peter Edmunds',    'teacher'),
      (gen_random_uuid(), 'nicholas.burke@ucs.org.uk',   'Nicholas Burke',   'teacher'),
      (gen_random_uuid(), 'cypherspace@gmail.com',       'Richard (owner)',  'admin')
    ON CONFLICT (email) DO NOTHING;
  `);

  pgm.createTable('sessions', {
    id: { type: 'text', primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    user_agent: { type: 'text' },
  });
  pgm.createIndex('sessions', 'user_id');
  pgm.createIndex('sessions', 'expires_at');

  pgm.createTable('allowed_emails', {
    email: { type: 'text', primaryKey: true },
    role: { type: 'user_role', notNull: true, default: 'teacher' },
    added_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('audit_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    actor_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    action: { type: 'text', notNull: true },
    target_type: { type: 'text' },
    target_id: { type: 'text' },
    metadata: { type: 'jsonb' },
    ip_address: { type: 'inet' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('audit_log', 'actor_id');
  pgm.createIndex('audit_log', 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable('audit_log');
  pgm.dropTable('allowed_emails');
  pgm.dropTable('sessions');
  pgm.dropTable('users');
  pgm.dropType('user_role');
};
