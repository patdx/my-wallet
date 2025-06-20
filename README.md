# MyWallet - Lock-Free Wallet Management Library

A TypeScript library for managing digital wallets with arbitrary precision integer amounts using SQLite, designed for high-concurrency scenarios without database locking.

This is not an npm package and I don't plan to make it an npm package at the moment.

## Motivation

This library was created to handle wallet transactions in Cloudflare D1, which lacks support for arbitrarily large numbers and can introduce accuracy issues with financial calculations.

If you are using a flavor of SQLite with the [decimal.c](https://sqlite.org/floatingpoint.html#the_decimal_c_extension) extension included, or using a flavor of SQLite where you have synchronous access to the database, then you don't need all this extra fluff in this library.

## Key Features

- **Arbitrary Precision**: Supports unlimited integer amounts using JavaScript's `bigint` type
- **Lock-Free Architecture**: Uses optimistic concurrency control instead of database locks
- **Overdraft Protection**: Prevents negative balances with approximate balance checks
- **Dual Storage Model**: Efficiently handles frequent small transactions with periodic settlement
- **SQLite Backend**: Lightweight, embedded database storage

## Architecture

The library uses a dual-storage approach to avoid database locking:

- **Large Balance**: Settled/committed balance stored as a string-encoded bigint
- **Small Deltas**: Array of pending transactions stored as JSON
- **Float Approximations**: Cached float values for quick overdraft checks

This design allows multiple concurrent transactions without locks, with periodic settlement to consolidate the data.

## Installation

Since this is not published as an npm package, you can use it by:

1. **Direct usage in your project:**

   ```bash
   # Copy the files to your project
   cp index.ts your-project/src/wallet.ts
   ```

2. **Git submodule:**

   ```bash
   git submodule add <your-repo-url> lib/my-wallet
   ```

3. **Local development:**
   ```bash
   git clone <your-repo-url>
   cd my-wallet
   bun install  # For development dependencies
   ```

## Usage

```typescript
import { Database } from 'bun:sqlite'
import { MyWallet } from './index.ts'

// Initialize database and wallet
const db = new Database('wallet.db')
const wallet = new MyWallet(db)
await wallet.init()

// Add transactions
await wallet.addTransaction('user123', 1000n) // Add $10.00 (in cents)
await wallet.addTransaction('user123', -250n) // Spend $2.50

// Check balance
const balance = await wallet.getBalance('user123')
console.log(`Balance: ${balance}`) // Balance: 750n

// Settle pending transactions
const settled = await wallet.settle('user123')
console.log(`Settlement successful: ${settled}`)
```

## API Reference

### `MyWallet`

#### Constructor

- `constructor(db: Database)` - Initialize with a Bun SQLite database instance

#### Methods

##### `init(): Promise<void>`

Initialize the wallet database schema. Creates the wallet table if it doesn't exist.

##### `addTransaction(walletId: string, amount: bigint): Promise<void>`

Add a transaction (positive or negative) to a wallet.

- **walletId**: Unique identifier for the wallet
- **amount**: Transaction amount as bigint (positive for deposits, negative for withdrawals)
- **Throws**: Error if transaction would result in negative balance

##### `getBalance(walletId: string): Promise<bigint>`

Get the current total balance for a wallet.

- **Returns**: Current balance as bigint (0n if wallet doesn't exist)

##### `settle(walletId: string): Promise<boolean>`

Consolidate pending transactions into the main balance.

- **Returns**: `true` if settlement occurred, `false` if nothing to settle
- Uses optimistic locking to prevent race conditions

## Database Schema

```sql
CREATE TABLE wallet (
  id TEXT PRIMARY KEY,              -- Wallet identifier
  large_balance TEXT NOT NULL DEFAULT '0',   -- Settled balance (bigint as string)
  small_deltas TEXT NOT NULL DEFAULT '[]',   -- Pending transactions (JSON array)
  large_balance_float REAL NOT NULL DEFAULT 0,      -- Float approximation of large_balance
  small_deltas_float REAL NOT NULL DEFAULT 0        -- Sum of small_deltas as float
) STRICT;
```

## Overdraft Protection

The library uses a SQLite trigger to prevent negative balances:

```sql
CREATE TRIGGER prevent_overdraft
BEFORE UPDATE ON wallet
WHEN NEW.large_balance_float + NEW.small_deltas_float < 0
BEGIN
  SELECT RAISE(ABORT, 'sqlite_error_insufficient_funds');
END;
```

This ensures atomicity and prevents race conditions in balance validation.

## Concurrency Model

The library uses **optimistic concurrency control** to handle concurrent access:

1. **Transactions** are appended to `small_deltas` with approximate balance validation
2. **Settlement** uses the current `small_deltas` value as an optimistic lock
3. **Race conditions** during settlement result in retry-able failures

This approach provides excellent performance for high-frequency transactions while maintaining data consistency.

## Error Handling

The library throws specific errors for different scenarios:

- `Error('Insufficient funds (approximate check)')` - When a transaction would create a negative balance
- Standard SQLite errors - For database connectivity or constraint issues

## Performance Considerations

- **Small transactions** are very fast (single UPDATE with JSON append)
- **Settlement** should be done periodically to prevent `small_deltas` from growing too large
- **Float approximation** enables fast overdraft checks without bigint arithmetic
- **Batch operations** are recommended for high-frequency scenarios

## Testing

Run the test suite with:

```bash
bun test
```

The tests cover:

- Basic transaction operations
- Overdraft protection
- Settlement mechanics
- Concurrency scenarios
- Edge cases with large numbers

## Roadmap

The following features are planned for future releases:

### Inter-Wallet Transactions

```typescript
// Transfer funds between wallets atomically, even 3 or more wallets in one
// transaction

await wallet.addTransaction({
  lines: [
    {
      walletId: 'user1',
      delta: -500n,
    },
    {
      walletId: 'user2',
      delta: 200n,
    },
    {
      walletId: 'user3',
      delta: 300n,
      // Store arbitrary transaction line data
      data: {
        // ...
      },
    },
  ],
  // Store arbitrary transaction data
  data: {
    // ...
  },
})
// Deducts from user123 and adds to user456 in a single transaction
```

Planned API:

- `transfer(fromWalletId: string, toWalletId: string, amount: bigint): Promise<void>`
- Atomic operations ensuring consistency across both wallets
- Overdraft protection for the sender wallet
- Transaction logging for audit trails

### Transaction History

```typescript
// Get transaction history for a wallet
const history = await wallet.getTransactionHistory('user123', { limit: 10 })
// Returns: Array<{ id: string, amount: bigint, timestamp: Date, type: 'deposit' | 'withdrawal' | 'transfer' }>

// Get transactions within a date range
const recentTxns = await wallet.getTransactionHistory('user123', {
  from: new Date('2024-01-01'),
  to: new Date('2024-01-31'),
})
```

Planned features:

- Complete transaction audit log with timestamps
- Filtering by date range, transaction type, and amount
- Pagination support for large transaction histories
- Transaction metadata (description, reference IDs, etc.)

### Generic SQLite Database Support

Enhanced database compatibility and testing:

```typescript
// Works with any SQLite database implementation (in particular async sqlite)
import { Database as BetterSQLite3 } from 'better-sqlite3'
import { Database as BunSQLite } from 'bun:sqlite'

// Generic database adapter interface
const wallet1 = new MyWallet(new BetterSQLite3('wallet.db'))
const wallet2 = new MyWallet(new BunSQLite('wallet.db'))
```

Planned improvements:

- Database adapter pattern for multiple SQLite implementations
- Comprehensive trigger error testing to ensure overdraft protection works across different SQLite engines
- Database migration utilities for schema updates
- Performance benchmarking across different SQLite implementations
- Apply multiple transactions inside a single batch
- Change internal schema to have one approximate float value instead
- Add indexed `needs_settlement` column so we can find and settle all
  unsettled columns easily.

### Automatic Settlement

```typescript
// Configure automatic settlement timing
const wallet = new MyWallet(db, {
  autoSettle: true,
  settlementDelay: 1000, // 1 second after last transaction
})
```

Planned features:

- Configurable automatic settlement after transaction bursts
- Background settlement worker to consolidate pending transactions
- Settlement scheduling based on transaction volume or time intervals
- Settlement status monitoring and metrics
- Support valibot or zod for data validation
- Format in a convenient copy-pastable way to use with your preferred database

## Running the Demo

```bash
bun run index.ts
```

## Requirements

- **Bun runtime**: v1.0+ (tested with v1.2.16)
- **TypeScript**: 5.0+
- **SQLite**: Any compatible implementation with JSON support

This project was created using `bun init` and leverages [Bun](https://bun.sh)'s fast SQLite integration.
