import knex, { type Knex } from 'knex';
import { Connector, AuthTypes } from '@google-cloud/cloud-sql-connector';
import { parse } from 'node:url';
import { config } from './config.js';

function resolver(): Knex.ConnectionConfigProvider {
  const instance = process.env.CLOUD_SQL_INSTANCE;
  if (!instance) {
    const url = parse(config.databaseUrl);
    return async () => ({
      host: url.hostname ?? 'localhost',
      port: Number(url.port ?? 5432),
      user: decodeURIComponent((url.auth ?? '').split(':')[0] ?? ''),
      password: decodeURIComponent((url.auth ?? '').split(':')[1] ?? ''),
      database: (url.pathname ?? '/postgres').slice(1),
    });
  }

  const connector = new Connector();
  const dbName = process.env.DB_NAME ?? 'marker_db';
  const dbUser = process.env.DB_USER ?? 'marker-sa@ucs-marker.iam';
  return async () => {
    const opts = await connector.getOptions({
      instanceConnectionName: instance,
      authType: AuthTypes.IAM,
    });
    return { ...opts, user: dbUser, database: dbName };
  };
}

export const db: Knex = knex({
  client: 'pg',
  connection: resolver(),
  pool: { min: 2, max: 10 },
});
