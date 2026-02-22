/**
 * index.ts — Main entry point
 * Orchestrates a multi-agent demo on Solana devnet.
 *
 * Run: npm run demo
 */

import * as dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import { createConnection } from './utils/connection';
import { validateConfig } from './utils/config';
import { KeyManager } from './wallet/KeyManager';
import { WalletRegistry } from './wallet/WalletRegistry';
import { TradingAgent } from './agent/TradingAgent';
import { LiquidityAgent } from './agent/LiquidityAgent';
import { logger } from './utils/logger';
import { startMetricsServer } from './metrics/Metrics';
import { DashboardServer } from './dashboard/DashboardServer';
import { RealTimeMetricsService } from './dashboard/RealTimeMetricsService';

const CYCLE_MS = parseInt(process.env.AGENT_CYCLE_MS || '5000');
const AUTO_AIRDROP = process.env.AUTO_AIRDROP !== 'false';
const AIRDROP_SOL = parseFloat(process.env.AIRDROP_AMOUNT_SOL || '1');

async function banner() {
  console.log(chalk.cyan('\n╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║   🤖  Solana Agentic Wallet System — Devnet    ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════════════╝\n'));
}

async function main() {
  validateConfig();
  await banner();

  const connection = createConnection();
  const keyManager = new KeyManager();
  const registry = new WalletRegistry(connection, keyManager);
  const metricsEnabled = (process.env.METRICS_ENABLE || 'true') !== 'false';
  if (metricsEnabled) {
    const port = parseInt(process.env.METRICS_PORT || '9464');
    startMetricsServer(port);
    logger.info(`Metrics server listening on :${port}/metrics`);
  }

  // Initialize dashboard server
  const dashboardEnabled = (process.env.DASHBOARD_ENABLE || 'false') !== 'false';
  let dashboardServer: DashboardServer | null = null;
  let metricsService: RealTimeMetricsService | null = null;

  if (dashboardEnabled) {
    const dashboardPort = parseInt(process.env.DASHBOARD_PORT || '3000');
    dashboardServer = new DashboardServer(dashboardPort);
    await dashboardServer.initialize(registry);
    
    // Initialize metrics service
    metricsService = new RealTimeMetricsService(dashboardServer['io'], registry);
    metricsService.startBroadcasting(5000);
    
    dashboardServer.start();
    logger.info(`Dashboard server listening on :${dashboardPort}`);
  }

  logger.info('Initializing agent wallets…');

  // ── Create 3 independent agent wallets ──────────────────────────────────
  const alphaWallet = registry.getOrCreate('agent-alpha', 'Alpha Trader');
  const betaWallet  = registry.getOrCreate('agent-beta',  'Beta Trader');
  const gammaWallet = registry.getOrCreate('agent-gamma', 'Gamma LP');

  console.log(chalk.green('\n📍 Agent Wallet Addresses:'));
  for (const w of registry.getAll()) {
    console.log(`  ${chalk.yellow(w.agentId.padEnd(15))} → ${chalk.white(w.publicKey)}`);
  }

  // ── Fund wallets via airdrop ─────────────────────────────────────────────
  if (AUTO_AIRDROP) {
    console.log(chalk.blue(`\n💧 Requesting airdrops (${AIRDROP_SOL} SOL each)…`));
    for (const wallet of registry.getAll()) {
      try {
        await wallet.requestAirdrop(AIRDROP_SOL);
        console.log(chalk.green(`  ✔ ${wallet.agentId} funded`));
        await sleep(1500); // throttle airdrop requests
      } catch (err) {
        logger.warn(`Airdrop failed for ${wallet.agentId}: ${err}`);
      }
    }
  }

  // ── Show initial balances ────────────────────────────────────────────────
  console.log(chalk.blue('\n💰 Initial Balances:'));
  const balances = await registry.snapshotBalances();
  for (const b of balances) {
    console.log(`  ${chalk.yellow(b.agentId.padEnd(15))} → ${chalk.white(b.sol.toFixed(4))} SOL`);
  }

  // ── Boot agents ──────────────────────────────────────────────────────────
  console.log(chalk.magenta('\n🚀 Starting autonomous agents…\n'));

  const alpha = new TradingAgent({
    id: 'agent-alpha',
    name: 'Alpha Trader',
    wallet: alphaWallet,
    tradingPair: 'SOL/USDC',
    maxPositionSOL: 0.05,
    spreadThreshold: 0.3,
    cycleMs: CYCLE_MS,
    maxCycles: 20,
  });

  const beta = new TradingAgent({
    id: 'agent-beta',
    name: 'Beta Trader',
    wallet: betaWallet,
    tradingPair: 'SOL/USDT',
    maxPositionSOL: 0.08,
    spreadThreshold: 0.5,
    cycleMs: CYCLE_MS * 1.3,
    maxCycles: 15,
  });

  const gamma = new LiquidityAgent({
    id: 'agent-gamma',
    name: 'Gamma LP',
    wallet: gammaWallet,
    maxLiquiditySOL: 0.1,
    targetImbalanceThreshold: 3,
    impermanentLossLimit: 2,
    cycleMs: CYCLE_MS * 2,
    maxCycles: 10,
  });

  // ── Wire up event listeners for live observation ─────────────────────────
  const agents = [alpha, beta, gamma];

  for (const agent of agents) {
    if (metricsService) {
      metricsService.registerAgent(agent);
    }
    agent.on('action', ({ action, cycle }) => {
      console.log(
        chalk.cyan(`[Cycle ${cycle}]`) +
        chalk.yellow(` ${agent.name}`) +
        chalk.white(` → ${action.type}`) +
        chalk.gray(` | ${action.reasoning}`)
      );
    });

    agent.on('error', ({ error, cycle }) => {
      console.log(chalk.red(`[Cycle ${cycle}] ${agent.name} ERROR: ${error}`));
    });

    agent.on('stopped', ({ cycles }) => {
      console.log(chalk.gray(`\n✋ ${agent.name} completed ${cycles} cycles`));
    });
  }

  // ── Start all agents ─────────────────────────────────────────────────────
  agents.forEach((a) => a.start());

  // ── Wait for all agents to stop ──────────────────────────────────────────
  await Promise.all(agents.map((a) => waitForStop(a)));

  // ── Final report ─────────────────────────────────────────────────────────
  console.log(chalk.cyan('\n╔══════════════════ FINAL REPORT ══════════════════╗'));
  for (const agent of agents) {
    const summary = agent.getSummary();
    const balance = await agent.wallet.getSOLBalance();
    const txs = agent.wallet.getTransactionHistory();
    console.log(
      chalk.yellow(`\n  ${summary.name}`) +
      chalk.white(` (${summary.state})`) +
      `\n  Cycles: ${summary.cycleCount}` +
      `\n  Balance: ${balance.toFixed(4)} SOL` +
      `\n  On-chain txs: ${txs.filter((t) => t.status === 'confirmed').length}`
    );
  }
  console.log(chalk.cyan('\n╚══════════════════════════════════════════════════╝\n'));

  process.exit(0);
}

function waitForStop(agent: { on: (e: string, cb: () => void) => void; getState: () => string }): Promise<void> {
  return new Promise((resolve) => {
    if (agent.getState() === 'stopped') resolve();
    else agent.on('stopped', resolve);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  logger.error(`Fatal: ${err}`);
  process.exit(1);
});
