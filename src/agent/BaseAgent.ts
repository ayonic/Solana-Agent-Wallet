/**
 * BaseAgent.ts
 * Abstract base class for AI agents. Agents have:
 *  - Their own wallet (isolated key + funds)
 *  - A decision-making cycle (think → decide → act)
 *  - State machine: idle → thinking → acting → idle
 *  - Full observability via event emitter
 */

import { EventEmitter } from 'events';
import { AgentWallet } from '../wallet/AgentWallet';
import { logger } from '../utils/logger';
import { metrics } from '../metrics/Metrics';
import * as fs from 'fs';
import * as path from 'path';

export type AgentState = 'idle' | 'thinking' | 'acting' | 'paused' | 'stopped';

export interface AgentAction {
  type: string;
  params: Record<string, unknown>;
  reasoning: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  wallet: AgentWallet;
  cycleMs?: number;
  maxCycles?: number;
}

export abstract class BaseAgent extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly wallet: AgentWallet;

  protected state: AgentState = 'idle';
  protected cycleCount = 0;
  protected readonly cycleMs: number;
  protected readonly maxCycles: number;
  private cycleTimer: NodeJS.Timeout | null = null;
  private eventLogPath: string;

  constructor(config: AgentConfig) {
    super();
    this.id = config.id;
    this.name = config.name;
    this.wallet = config.wallet;
    this.cycleMs = config.cycleMs || 5000;
    this.maxCycles = config.maxCycles || Infinity;
    this.eventLogPath = process.env.EVENT_LOG_PATH || path.resolve(process.cwd(), 'agent-events.log.jsonl');
  }

  /** Start the autonomous decision loop */
  start(): void {
    if (this.state === 'stopped') throw new Error('Agent is stopped, cannot restart');
    this.state = 'idle';
    logger.info(`[${this.name}] Starting autonomous loop (interval: ${this.cycleMs}ms)`);
    this.emit('started', { agentId: this.id });
    this.logEvent({ type: 'started', agentId: this.id, ts: Date.now() });
    this.scheduleNextCycle();
  }

  /** Pause the agent (can be resumed) */
  pause(): void {
    if (this.cycleTimer) clearTimeout(this.cycleTimer);
    this.state = 'paused';
    this.emit('paused', { agentId: this.id });
    logger.info(`[${this.name}] Paused`);
    this.logEvent({ type: 'paused', agentId: this.id, ts: Date.now() });
  }

  /** Resume after pause */
  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'idle';
    this.emit('resumed', { agentId: this.id });
    this.logEvent({ type: 'resumed', agentId: this.id, ts: Date.now() });
    this.scheduleNextCycle();
  }

  /** Permanently stop */
  stop(): void {
    if (this.cycleTimer) clearTimeout(this.cycleTimer);
    this.state = 'stopped';
    this.emit('stopped', { agentId: this.id, cycles: this.cycleCount });
    logger.info(`[${this.name}] Stopped after ${this.cycleCount} cycles`);
    this.logEvent({ type: 'stopped', agentId: this.id, cycles: this.cycleCount, ts: Date.now() });
  }

  getState(): AgentState {
    return this.state;
  }

  getCycleCount(): number {
    return this.cycleCount;
  }

  // ─── Internal loop ────────────────────────────────────────────────────────

  private scheduleNextCycle(): void {
    if (this.state === 'stopped' || this.state === 'paused') return;
    if (this.cycleCount >= this.maxCycles) {
      this.stop();
      return;
    }
    this.cycleTimer = setTimeout(() => this.runCycle(), this.cycleMs);
  }

  private async runCycle(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'paused') return;

    this.cycleCount++;
    this.state = 'thinking';
    this.emit('cycle_start', { agentId: this.id, cycle: this.cycleCount });
    metrics.incCycle(this.id);
    this.logEvent({ type: 'cycle_start', agentId: this.id, cycle: this.cycleCount, ts: Date.now() });

    try {
      const minBalance = parseFloat(process.env.MIN_BALANCE_SOL || '0');
      if (minBalance > 0) {
        const balance = await this.wallet.getSOLBalance();
        if (balance < minBalance) {
          this.state = 'paused';
          this.emit('paused', { agentId: this.id });
          logger.warn(`[${this.name}] Paused due to low balance: ${balance.toFixed(4)} SOL < ${minBalance} SOL`);
          this.logEvent({ type: 'balance_paused', agentId: this.id, balance, minBalance, ts: Date.now() });
          return;
        }
      }
      // 1. Observe environment
      const observation = await this.observe();

      // 2. Think and decide
      const action = await this.think(observation);

      if (action) {
        // 3. Act
        this.state = 'acting';
        this.emit('action', { agentId: this.id, action, cycle: this.cycleCount });
        this.logEvent({ type: 'action', agentId: this.id, action, cycle: this.cycleCount, ts: Date.now() });
        await this.act(action);
      }

      this.state = 'idle';
      this.emit('cycle_end', { agentId: this.id, cycle: this.cycleCount, action });
      this.logEvent({ type: 'cycle_end', agentId: this.id, cycle: this.cycleCount, ts: Date.now() });
    } catch (err) {
      logger.error(`[${this.name}] Cycle ${this.cycleCount} error: ${err}`);
      this.emit('error', { agentId: this.id, error: err, cycle: this.cycleCount });
      this.logEvent({ type: 'error', agentId: this.id, cycle: this.cycleCount, error: String(err), ts: Date.now() });
      metrics.incError();
      this.state = 'idle';
    }

    this.scheduleNextCycle();
  }

  // ─── Abstract hooks ───────────────────────────────────────────────────────

  /** Gather current state: balances, prices, positions, etc. */
  protected abstract observe(): Promise<Record<string, unknown>>;

  /** Analyze observation and decide what to do next (return null for no-op) */
  protected abstract think(observation: Record<string, unknown>): Promise<AgentAction | null>;

  /** Execute the chosen action using the wallet */
  protected abstract act(action: AgentAction): Promise<void>;

  // ─── Utility ──────────────────────────────────────────────────────────────

  protected log(msg: string): void {
    logger.info(`[${this.name}] ${msg}`);
  }

  getSummary() {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      cycleCount: this.cycleCount,
      wallet: this.wallet.getSummary(),
    };
  }

  private logEvent(event: Record<string, unknown>): void {
    try {
      const line = JSON.stringify({ ...event, name: this.name }) + '\n';
      fs.appendFileSync(this.eventLogPath, line);
    } catch {}
  }
}
