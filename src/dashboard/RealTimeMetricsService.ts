/**
 * RealTimeMetricsService.ts
 * Service for collecting and broadcasting real-time metrics for dashboard
 *
 * Developed by: Ayodeji Ajide
 * Signature: AYDot...
 * Date: February 2026
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { metrics } from '../metrics/Metrics';
import { WalletRegistry } from '../wallet/WalletRegistry';
import { AgentWallet } from '../wallet/AgentWallet';
import { BaseAgent } from '../agent/BaseAgent';

export interface RealTimeMetrics {
  agents: AgentMetric[];
  system: SystemMetrics;
  transactions: TransactionMetric[];
  performance: PerformanceMetrics;
  timestamp: string;
}

export interface AgentMetric {
  id: string;
  name: string;
  publicKey: string;
  balance: number;
  txCount: number;
  state: string;
  cycleCount: number;
  lastActivity: Date | null;
}

export interface SystemMetrics {
  totalAgents: number;
  totalBalance: number;
  totalTransactions: number;
  totalTx: number;
  confirmedTx: number;
  failedTx: number;
  errors: number;
  successRate: number;
}

export interface TransactionMetric {
  signature: string;
  type: string;
  amount: number;
  from: string;
  to?: string;
  timestamp: Date;
  status: string;
  agentId: string;
}

export interface PerformanceMetrics {
  responseTime: number;
  updateFrequency: number;
  connectedClients: number;
}

export class RealTimeMetricsService {
  private io: SocketIOServer;
  private registry: WalletRegistry;
  private agents: Map<string, BaseAgent> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private connectedSockets: Set<Socket> = new Set();
  private lastUpdateTime: number = 0;

  constructor(io: SocketIOServer, registry: WalletRegistry) {
    this.io = io;
    this.registry = registry;
    this.setupSocketHandlers();
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      this.connectedSockets.add(socket);
      this.broadcastSystemMetrics();

      socket.on('disconnect', () => {
        this.connectedSockets.delete(socket);
      });

      socket.on('request-initial-data', () => {
        this.sendInitialData(socket);
      });

      socket.on('agent-control', (data) => {
        this.handleAgentControl(data, socket);
      });
    });
  }

  private async sendInitialData(socket: Socket): Promise<void> {
    const metrics = await this.collectMetrics();
    socket.emit('initial-data', metrics);
  }

  private handleAgentControl(data: any, socket: Socket): void {
    // Handle agent control commands (start, stop, pause, etc.)
    const { agentId, command, params } = data;
    
    switch (command) {
      case 'start':
        // Implementation would depend on having access to the agent instance
        break;
      case 'stop':
        // Implementation would depend on having access to the agent instance
        break;
      case 'pause':
        // Implementation would depend on having access to the agent instance
        break;
      case 'resume':
        // Implementation would depend on having access to the agent instance
        break;
      default:
        console.log(`Unknown agent command: ${command}`);
    }
  }

  public registerAgent(agent: BaseAgent): void {
    this.agents.set(agent.id, agent);
  }

  public unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  public startBroadcasting(intervalMs: number = 5000): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(async () => {
      try {
        await this.broadcastSystemMetrics();
      } catch (error) {
        console.error('Error broadcasting metrics:', error);
      }
    }, intervalMs);
  }

  public stopBroadcasting(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private async collectMetrics(): Promise<RealTimeMetrics> {
    const startTime = Date.now();
    
    // Collect agent metrics
    const agentMetrics: AgentMetric[] = [];
    const wallets = this.registry.getAll();
    const balances = await this.registry.snapshotBalances();
    
    for (const wallet of wallets) {
      const summary = wallet.getSummary();
      const balance = balances.find(b => b.agentId === summary.agentId)?.sol || 0;
      
      // Try to get agent-specific data if available
      const agent = this.agents.get(summary.agentId);
      const cycleCount = agent ? agent.getCycleCount() : 0;
      const state = agent ? agent.getState() : 'unknown';
      
      agentMetrics.push({
        id: summary.agentId,
        name: summary.label || summary.agentId,
        publicKey: summary.publicKey,
        balance,
        txCount: summary.txCount,
        state,
        cycleCount,
        lastActivity: summary.lastActivity
      });
    }
    
    // Collect system metrics
    const totalBalance = balances.reduce((sum, b) => sum + b.sol, 0);
    const totalTransactions = wallets.reduce((sum, w) => sum + w.getSummary().txCount, 0);
    
    const systemMetrics: SystemMetrics = {
      totalAgents: this.registry.count(),
      totalBalance,
      totalTransactions,
      totalTx: metrics.totalTx,
      confirmedTx: metrics.confirmedTx,
      failedTx: metrics.failedTx,
      errors: metrics.errors,
      successRate: metrics.totalTx > 0 ? (metrics.confirmedTx / metrics.totalTx) * 100 : 0
    };
    
    // Collect transaction metrics (placeholder - would need to get from wallet histories)
    const transactionMetrics: TransactionMetric[] = [];
    
    // Collect performance metrics
    const currentTime = Date.now();
    const responseTime = currentTime - startTime;
    const performanceMetrics: PerformanceMetrics = {
      responseTime,
      updateFrequency: 5000, // From the interval
      connectedClients: this.connectedSockets.size
    };

    return {
      agents: agentMetrics,
      system: systemMetrics,
      transactions: transactionMetrics,
      performance: performanceMetrics,
      timestamp: new Date().toISOString()
    };
  }

  private async broadcastSystemMetrics(): Promise<void> {
    if (this.connectedSockets.size === 0) {
      return; // No need to collect metrics if no one is listening
    }

    try {
      const metrics = await this.collectMetrics();
      
      // Broadcast to all connected clients
      this.io.emit('update', metrics);
      
      this.lastUpdateTime = Date.now();
    } catch (error) {
      console.error('Error collecting or broadcasting metrics:', error);
    }
  }

  public async getAgentMetrics(agentId: string): Promise<AgentMetric | null> {
    const wallet = this.registry.get(agentId);
    if (!wallet) {
      return null;
    }

    const summary = wallet.getSummary();
    const balances = await this.registry.snapshotBalances();
    const balance = balances.find(b => b.agentId === summary.agentId)?.sol || 0;
    
    const agent = this.agents.get(agentId);
    const cycleCount = agent ? agent.getCycleCount() : 0;
    const state = agent ? agent.getState() : 'unknown';

    return {
      id: summary.agentId,
      name: summary.label || summary.agentId,
      publicKey: summary.publicKey,
      balance,
      txCount: summary.txCount,
      state,
      cycleCount,
      lastActivity: summary.lastActivity
    };
  }

  public async getSystemMetrics(): Promise<SystemMetrics> {
    const wallets = this.registry.getAll();
    const balances = await this.registry.snapshotBalances();
    
    const totalBalance = balances.reduce((sum, b) => sum + b.sol, 0);
    const totalTransactions = wallets.reduce((sum, w) => sum + w.getSummary().txCount, 0);
    
    return {
      totalAgents: this.registry.count(),
      totalBalance,
      totalTransactions,
      totalTx: metrics.totalTx,
      confirmedTx: metrics.confirmedTx,
      failedTx: metrics.failedTx,
      errors: metrics.errors,
      successRate: metrics.totalTx > 0 ? (metrics.confirmedTx / metrics.totalTx) * 100 : 0
    };
  }
}