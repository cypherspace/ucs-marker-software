import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

const bin = resolve(__dirname, '../../../node_modules/node-pg-migrate/bin/node-pg-migrate.js');
const direction = process.argv[2] ?? 'up';

const child = spawn(
  process.execPath,
  [bin, '-d', 'DATABASE_URL', '-m', 'migrations', direction],
  { stdio: 'inherit', cwd: __dirname },
);
child.on('exit', (code) => process.exit(code ?? 1));
