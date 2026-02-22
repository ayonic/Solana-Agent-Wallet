/**
 * integration.ts
 * Automated test harness verifying all wallet operations on devnet.
 * Tests wallet creation, airdrop, SOL transfer, key persistence, multi-agent isolation.
 */

import * as dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import { createConnection } from '../utils/connection';
import { KeyManager } from '../wallet/KeyManager';
import { WalletRegistry } from '../wallet/WalletRegistry';
import { logger } from '../utils/logger';

let passed = 0;
let failed = 0;
let networkDegraded = false;

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${name}… `);
  try {
    await fn();
    console.log(chalk.green('✔ PASS'));
    passed++;
  } catch (err) {
    console.log(chalk.red(`✘ FAIL: ${err}`));
    failed++;
  }
}

async function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(chalk.cyan('\n🧪 Solana Agentic Wallet — Integration Tests\n'));

  const connection = createConnection();
  const keyManager = new KeyManager('test-secret-key-32-chars-exactly!');
  const registry = new WalletRegistry(connection, keyManager);

  // ── Test 1: Wallet creation ───────────────────────────────────────────────
  await test('Wallet creation generates valid keypair', async () => {
    const wallet = registry.getOrCreate('test-wallet-1', 'Test 1');
    assert(wallet.publicKey.length === 44, 'Public key should be 44 chars (Base58)');
  });

  // ── Test 2: Key persistence ───────────────────────────────────────────────
  await test('Key persistence across registry instances', async () => {
    const registry2 = new WalletRegistry(connection, keyManager);
    const wallet2 = registry2.getOrCreate('test-wallet-1', 'Test 1 Reloaded');
    const wallet1 = registry.get('test-wallet-1')!;
    assert(wallet1.publicKey === wallet2.publicKey, 'Public keys must match after reload');
  });

  // ── Test 3: Multi-agent isolation ────────────────────────────────────────
  await test('Multiple agents have independent keypairs', async () => {
    const w1 = registry.getOrCreate('test-isolation-1');
    const w2 = registry.getOrCreate('test-isolation-2');
    assert(w1.publicKey !== w2.publicKey, 'Agents must have different public keys');
  });

  // ── Test 4: Key listing ───────────────────────────────────────────────────
  await test('Key listing returns all stored agents', async () => {
    const keys = keyManager.listKeys();
    assert(keys.length >= 3, `Expected at least 3 keys, got ${keys.length}`);
  });

  // ── Test 5: Balance query ─────────────────────────────────────────────────
  await test('Balance query returns a number', async () => {
    const wallet = registry.getOrCreate('test-balance');
    const balance = await wallet.getSOLBalance();
    assert(typeof balance === 'number', 'Balance should be a number');
    assert(balance >= 0, 'Balance should be non-negative');
  });

  const skipNetwork = (process.env.SKIP_NETWORK_TESTS || 'false') === 'true';
  if (!skipNetwork) {
    await test('Airdrop on devnet succeeds', async () => {
      const wallet = registry.getOrCreate('test-airdrop');
      try {
        const sig = await wallet.requestAirdrop(0.5);
        assert(typeof sig === 'string' && sig.length > 20, 'Should return valid signature');
        const balance = await wallet.getSOLBalance();
        assert(balance >= 0.5, `Balance should be ≥ 0.5 SOL after airdrop, got ${balance}`);
      } catch (err) {
        const msg = String(err);
        if (msg.includes('429') || msg.toLowerCase().includes('faucet') || msg.includes('Internal error')) {
          console.log(chalk.yellow('    Skipping: devnet faucet unavailable or rate-limited'));
          networkDegraded = true;
          return;
        }
        throw err;
      }
    });
  } else {
    console.log(chalk.yellow('Skipping airdrop test due to SKIP_NETWORK_TESTS=true'));
  }

  if (!skipNetwork) {
    await test('Autonomous SOL transfer signs and confirms on-chain', async () => {
      if (networkDegraded) {
        console.log(chalk.yellow('    Skipping transfer test due to devnet faucet issues'));
        return;
      }
      const sender = registry.getOrCreate('test-sender');
      const receiver = registry.getOrCreate('test-receiver');
      const senderBal = await sender.getSOLBalance();
      if (senderBal < 0.1) {
        try {
          await sender.requestAirdrop(0.5);
        } catch (err) {
          const msg = String(err);
          if (msg.includes('429') || msg.toLowerCase().includes('faucet') || msg.includes('Internal error')) {
            console.log(chalk.yellow('    Skipping: devnet faucet unavailable or rate-limited'));
            networkDegraded = true;
            return;
          }
          throw err;
        }
      }
      const preBalance = await receiver.getSOLBalance();
      await sender.sendSOL(receiver.publicKey, 0.01);
      await sleep(1000);
      const postBalance = await receiver.getSOLBalance();
      assert(postBalance > preBalance, `Receiver balance should increase: ${preBalance} → ${postBalance}`);
    });
  } else {
    console.log(chalk.yellow('Skipping transfer test due to SKIP_NETWORK_TESTS=true'));
  }

  if (!skipNetwork) {
    await test('Transaction history is recorded', async () => {
      if (networkDegraded) {
        console.log(chalk.yellow('    Skipping history test due to devnet faucet issues'));
        return;
      }
      const wallet = registry.get('test-sender')!;
      const history = wallet.getTransactionHistory();
      assert(history.length > 0, 'Should have at least one recorded transaction');
      assert(history.some((t) => t.status === 'confirmed'), 'Should have confirmed tx');
    });
  } else {
    console.log(chalk.yellow('Skipping history test due to SKIP_NETWORK_TESTS=true'));
  }

  // ── Test 9: Registry snapshot ─────────────────────────────────────────────
  await test('Registry balance snapshot returns all agents', async () => {
    const snapshot = await registry.snapshotBalances();
    assert(snapshot.length === registry.count(), 'Snapshot count should match registry count');
  });

  // ── Test 10: Key deletion ─────────────────────────────────────────────────
  await test('Key deletion removes from disk', async () => {
    const tempId = 'test-delete-me';
    registry.getOrCreate(tempId);
    keyManager.deleteKey(tempId);
    assert(!keyManager.hasKey(tempId), 'Key should not exist after deletion');
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${chalk.green(`✔ ${passed} passed`)}  ${failed > 0 ? chalk.red(`✘ ${failed} failed`) : ''}`);

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
