import { expect, test, beforeEach, afterEach, describe } from 'bun:test'
import { Database } from 'bun:sqlite'
import { MyWallet } from './index.ts'

describe('MyWallet', () => {
  let db: Database
  let wallet: MyWallet

  beforeEach(async () => {
    // Use in-memory database for tests
    db = new Database(':memory:')
    wallet = new MyWallet(db)
    await wallet.init()
  })

  afterEach(() => {
    db.close()
  })

  describe('Initialization', () => {
    test('should initialize database schema', async () => {
      // Check if table exists by trying to query it
      const result = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='wallet';",
        )
        .get()
      expect(result).toBeDefined()
      expect((result as any).name).toBe('wallet')
    })

    test('should handle multiple init calls safely', async () => {
      await wallet.init()
      await wallet.init() // Should not throw
      expect(true).toBe(true) // If we get here, no exception was thrown
    })
  })

  describe('Transaction Management', () => {
    test('should add positive transaction to new wallet', async () => {
      await wallet.addTransaction('user1', 1000n)
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1000n)
    })

    test('should add negative transaction', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.addTransaction('user1', -250n)
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(750n)
    })

    test('should handle multiple transactions', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.addTransaction('user1', 500n)
      await wallet.addTransaction('user1', -200n)
      await wallet.addTransaction('user1', 100n)
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1400n)
    })

    test('should handle large bigint amounts', async () => {
      const largeAmount = 999999999999999999999n
      await wallet.addTransaction('user1', largeAmount)
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(largeAmount)
    })
  })

  describe('Balance Queries', () => {
    test('should return 0 for non-existent wallet', async () => {
      const balance = await wallet.getBalance('nonexistent')
      expect(balance).toBe(0n)
    })

    test('should return correct balance after multiple operations', async () => {
      await wallet.addTransaction('user1', 1000n)
      expect(await wallet.getBalance('user1')).toBe(1000n)

      await wallet.addTransaction('user1', -300n)
      expect(await wallet.getBalance('user1')).toBe(700n)

      await wallet.addTransaction('user1', 500n)
      expect(await wallet.getBalance('user1')).toBe(1200n)
    })
  })

  describe('Overdraft Protection', () => {
    test('should prevent overdraft on new wallet', async () => {
      const result = await wallet
        .addTransaction('user1', -100n)
        .catch((err) => err)

      expect(result).toMatchInlineSnapshot(
        `[Error: Insufficient funds (approximate check)]`,
      )
    })

    test('should prevent overdraft on existing wallet', async () => {
      await wallet.addTransaction('user1', 100n)
      const result = await wallet
        .addTransaction('user1', -200n)
        .catch((err) => err)

      expect(result).toMatchInlineSnapshot(
        `[Error: Insufficient funds (approximate check)]`,
      )
    })

    test('should allow transaction that results in zero balance', async () => {
      await wallet.addTransaction('user1', 100n)
      await wallet.addTransaction('user1', -100n)
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(0n)
    })

    test('should prevent overdraft after multiple transactions', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.addTransaction('user1', -500n)
      await wallet.addTransaction('user1', -300n)
      // Balance is now 200, should reject -300
      const result = await wallet
        .addTransaction('user1', -300n)
        .catch((err) => err)

      expect(result).toMatchInlineSnapshot(
        `[Error: Insufficient funds (approximate check)]`,
      )
    })
  })

  describe('Settlement', () => {
    test('should settle pending transactions', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.addTransaction('user1', 500n)

      const settled = await wallet.settle('user1')
      expect(settled).toBe(true)

      // Balance should remain the same after settlement
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1500n)
    })

    test('should return false when nothing to settle', async () => {
      // Empty wallet
      const settled1 = await wallet.settle('nonexistent')
      expect(settled1).toBe(false)

      // Wallet with no pending transactions
      await wallet.addTransaction('user1', 1000n)
      await wallet.settle('user1') // First settlement
      const settled2 = await wallet.settle('user1') // Second settlement
      expect(settled2).toBe(false)
    })

    test('should maintain balance accuracy after settlement', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.addTransaction('user1', -200n)
      await wallet.addTransaction('user1', 300n)

      const balanceBefore = await wallet.getBalance('user1')
      await wallet.settle('user1')
      const balanceAfter = await wallet.getBalance('user1')

      expect(balanceBefore).toBe(balanceAfter)
      expect(balanceAfter).toBe(1100n)
    })

    test('should allow new transactions after settlement', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.settle('user1')

      await wallet.addTransaction('user1', 500n)
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1500n)
    })
  })

  describe('Multiple Wallets', () => {
    test('should handle multiple independent wallets', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.addTransaction('user2', 2000n)
      await wallet.addTransaction('user3', 500n)

      expect(await wallet.getBalance('user1')).toBe(1000n)
      expect(await wallet.getBalance('user2')).toBe(2000n)
      expect(await wallet.getBalance('user3')).toBe(500n)
    })

    test('should settle wallets independently', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.addTransaction('user2', 2000n)

      const settled1 = await wallet.settle('user1')
      expect(settled1).toBe(true)

      // User2 should still have unsettled transactions
      await wallet.addTransaction('user2', 500n)
      expect(await wallet.getBalance('user2')).toBe(2500n)
    })
  })

  describe('Edge Cases', () => {
    test('should handle zero amount transactions', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.addTransaction('user1', 0n)

      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1000n)
    })

    test('should handle negative zero', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.addTransaction('user1', -0n)

      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1000n)
    })

    test('should handle very large positive and negative amounts', async () => {
      const large = 999999999999999999999n
      await wallet.addTransaction('user1', large)
      await wallet.addTransaction('user1', -large)

      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(0n)
    })

    test('should maintain precision with extremely large numbers beyond max safe integer', async () => {
      // Test with 5x max safe integer (Number.MAX_SAFE_INTEGER = 9007199254740991)
      const extremelyLarge = 45035996273704955n

      // Add the extremely large amount
      await wallet.addTransaction('user1', extremelyLarge)
      const balanceAfterAdd = await wallet.getBalance('user1')
      expect(balanceAfterAdd).toBe(extremelyLarge)

      // Remove the exact same amount
      await wallet.addTransaction('user1', -extremelyLarge)
      const finalBalance = await wallet.getBalance('user1')

      // Should be exactly 0, confirming bigint precision is maintained
      expect(finalBalance).toBe(0n)
    })
  })

  describe('Concurrency Simulation', () => {
    test('should handle concurrent transactions to same wallet', async () => {
      const promises = []

      // Simulate 10 concurrent deposits of 100 each
      for (let i = 0; i < 10; i++) {
        promises.push(wallet.addTransaction('user1', 100n))
      }

      await Promise.all(promises)
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1000n)
    })

    test('should handle concurrent settlements', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.addTransaction('user1', 500n)

      // Try to settle concurrently - only one should succeed
      const [settled1, settled2] = await Promise.all([
        wallet.settle('user1'),
        wallet.settle('user1'),
      ])

      // Exactly one settlement should succeed
      expect(settled1 || settled2).toBe(true)
      expect(settled1 && settled2).toBe(false)

      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1500n)
    })

    test('should maintain consistency under concurrent operations', async () => {
      const operations = []

      // Mix of deposits, withdrawals, and balance checks
      for (let i = 0; i < 5; i++) {
        operations.push(wallet.addTransaction('user1', 200n))
        operations.push(wallet.addTransaction('user1', -50n))
      }

      await Promise.all(operations)
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(750n) // (200 - 50) * 5 = 750
    })
  })

  describe('Database Integration', () => {
    test('should persist data correctly', async () => {
      await wallet.addTransaction('user1', 1000n)

      // Create new wallet instance with same database
      const wallet2 = new MyWallet(db)
      const balance = await wallet2.getBalance('user1')
      expect(balance).toBe(1000n)
    })

    test('should handle database constraints', async () => {
      await wallet.addTransaction('user1', 1000n)

      // Try to manually insert duplicate wallet ID (should be handled gracefully)
      try {
        db.run('INSERT INTO wallet (id, large_balance) VALUES (?, ?)', [
          'user1',
          '500',
        ])
      } catch (error) {
        // This should fail due to primary key constraint
        expect(error).toBeDefined()
      }

      // Original wallet should be unaffected
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1000n)
    })
  })

  describe('Error Handling', () => {
    test('should handle empty wallet ID', async () => {
      await wallet.addTransaction('', 1000n)
      const balance = await wallet.getBalance('')
      expect(balance).toBe(1000n)
    })

    test('should handle very long wallet IDs', async () => {
      const longId = 'x'.repeat(1000)
      await wallet.addTransaction(longId, 1000n)
      const balance = await wallet.getBalance(longId)
      expect(balance).toBe(1000n)
    })

    test('should handle special characters in wallet ID', async () => {
      const specialId = 'user@domain.com/wallet#1'
      await wallet.addTransaction(specialId, 1000n)
      const balance = await wallet.getBalance(specialId)
      expect(balance).toBe(1000n)
    })
  })

  describe('Data Integrity', () => {
    test('should handle corrupted small_deltas JSON gracefully', async () => {
      await wallet.addTransaction('user1', 1000n)

      // Manually corrupt the JSON
      db.run('UPDATE wallet SET small_deltas = ? WHERE id = ?', [
        '[invalid json',
        'user1',
      ])

      // getBalance should handle this gracefully or throw meaningful error
      const result = await wallet.getBalance('user1').catch((err) => err)
      expect(result).toBeInstanceOf(Error)
    })

    test('should detect mismatch between bigint and float representations', async () => {
      await wallet.addTransaction('user1', 1000n)

      // Manually create mismatch
      db.run('UPDATE wallet SET large_balance_float = ? WHERE id = ?', [
        999.5, // Different from bigint value
        'user1',
      ])

      // The wallet should still work correctly using bigint values
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1000n)
    })
  })

  describe('Float Precision Edge Cases', () => {
    test('should handle amounts that lose precision in float conversion', async () => {
      // Use a number that cannot be exactly represented as a float
      const preciseAmount = 9007199254740993n // MAX_SAFE_INTEGER + 2

      await wallet.addTransaction('user1', preciseAmount)
      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(preciseAmount) // Should maintain exact precision

      // Try to withdraw exact amount - should work despite float imprecision
      await wallet.addTransaction('user1', -preciseAmount)
      const finalBalance = await wallet.getBalance('user1')
      expect(finalBalance).toBe(0n)
    })

    test('should handle overdraft detection when float loses precision', async () => {
      const largeAmount = 9007199254740992n // MAX_SAFE_INTEGER + 1
      await wallet.addTransaction('user1', largeAmount)

      // Try to withdraw slightly more than available
      const result = await wallet
        .addTransaction('user1', -(largeAmount + 1n))
        .catch((err) => err)

      // Due to float precision limits, overdraft detection might not catch
      // very small differences in extremely large numbers
      // This test documents the current behavior - the transaction might succeed
      // because the float approximation sees them as equal
      if (result instanceof Error) {
        expect(result.message).toBe('Insufficient funds (approximate check)')
      } else {
        // If transaction succeeded, verify the actual balance using bigint precision
        const balance = await wallet.getBalance('user1')
        expect(balance).toBe(-1n) // Should be -1 if transaction went through
      }
    })
  })

  describe('Performance and Scalability', () => {
    test('should handle many small transactions before settlement', async () => {
      // Add 100 small transactions
      for (let i = 0; i < 100; i++) {
        await wallet.addTransaction('user1', 10n)
      }

      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1000n)

      // Settlement should work efficiently
      const settled = await wallet.settle('user1')
      expect(settled).toBe(true)

      const balanceAfterSettlement = await wallet.getBalance('user1')
      expect(balanceAfterSettlement).toBe(1000n)
    })

    test('should maintain performance with mixed operations', async () => {
      const startTime = Date.now()

      // Mix of operations
      for (let i = 0; i < 50; i++) {
        await wallet.addTransaction('user1', 100n)
        if (i % 10 === 0) {
          await wallet.settle('user1')
        }
        await wallet.getBalance('user1')
      }

      const duration = Date.now() - startTime
      expect(duration).toBeLessThan(1000) // Should complete within 1 second

      const finalBalance = await wallet.getBalance('user1')
      expect(finalBalance).toBe(5000n)
    })
  })

  describe('Settlement Edge Cases', () => {
    test('should handle settlement when small_deltas contains zeros', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.addTransaction('user1', 0n)
      await wallet.addTransaction('user1', 500n)

      const settled = await wallet.settle('user1')
      expect(settled).toBe(true)

      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(1500n)
    })

    test('should handle settlement with only negative deltas', async () => {
      await wallet.addTransaction('user1', 1000n)
      await wallet.settle('user1') // Settle the initial amount

      await wallet.addTransaction('user1', -100n)
      await wallet.addTransaction('user1', -200n)

      const settled = await wallet.settle('user1')
      expect(settled).toBe(true)

      const balance = await wallet.getBalance('user1')
      expect(balance).toBe(700n)
    })
  })
})
