/**
 * DashboardServer.ts
 * Web-based dashboard for monitoring Solana agent wallets with real-time metrics
 *
 * Developed by: Ayodeji Ajide
 * Signature: AYDot...
 * Date: February 2026
 */

import express, { Request, Response } from 'express';
import { Server } from 'http';
import { Socket, Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { WalletRegistry } from '../wallet/WalletRegistry';
import { KeyManager } from '../wallet/KeyManager';
import { createConnection } from '../utils/connection';
import { logger } from '../utils/logger';

export class DashboardServer {
  private app: express.Application;
  private server: Server;
  private io: SocketIOServer;
  private port: number;
  private registry!: WalletRegistry;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.setupExpress();
    this.server = new Server(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
  }

  private setupExpress(): void {
    // Serve static files from public directory
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    // Serve the main dashboard page
    this.app.get('/', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // API endpoints
    this.app.get('/api/agents', async (req: Request, res: Response) => {
      try {
        const balances = await this.registry.snapshotBalances();
        const agents = this.registry.getAll().map(wallet => {
          const summary = wallet.getSummary();
          const balance = balances.find(b => b.agentId === summary.agentId)?.sol || 0;
          
          return {
            id: summary.agentId,
            name: summary.label,
            publicKey: summary.publicKey,
            balance: balance,
            txCount: summary.txCount,
            state: 'active', // This would come from actual agent state in a full implementation
            lastActivity: summary.lastActivity
          };
        });
        
        res.json(agents);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    this.app.get('/api/metrics', (req: Request, res: Response) => {
      // This would integrate with the Metrics system
      res.json({
        totalTx: 0, // Would come from actual metrics
        confirmedTx: 0,
        failedTx: 0,
        errors: 0,
        timestamp: new Date().toISOString()
      });
    });
  }

  public async initialize(registry: WalletRegistry): Promise<void> {
    this.registry = registry;
    
    // Set up Socket.IO events
    this.io.on('connection', (socket: Socket) => {
      logger.info('Dashboard client connected');

      // Send initial data
      this.sendInitialData(socket);

      // Handle periodic updates
      const interval = setInterval(async () => {
        await this.sendUpdates(socket);
      }, 5000); // Update every 5 seconds

      socket.on('disconnect', () => {
        logger.info('Dashboard client disconnected');
        clearInterval(interval);
      });

      socket.on('agent-control', (data) => {
        // Handle agent control commands
        logger.info(`Received agent control: ${JSON.stringify(data)}`);
      });
    });
  }

  private async sendInitialData(socket: Socket): Promise<void> {
    try {
      const balances = await this.registry.snapshotBalances();
      const agents = this.registry.getAll().map(wallet => {
        const summary = wallet.getSummary();
        const balance = balances.find(b => b.agentId === summary.agentId)?.sol || 0;
        
        return {
          id: summary.agentId,
          name: summary.label,
          publicKey: summary.publicKey,
          balance: balance,
          txCount: summary.txCount,
          state: 'active',
          lastActivity: summary.lastActivity
        };
      });

      socket.emit('initial-data', {
        agents,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`Error sending initial data: ${(error as Error).message}`);
    }
  }

  private async sendUpdates(socket: Socket): Promise<void> {
    try {
      const balances = await this.registry.snapshotBalances();
      const agents = this.registry.getAll().map(wallet => {
        const summary = wallet.getSummary();
        const balance = balances.find(b => b.agentId === summary.agentId)?.sol || 0;
        
        return {
          id: summary.agentId,
          name: summary.label,
          publicKey: summary.publicKey,
          balance: balance,
          txCount: summary.txCount,
          state: 'active',
          lastActivity: summary.lastActivity
        };
      });

      // Get recent transactions
      const recentTransactions = this.getRecentTransactions();

      socket.emit('update', {
        agents,
        transactions: recentTransactions,
        metrics: this.getCurrentMetrics(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`Error sending updates: ${(error as Error).message}`);
    }
  }

  private getRecentTransactions(): any[] {
    // This would return actual recent transactions
    return [];
  }

  private getCurrentMetrics(): any {
    // This would return actual metrics
    return {
      totalTx: 0,
      confirmedTx: 0,
      failedTx: 0,
      errors: 0
    };
  }

  public start(): void {
    this.server.listen(this.port, () => {
      logger.info(`Dashboard server running on http://localhost:${this.port}`);
    });
  }

  public stop(): void {
    this.server.close(() => {
      logger.info('Dashboard server stopped');
    });
  }
}
