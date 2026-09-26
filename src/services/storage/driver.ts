/**
 * The SQL seam under the store. `sqliteStore.ts` is written once against `SqlDriver`; two thin adapters supply a
 * `SqlConnection`: `expoDriver.ts` (expo-sqlite, the app) and `nodeDriver.ts` (node:sqlite, Vitest).
 *
 * `createDriver` owns everything that must behave identically on both: one lock per connection, transactions,
 * and nesting. Why not expo-sqlite's `withExclusiveTransactionAsync`: it opens a second connection per
 * transaction (losing per-connection pragmas such as `foreign_keys`), and a write issued on the main connection
 * meanwhile fails with "database is locked" instead of waiting. `withTransactionAsync` is worse: statements from
 * unrelated callers interleave into the open transaction. Here every top-level statement and every transaction
 * takes the lock, so a background sync committing a page and a screen writing an event queue behind each other
 * on the single connection.
 */
import { StoreError } from './errors';

/** Values that may be bound. Booleans are stored as 0/1 by the caller; node:sqlite rejects `boolean`. */
export type SqlValue = string | number | null;
export type SqlParams = readonly SqlValue[];
export type SqlRow = Record<string, SqlValue>;

export interface SqlRunResult {
  /** Rows inserted, updated, or deleted by the statement. */
  changes: number;
}

export interface SqlDriver {
  /** One statement, parameters bound positionally (`?`). Never interpolate values into `sql`. */
  run(sql: string, params?: SqlParams): Promise<SqlRunResult>;
  all<T extends object = SqlRow>(sql: string, params?: SqlParams): Promise<T[]>;
  /** The first row, or null. */
  get<T extends object = SqlRow>(sql: string, params?: SqlParams): Promise<T | null>;
  /**
   * `BEGIN IMMEDIATE` … `COMMIT`, or `ROLLBACK` if `fn` throws. `fn` must issue its statements on the `tx` it is
   * given: the outer driver waits for the lock the transaction holds, so using it inside `fn` deadlocks until
   * `lockTimeoutMs`. Called on a `tx`, it nests as a `SAVEPOINT` in the same transaction: a nested failure rolls
   * back only the nested work (and rethrows); the outer transaction decides the rest.
   */
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
  /** True for the driver handed to a `transaction` callback. */
  readonly inTransaction: boolean;
  /** Waits for in-flight work, then closes the connection. Only on the root driver. */
  close(): Promise<void>;
}

/** What a platform adapter provides: one connection, no locking, no transaction logic. */
export interface SqlConnection {
  /** A parameterless statement (BEGIN, COMMIT, SAVEPOINT …). */
  exec(sql: string): Promise<void>;
  run(sql: string, params: SqlParams): Promise<SqlRunResult>;
  all(sql: string, params: SqlParams): Promise<SqlRow[]>;
  close(): Promise<void>;
}

export interface DriverOptions {
  /**
   * How long a statement or transaction waits for the lock before failing with `lock_timeout`. Store
   * transactions are SQL-only and short; a wait this long means a `transaction` callback is calling the outer
   * store (a deadlock), so failing loudly beats hanging a background task until the OS kills it.
   */
  lockTimeoutMs?: number;
}

export const DEFAULT_LOCK_TIMEOUT_MS = 15_000;

/** FIFO lock with direct hand-off, so a waiter cannot be overtaken by a later caller. */
class Lock {
  private held = false;
  private readonly waiters: (() => void)[] = [];

  acquire(timeoutMs: number): Promise<void> {
    if (!this.held) {
      this.held = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const grant = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      };
      if (Number.isFinite(timeoutMs)) {
        timer = setTimeout(() => {
          const index = this.waiters.indexOf(grant);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(
            new StoreError(
              'lock_timeout',
              `waited ${timeoutMs} ms for the database; is a transaction callback using the outer store?`,
            ),
          );
        }, timeoutMs);
      }
      this.waiters.push(grant);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.held = false;
  }
}

async function quietly(connection: SqlConnection, sql: string): Promise<void> {
  try {
    await connection.exec(sql);
  } catch {
    // SQLite may already have rolled back (for example after SQLITE_FULL); keep the original error.
  }
}

async function firstRow<T extends object>(rows: Promise<T[]>): Promise<T | null> {
  return (await rows)[0] ?? null;
}

class TransactionDriver implements SqlDriver {
  readonly inTransaction = true;
  private finished = false;
  private nestedActive = false;

  constructor(
    private readonly connection: SqlConnection,
    private readonly depth: number,
  ) {}

  finish(): void {
    this.finished = true;
  }

  private check(): void {
    if (this.finished) {
      throw new StoreError('transaction_misuse', 'this transaction has already ended');
    }
  }

  async run(sql: string, params: SqlParams = []): Promise<SqlRunResult> {
    this.check();
    return this.connection.run(sql, params);
  }

  async all<T extends object = SqlRow>(sql: string, params: SqlParams = []): Promise<T[]> {
    this.check();
    return (await this.connection.all(sql, params)) as T[];
  }

  get<T extends object = SqlRow>(sql: string, params: SqlParams = []): Promise<T | null> {
    return firstRow(this.all<T>(sql, params));
  }

  async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    this.check();
    if (this.nestedActive) {
      throw new StoreError(
        'transaction_misuse',
        'nested transactions on one store must not overlap',
      );
    }
    this.nestedActive = true;
    // Savepoint names are fixed identifiers derived from the depth, never from input.
    const savepoint = `even_sp_${this.depth + 1}`;
    try {
      await this.connection.exec(`SAVEPOINT ${savepoint}`);
      const inner = new TransactionDriver(this.connection, this.depth + 1);
      try {
        const result = await fn(inner);
        inner.finish();
        await this.connection.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        inner.finish();
        await quietly(this.connection, `ROLLBACK TO ${savepoint}`);
        await quietly(this.connection, `RELEASE ${savepoint}`);
        throw error;
      }
    } finally {
      this.nestedActive = false;
    }
  }

  async close(): Promise<void> {
    throw new StoreError('transaction_misuse', 'close the root store, not a transaction');
  }
}

class RootDriver implements SqlDriver {
  readonly inTransaction = false;
  private readonly lock = new Lock();
  private closed = false;

  constructor(
    private readonly connection: SqlConnection,
    private readonly lockTimeoutMs: number,
  ) {}

  private checkOpen(): void {
    if (this.closed) throw new StoreError('closed', 'the database is closed');
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.checkOpen();
    await this.lock.acquire(this.lockTimeoutMs);
    try {
      this.checkOpen();
      return await fn();
    } finally {
      this.lock.release();
    }
  }

  run(sql: string, params: SqlParams = []): Promise<SqlRunResult> {
    return this.exclusive(() => this.connection.run(sql, params));
  }

  all<T extends object = SqlRow>(sql: string, params: SqlParams = []): Promise<T[]> {
    return this.exclusive(async () => (await this.connection.all(sql, params)) as T[]);
  }

  get<T extends object = SqlRow>(sql: string, params: SqlParams = []): Promise<T | null> {
    return firstRow(this.all<T>(sql, params));
  }

  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      // IMMEDIATE takes the write lock up front, so a transaction never fails half-way with SQLITE_BUSY when it
      // upgrades from reading to writing.
      await this.connection.exec('BEGIN IMMEDIATE');
      const tx = new TransactionDriver(this.connection, 0);
      let result: T;
      try {
        result = await fn(tx);
      } catch (error) {
        tx.finish();
        await quietly(this.connection, 'ROLLBACK');
        throw error;
      }
      tx.finish();
      try {
        await this.connection.exec('COMMIT');
      } catch (error) {
        await quietly(this.connection, 'ROLLBACK');
        throw error;
      }
      return result;
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.lock.acquire(this.lockTimeoutMs);
    try {
      if (this.closed) return;
      this.closed = true;
      await this.connection.close();
    } finally {
      this.lock.release();
    }
  }
}

/** Wraps a platform connection with the lock and transaction semantics described above. */
export function createDriver(connection: SqlConnection, options: DriverOptions = {}): SqlDriver {
  const timeout = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  if (!(timeout > 0)) throw new RangeError('lockTimeoutMs must be positive (Infinity disables it)');
  return new RootDriver(connection, timeout);
}
