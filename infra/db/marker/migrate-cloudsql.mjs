// Apply pending migrations to the production Cloud SQL database through a local tunnel,
// then give the app's database user access to everything.
//
// Why a script: Cloud SQL has no private route from a laptop, the connector's built-in
// local proxy only supports Unix sockets (so it fails on Windows), and node-pg-migrate
// wants an ordinary DATABASE_URL. This forwards a local TCP port through the connector.
//
// Usage (PowerShell, from the repo root, after `gcloud auth application-default login`):
//   1. Back up:   gcloud sql backups create --instance=marker-postgres --project=ucs-marking-software
//   2. Set a temporary password on the built-in admin user (the app itself uses IAM, not a password):
//        $pw = <random value>
//        gcloud sql users set-password postgres --instance=marker-postgres --project=ucs-marking-software --password=$pw
//   3. $env:PGPW = $pw; node infra/db/marker/migrate-cloudsql.mjs; Remove-Item Env:PGPW
//
// It never prints the password. Migrations are additive; merge the code that needs a
// migration only AFTER this has run, or the new code will query columns that do not exist.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const require = createRequire(resolve(repoRoot, 'package.json'));
const { Connector } = require('@google-cloud/cloud-sql-connector');
const pg = require('pg');

const INSTANCE = 'ucs-marking-software:europe-west2:marker-postgres';
const IAM_USER = 'marker-sa@ucs-marking-software.iam';
const PORT = 15432;

const password = process.env.PGPW;
if (!password) {
  console.error('Set $env:PGPW to the temporary postgres password first (see the usage notes at the top of this file).');
  process.exit(1);
}
const url = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${PORT}/marker_db`;

const connector = new Connector();
const options = await connector.getOptions({ instanceConnectionName: INSTANCE, ipType: 'PUBLIC' });
const server = net.createServer((client) => {
  const upstream = options.stream();
  client.pipe(upstream);
  upstream.pipe(client);
  const end = () => { client.destroy(); upstream.destroy(); };
  client.on('error', end);
  upstream.on('error', end);
  client.on('close', end);
  upstream.on('close', end);
});
await new Promise((ready) => server.listen(PORT, '127.0.0.1', ready));
console.log('tunnel open');

const exitCode = await new Promise((done) => {
  const child = spawn(process.execPath, [resolve(here, 'migrate.mjs'), 'up'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
  child.on('exit', (code) => done(code ?? 1));
});
if (exitCode !== 0) {
  console.error('migration failed; nothing else was changed');
  server.close();
  connector.close();
  process.exit(exitCode);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
for (const sql of [
  `GRANT ALL ON ALL TABLES IN SCHEMA public TO "${IAM_USER}"`,
  `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${IAM_USER}"`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${IAM_USER}"`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${IAM_USER}"`,
]) await client.query(sql);

const applied = await client.query('SELECT name FROM pgmigrations ORDER BY id');
console.log('applied migrations:', applied.rows.map((r) => r.name).join(', '));
await client.end();
server.close();
connector.close();
console.log('done');
process.exit(0);
