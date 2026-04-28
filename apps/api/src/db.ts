import crypto from 'node:crypto';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import type { Config } from './config.js';

export type Db = {
  pool: Pool;
  query: <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
  one: <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<T>;
  maybeOne: <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<T | null>;
  transaction: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

export function createDb(config: Config): Db {
  const pool = new Pool({ connectionString: config.databaseUrl });

  async function query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    return pool.query<T>(sql, params);
  }

  async function one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> {
    const result = await query<T>(sql, params);
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Expected one row for query: ${sql}`);
    }
    return row;
  }

  async function maybeOne<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | null> {
    const result = await query<T>(sql, params);
    return result.rows[0] ?? null;
  }

  async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
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

  return {
    pool,
    query,
    one,
    maybeOne,
    transaction,
    close: () => pool.end()
  };
}
