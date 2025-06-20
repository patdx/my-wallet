import { Database } from 'bun:sqlite'

export class MyWallet {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  async init() {
    // Create table if not exists
    this.db.run(`
      CREATE TABLE IF NOT EXISTS wallet (
        id TEXT PRIMARY KEY,
        large_balance TEXT NOT NULL DEFAULT '0',
        small_deltas TEXT NOT NULL DEFAULT '[]',
        large_balance_float REAL NOT NULL DEFAULT 0,
        small_deltas_float REAL NOT NULL DEFAULT 0
      ) STRICT;
    `)

    // Create trigger to prevent overdrafts

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS prevent_overdraft
      BEFORE UPDATE ON wallet
      WHEN NEW.large_balance_float + NEW.small_deltas_float < 0
      BEGIN
        SELECT RAISE(ABORT, 'sqlite_error_insufficient_funds');
      END;
    `)
  }

  /**
   * Add a transaction (positive or negative) as a stringified bigint to small_deltas.
   * Reject if approximate new balance would be negative (enforced by database trigger).
   */
  async addTransaction(walletId: string, amount: bigint): Promise<void> {
    const amountStr = amount.toString()
    const amountFloat = Number(amountStr)

    // Insert wallet if it doesn't exist
    this.db.run(
      `
      INSERT INTO wallet (id, large_balance, small_deltas, large_balance_float, small_deltas_float)
      VALUES (?, '0', '[]', 0, 0)
      ON CONFLICT DO NOTHING
      `,
      [walletId],
    )

    // Append new delta atomically via json_insert
    // The database trigger will prevent overdrafts automatically
    try {
      const result = this.db
        .query(
          `
        UPDATE wallet
        SET
          small_deltas = json_insert(small_deltas, '$[#]', ?),
          small_deltas_float = small_deltas_float + ?
        WHERE id = ?;
        `,
        )
        .run(amountStr, amountFloat, walletId)
    } catch (error: unknown) {
      // Re-throw database constraint errors with cleaner message
      if (
        error instanceof Error &&
        error.message?.includes('sqlite_error_insufficient_funds')
      ) {
        throw new Error('Insufficient funds (approximate check)')
      }
      throw error
    }
  }

  /**
   * Get the full current balance = settled large_balance + sum of small_deltas
   */
  async getBalance(walletId: string): Promise<bigint> {
    const row = this.db
      .query<
        { large_balance: string; small_deltas: string },
        [string]
      >(`SELECT large_balance, small_deltas FROM wallet WHERE id = ?;`)
      .get(walletId)

    if (!row) {
      return 0n
    }

    const large = BigInt(row.large_balance)
    const deltas: string[] = JSON.parse(row.small_deltas)
    const sumDeltas = deltas.reduce((acc, val) => acc + BigInt(val), 0n)

    return large + sumDeltas
  }

  /**
   * Settle the wallet: merge small_deltas into large_balance and reset small_deltas.
   * Uses optimistic concurrency control to avoid races.
   */
  async settle(walletId: string): Promise<boolean> {
    // Fetch current wallet state
    const row = this.db
      .query<
        { large_balance: string; small_deltas: string },
        [string]
      >(`SELECT large_balance, small_deltas FROM wallet WHERE id = ?;`)
      .get(walletId)

    if (!row) {
      // Nothing to settle
      return false
    }

    if (row.small_deltas === '[]') {
      // Nothing to settle
      return false
    }

    const deltas: string[] = JSON.parse(row.small_deltas)
    const sum = deltas.reduce((acc, val) => acc + BigInt(val), 0n)
    const newLarge = BigInt(row.large_balance) + sum
    const newLargeFloat = Number(newLarge)

    // Update using optimistic locking on small_deltas text value
    const result = this.db
      .query(
        `
      UPDATE wallet
      SET
        large_balance = ?,
        large_balance_float = ?,
        small_deltas = '[]',
        small_deltas_float = 0
      WHERE id = ? AND small_deltas = ?;
      `,
      )
      .run(newLarge.toString(), newLargeFloat, walletId, row.small_deltas)

    return result.changes === 1
  }
}
