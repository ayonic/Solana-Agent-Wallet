/**
 * dashboard.ts
 * CLI command to start the web dashboard
 *
 * Developed by: Ayodeji Ajide
 * Signature: AYDot...
 * Date: February 2026
 */

import * as dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import { createConnection } from '../utils/connection';
import { KeyManager } from '../wallet/KeyManager';
import { WalletRegistry } from '../wallet/WalletRegistry';
import { DashboardServer } from '../dashboard/DashboardServer';
import { RealTimeMetricsService } from '../dashboard/RealTimeMetricsService';

async function main() {
  console.log(chalk.cyan('\n🚀 Starting Solana Agentic Wallet Dashboard\n'));

  const connection = createConnection();
  const keyManager = new KeyManager();
  const registry = new WalletRegistry(connection, keyManager);

  // Restore existing wallets
  const restored = registry.restoreAll();
  console.log(chalk.green(`Restored ${restored} agent wallet(s) from storage`));

  // Create dashboard server
  const dashboardPort = parseInt(process.env.DASHBOARD_PORT || '3000');
  const dashboardServer = new DashboardServer(dashboardPort);
  await dashboardServer.initialize(registry);

  // Create metrics service
  const metricsService = new RealTimeMetricsService(dashboardServer['io'], registry);
  metricsService.startBroadcasting(5000); // Update every 5 seconds

  // Start the dashboard server
  dashboardServer.start();

  console.log(chalk.cyan(`\n🌐 Dashboard available at: http://localhost:${dashboardPort}`));
  console.log(chalk.yellow('Press Ctrl+C to stop the dashboard\n'));

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\nShutting down dashboard...'));
    metricsService.stopBroadcasting();
    dashboardServer.stop();
    process.exit(0);
  });
}

main().catch(error => {
  console.error(chalk.red(`Error starting dashboard: ${error.message}`));
  process.exit(1);
});