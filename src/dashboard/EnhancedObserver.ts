/**
 * EnhancedObserver.ts
 * Advanced CLI dashboard using blessed for better visualizations
 *
 * Developed by: Ayodeji Ajide
 * Signature: AYDot...
 * Date: February 2026
 */

import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import { WalletRegistry } from '../wallet/WalletRegistry';
import { KeyManager } from '../wallet/KeyManager';
import { createConnection } from '../utils/connection';
import { logger } from '../utils/logger';

export class EnhancedObserver {
  private screen!: blessed.Widgets.Screen;
  private grid!: contrib.grid;
  private registry!: WalletRegistry;
  private intervalId: NodeJS.Timeout | null = null;
  
  private agentTable!: contrib.Widgets.TableElement;
  private balanceChart!: contrib.Widgets.BarElement;
  private metricsBox: any;
  private logBox!: contrib.Widgets.LogElement;
  private statusLine: any;

  constructor() {
    this.initializeScreen();
    this.createWidgets();
    this.setupEventHandlers();
  }

  private initializeScreen(): void {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Solana Agentic Wallet - Enhanced Observer',
      fullUnicode: true,
      dockBorders: true,
      ignoreDockContrast: true
    });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });
  }

  private createWidgets(): void {
    // Agent table (top-left)
    this.agentTable = this.grid.set(0, 0, 6, 8, contrib.table, {
      keys: true,
      fg: 'white',
      bg: 'black',
      columnSpacing: 2,
      columnWidth: [15, 15, 25, 12, 8, 15],
      interactive: true,
      label: 'Agent Status',
      border: { type: 'line', fg: 'cyan' },
      columnHeaders: ['ID', 'Name', 'Public Key', 'Balance', 'Txs', 'Status']
    });

    // Balance chart (top-right)
    this.balanceChart = this.grid.set(0, 8, 6, 4, contrib.bar, {
      label: 'Balance Distribution',
      barWidth: 6,
      barSpacing: 6,
      xOffset: 3,
      maxHeight: 10,
      fg: 'green',
      labelColor: 'cyan',
      border: { type: 'line', fg: 'cyan' }
    });

    // Metrics box (middle-left)
    this.metricsBox = this.grid.set(6, 0, 3, 6, blessed.box, {
      label: 'System Metrics',
      content: '',
      tags: true,
      border: { type: 'line', fg: 'yellow' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'yellow' }
      }
    });

    // Log box (middle-right)
    this.logBox = this.grid.set(6, 6, 3, 6, contrib.log, {
      fg: 'green',
      selectedFg: 'green',
      label: 'Event Log',
      border: { type: 'line', fg: 'green' },
      scrollback: 1000,
      mouse: true
    });

    // Status line (bottom)
    this.statusLine = this.grid.set(9, 0, 3, 12, blessed.text, {
      content: '{center}Press Ctrl+C to exit{/center}',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue'
      }
    });

    // Add all widgets to screen
    this.screen.append(this.agentTable);
    this.screen.append(this.balanceChart);
    this.screen.append(this.metricsBox);
    this.screen.append(this.logBox);
    this.screen.append(this.statusLine);
  }

  private setupEventHandlers(): void {
    // Handle key presses
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.stop();
      process.exit(0);
    });

    // Handle resize
    this.screen.on('resize', () => {
      this.render();
    });
  }

  public async initialize(registry: WalletRegistry): Promise<void> {
    this.registry = registry;
    this.logBox.log('Observer initialized. Starting updates...');
    this.startPolling();
  }

  private startPolling(): void {
    this.intervalId = setInterval(async () => {
      try {
        await this.updateDisplay();
      } catch (error) {
        this.logBox.log(`Error updating display: ${(error as Error).message}`);
      }
    }, 5000); // Update every 5 seconds
  }

  private async updateDisplay(): Promise<void> {
    try {
      const balances = await this.registry.snapshotBalances();
      const wallets = this.registry.getAll();

      // Update agent table
      const tableData = [['ID', 'Name', 'Public Key', 'Balance', 'Txs', 'Status']];
      
      wallets.forEach(wallet => {
        const summary = wallet.getSummary();
        const balance = balances.find(b => b.agentId === summary.agentId)?.sol || 0;
        tableData.push([
          summary.agentId,
          summary.label || summary.agentId,
          `${summary.publicKey.substring(0, 8)}...${summary.publicKey.substring(summary.publicKey.length - 4)}`,
          balance.toFixed(4),
          summary.txCount.toString(),
          'ACTIVE' // Placeholder - would get actual agent state
        ]);
      });

      this.agentTable.setData({ headers: tableData[0], data: tableData.slice(1) });

      // Prepare chart data
      const chartLabels: string[] = [];
      const chartData: number[] = [];
      
      wallets.forEach(wallet => {
        const summary = wallet.getSummary();
        const balance = balances.find(b => b.agentId === summary.agentId)?.sol || 0;
        chartLabels.push(summary.label || summary.agentId.substring(0, 10));
        chartData.push(parseFloat(balance.toFixed(4)));
      });

      // Update balance chart
      this.balanceChart.setData({
        titles: chartLabels,
        data: chartData
      });

      // Update metrics box
      const totalBalance = balances.reduce((sum, b) => sum + b.sol, 0);
      const totalTxs = wallets.reduce((sum, w) => sum + w.getSummary().txCount, 0);
      
      this.metricsBox.setContent(`
      {bold}System Metrics{/bold}

      Total Agents: {green}${wallets.length}{/green}
      Total Balance: {cyan}${totalBalance.toFixed(4)} SOL{/cyan}
      Total Transactions: {yellow}${totalTxs}{/yellow}
      Registry Size: {magenta}${this.registry.count()}{/magenta}

      {bold}Performance{/bold}
      Last Update: {white}${new Date().toLocaleTimeString()}{/white}
      `);

      // Render the screen
      this.screen.render();
    } catch (error) {
      this.logBox.log(`Update error: ${(error as Error).message}`);
    }
  }

  public render(): void {
    this.screen.render();
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.logBox.log('Observer stopped.');
  }

  public start(): void {
    this.screen.render();
  }
}
