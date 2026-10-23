import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { databaseUrl, webRoot } from './config';

const state = globalThis as typeof globalThis & {
  studioPool?: pg.Pool;
  studioMigration?: Promise<void>;
};
export function pool(): pg.Pool {
  return (state.studioPool ??= new pg.Pool({
    connectionString: databaseUrl(),
    max: 6,
    connectionTimeoutMillis: 3000,
  }));
}
export async function migrate(): Promise<void> {
  state.studioMigration ??= (async () => {
    const client = await pool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(71941301)');
      await client.query(
        await readFile(path.join(webRoot, 'src/server/schema.sql'), 'utf8'),
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    state.studioMigration = undefined;
    throw error;
  });
  await state.studioMigration;
}
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  await migrate();
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
