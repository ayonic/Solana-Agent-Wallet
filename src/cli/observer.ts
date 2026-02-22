/**
 * observer.ts
 * Live CLI dashboard for monitoring all active agent wallets.
 * Polls on-chain state every few seconds and renders a table.
 *
 * Run: npm run observe
 */

import * as dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import Table from 'cli-table3';
import { createConnection } from '../utils/connection';
import { KeyManager } from '../wallet/KeyManager';
import { WalletRegistry } from '../wallet/WalletRegistry';
import { EnhancedObserver } from '../dashboard/EnhancedObserver';

const POLL_MS = 6000;

async function clearLine() {
  process.stdout.write('\x1B[2J\x1B[0f');
}

async function renderDashboard(registry: WalletRegistry) {
  const balances = await registry.snapshotBalances();
  const metas = registry.getAll().map((w) => w.getSummary());

  await clearLine();
  console.log(chalk.cyan('\n🤖 Solana Agentic Wallet — Live Observer'));
  console.log(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}\n`));

  const table = new Table({
    head: [
      chalk.white('Agent ID'),
      chalk.white('Label'),
      chalk.white('Public Key'),
      chalk.white('SOL Balance'),
      chalk.white('Tx Count'),
      chalk.white('Last Activity'),
    ],
    colWidths: [18, 16, 48, 14, 10, 22],
    style: { border: ['gray'], head: [] },
  });

  for (const meta of metas) {
    const bal = balances.find((b) => b.agentId === meta.agentId);
    const lastActivity = meta.lastActivity
      ? new Date(meta.lastActivity).toLocaleTimeString()
      : '—';

    table.push([
      chalk.yellow(meta.agentId),
      chalk.white(meta.label || '—'),
      chalk.gray(meta.publicKey),
      chalk.green(`${(bal?.sol ?? 0).toFixed(4)} SOL`),
      chalk.cyan(String(meta.txCount)),
      chalk.gray(lastActivity),
    ]);
  }

  console.log(table.toString());
  console.log(chalk.gray(`\nRefreshing every ${POLL_MS / 1000}s. Press Ctrl+C to exit.\n`));
}

async function main() {
  const connection = createConnection();
  const keyManager = new KeyManager();
  const registry = new WalletRegistry(connection, keyManager);

  const restored = registry.restoreAll();
  if (restored === 0) {
    console.log(chalk.yellow('No agent wallets found. Run `npm run demo` first.'));
    process.exit(0);
  }

  console.log(chalk.green(`Observing ${restored} agent wallet(s)…`));

  // Use enhanced observer instead of basic dashboard
  const observer = new EnhancedObserver();
  await observer.initialize(registry);
  observer.start();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down observer...');
    observer.stop();
    process.exit(0);
  });
}

main().catch(console.error);
