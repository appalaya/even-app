import { afterEach, describe, expect, it } from 'vitest';

import { createDriver, type SqlConnection, type SqlDriver } from './driver';
import { isStoreError } from './errors';
import { openNodeConnection } from './nodeDriver';

/** Adds a random macrotask delay before every call, like a native bridge round trip. */
function withLatency(connection: SqlConnection, log?: string[]): SqlConnection {
  const tick = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
  return {
    async exec(sql) {
      await tick();
      log?.push(sql);
      return connection.exec(sql);
    },
    async run(sql, params) {
      await tick();
      log?.push(sql);
      return connection.run(sql, params);
    },
    async all(sql, params) {
      await tick();
      log?.push(sql);
      return connection.all(sql, params);
    },
    close: () => connection.close(),
  };
}

let driver: SqlDriver;

async function setup(options: { latency?: boolean; lockTimeoutMs?: number; log?: string[] } = {}) {
  const connection = openNodeConnection();
  driver = createDriver(options.latency ? withLatency(connection, options.log) : connection, {
    lockTimeoutMs: options.lockTimeoutMs,
  });
  await driver.run('CREATE TABLE t (k TEXT PRIMARY KEY NOT NULL, v INTEGER)');
  return driver;
}

async function keys(db: SqlDriver = driver): Promise<string[]> {
  return (await db.all<{ k: string }>('SELECT k FROM t ORDER BY k')).map((r) => r.k);
}

afterEach(async () => {
  await driver?.close();
});

describe('statements', () => {
  it('binds parameters and reports changes', async () => {
    await setup();
    expect(
      await driver.run('INSERT INTO t (k, v) VALUES (?, ?), (?, ?)', ['a', 1, 'b', null]),
    ).toEqual({
      changes: 2,
    });
    expect(await driver.all('SELECT k, v FROM t ORDER BY k')).toEqual([
      { k: 'a', v: 1 },
      { k: 'b', v: null },
    ]);
    expect(await driver.get('SELECT v FROM t WHERE k = ?', ['a'])).toEqual({ v: 1 });
    expect(await driver.get('SELECT v FROM t WHERE k = ?', ['zzz'])).toBeNull();
  });

  it('returns plain objects, not null-prototype rows', async () => {
    await setup();
    await driver.run('INSERT INTO t (k, v) VALUES (?, ?)', ['a', 1]);
    const row = await driver.get('SELECT k FROM t');
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });

  it('rejects when used after close', async () => {
    await setup();
    await driver.close();
    await expect(driver.run('SELECT 1')).rejects.toSatisfy((e) => isStoreError(e, 'closed'));
    await driver.close(); // idempotent
  });

  it('runs queued operations in call order', async () => {
    await setup({ latency: true });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        driver.run('INSERT INTO t (k, v) VALUES (?, ?)', [`k${String(i).padStart(2, '0')}`, i]),
      ),
    );
    const rows = await driver.all<{ v: number }>('SELECT v FROM t ORDER BY rowid');
    expect(rows.map((r) => r.v)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});

describe('transaction', () => {
  it('commits and returns the callback value', async () => {
    await setup();
    const result = await driver.transaction(async (tx) => {
      expect(tx.inTransaction).toBe(true);
      await tx.run('INSERT INTO t (k) VALUES (?)', ['a']);
      return 42;
    });
    expect(result).toBe(42);
    expect(await keys()).toEqual(['a']);
  });

  it('begins IMMEDIATE and commits', async () => {
    const log: string[] = [];
    await setup({ latency: true, log });
    log.length = 0;
    await driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (k) VALUES (?)', ['a']);
    });
    expect(log).toEqual(['BEGIN IMMEDIATE', 'INSERT INTO t (k) VALUES (?)', 'COMMIT']);
  });

  it('rolls back and rethrows the original error', async () => {
    await setup();
    const boom = new Error('boom');
    await expect(
      driver.transaction(async (tx) => {
        await tx.run('INSERT INTO t (k) VALUES (?)', ['a']);
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await keys()).toEqual([]);
    // The connection is usable afterwards (no transaction left open).
    await driver.transaction((tx) => tx.run('INSERT INTO t (k) VALUES (?)', ['b']));
    expect(await keys()).toEqual(['b']);
  });

  it('rolls back when a statement fails', async () => {
    await setup();
    await expect(
      driver.transaction(async (tx) => {
        await tx.run('INSERT INTO t (k) VALUES (?)', ['a']);
        await tx.run('INSERT INTO t (k) VALUES (?)', ['a']); // primary key violation
      }),
    ).rejects.toThrow(/UNIQUE/);
    expect(await keys()).toEqual([]);
  });

  it('isolates the transaction from concurrent top-level statements', async () => {
    await setup({ latency: true });
    const failing = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (k) VALUES (?)', ['in-tx']);
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error('abort');
    });
    // Issued while the transaction is open: must wait, not join it and get rolled back with it.
    const outside = driver.run('INSERT INTO t (k) VALUES (?)', ['outside']);
    await expect(failing).rejects.toThrow('abort');
    await outside;
    expect(await keys()).toEqual(['outside']);
  });

  it('serialises concurrent transactions', async () => {
    await setup({ latency: true });
    await driver.run('INSERT INTO t (k, v) VALUES (?, ?)', ['counter', 0]);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        driver.transaction(async (tx) => {
          const row = await tx.get<{ v: number }>('SELECT v FROM t WHERE k = ?', ['counter']);
          await tx.run('UPDATE t SET v = ? WHERE k = ?', [(row?.v ?? 0) + 1, 'counter']);
        }),
      ),
    );
    expect(await driver.get('SELECT v FROM t WHERE k = ?', ['counter'])).toEqual({ v: 10 });
  });

  it('refuses a transaction driver after the transaction ended', async () => {
    await setup();
    let leaked: SqlDriver | undefined;
    await driver.transaction(async (tx) => {
      leaked = tx;
    });
    await expect(leaked!.run('SELECT 1')).rejects.toSatisfy((e) =>
      isStoreError(e, 'transaction_misuse'),
    );
    await expect(leaked!.close()).rejects.toSatisfy((e) => isStoreError(e, 'transaction_misuse'));
  });

  it('fails with lock_timeout instead of deadlocking when the callback uses the outer driver', async () => {
    await setup({ lockTimeoutMs: 50 });
    await expect(
      driver.transaction(async () => {
        await driver.run('INSERT INTO t (k) VALUES (?)', ['wrong']);
      }),
    ).rejects.toSatisfy((e) => isStoreError(e, 'lock_timeout'));
    expect(await keys()).toEqual([]);
  });

  it('close waits for an in-flight transaction', async () => {
    await setup({ latency: true });
    const tx = driver.transaction(async (t) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await t.run('INSERT INTO t (k) VALUES (?)', ['a']);
      return 'done';
    });
    const closing = driver.close();
    await expect(tx).resolves.toBe('done');
    await closing;
  });
});

describe('nested transaction', () => {
  it('commits nested work with the outer transaction', async () => {
    await setup();
    await driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (k) VALUES (?)', ['outer']);
      const inner = await tx.transaction(async (tx2) => {
        expect(tx2.inTransaction).toBe(true);
        await tx2.run('INSERT INTO t (k) VALUES (?)', ['inner']);
        return 'inner-result';
      });
      expect(inner).toBe('inner-result');
    });
    expect(await keys()).toEqual(['inner', 'outer']);
  });

  it('rolls back only the nested work when the outer catches', async () => {
    await setup();
    await driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (k) VALUES (?)', ['outer']);
      await expect(
        tx.transaction(async (tx2) => {
          await tx2.run('INSERT INTO t (k) VALUES (?)', ['inner']);
          throw new Error('inner fails');
        }),
      ).rejects.toThrow('inner fails');
      await tx.run('INSERT INTO t (k) VALUES (?)', ['after']);
    });
    expect(await keys()).toEqual(['after', 'outer']);
  });

  it('rolls back everything when the nested error propagates', async () => {
    await setup();
    await expect(
      driver.transaction(async (tx) => {
        await tx.run('INSERT INTO t (k) VALUES (?)', ['outer']);
        await tx.transaction(async (tx2) => {
          await tx2.run('INSERT INTO t (k) VALUES (?)', ['inner']);
          throw new Error('propagates');
        });
      }),
    ).rejects.toThrow('propagates');
    expect(await keys()).toEqual([]);
  });

  it('rolls back nested work when the outer transaction fails later', async () => {
    await setup();
    await expect(
      driver.transaction(async (tx) => {
        await tx.transaction((tx2) => tx2.run('INSERT INTO t (k) VALUES (?)', ['inner']));
        throw new Error('outer fails');
      }),
    ).rejects.toThrow('outer fails');
    expect(await keys()).toEqual([]);
  });

  it('nests three deep', async () => {
    await setup();
    await driver.transaction(async (a) => {
      await a.transaction(async (b) => {
        await b.run('INSERT INTO t (k) VALUES (?)', ['b']);
        await expect(
          b.transaction(async (c) => {
            await c.run('INSERT INTO t (k) VALUES (?)', ['c']);
            throw new Error('c fails');
          }),
        ).rejects.toThrow();
      });
      // Sequential nested transactions at the same depth reuse the savepoint name safely.
      await a.transaction((b) => b.run('INSERT INTO t (k) VALUES (?)', ['b2']));
    });
    expect(await keys()).toEqual(['b', 'b2']);
  });

  it('refuses overlapping nested transactions on one transaction driver', async () => {
    await setup();
    await driver.transaction(async (tx) => {
      const first = tx.transaction(async (tx2) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await tx2.run('INSERT INTO t (k) VALUES (?)', ['first']);
      });
      await expect(tx.transaction(async () => undefined)).rejects.toSatisfy((e) =>
        isStoreError(e, 'transaction_misuse'),
      );
      await first;
    });
    expect(await keys()).toEqual(['first']);
  });
});
