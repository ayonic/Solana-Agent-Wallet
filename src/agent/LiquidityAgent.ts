/**
 * LiquidityAgent.ts
 * An AI agent that autonomously manages a liquidity position.
 *
 * Strategy:
 *  - Monitors pool imbalance via mock oracle
 *  - Provides liquidity when imbalance detected (profitable)
 *  - Removes liquidity when impermanent loss threshold exceeded
 *  - Rebalances position periodically
 *
 * On devnet, executed as real SOL transfers to a simulated pool address.
 */

import { PublicKey } from '@solana/web3.js';
import { BaseAgent, AgentAction, AgentConfig } from './BaseAgent';
import { MockPoolOracle } from '../protocols/MockPoolOracle';
import { createPoolOracle } from '../oracles/OracleFactory';
import { logger } from '../utils/logger';

export interface LiquidityAgentConfig extends AgentConfig {
  poolAddress?: string;
  targetImbalanceThreshold?: number; // % imbalance to trigger provide
  impermanentLossLimit?: number;     // % IL to trigger remove
  maxLiquiditySOL?: number;
}

export class LiquidityAgent extends BaseAgent {
  private poolOracle: { getPoolState: () => Promise<{ tokenAReserve: number; tokenBReserve: number; ratio: number; imbalancePct: number; volume24h: number; fee: number }> };
  private poolAddress: string;
  private targetImbalanceThreshold: number;
  private impermanentLossLimit: number;
  private maxLiquiditySOL: number;
  private providedLiquidity = 0;
  private entryPoolRatio = 0;

  constructor(config: LiquidityAgentConfig) {
    super(config);
    this.poolAddress = config.poolAddress || PublicKey.default.toBase58();
    this.targetImbalanceThreshold = config.targetImbalanceThreshold || 5;
    this.impermanentLossLimit = config.impermanentLossLimit || 3;
    this.maxLiquiditySOL = config.maxLiquiditySOL || 0.2;
    this.poolOracle = createPoolOracle(this.poolAddress);
  }

  protected async observe(): Promise<Record<string, unknown>> {
    const [poolState, balance] = await Promise.all([
      this.poolOracle.getPoolState(),
      this.wallet.getSOLBalance(),
    ]);

    const currentIL =
      this.providedLiquidity > 0 && this.entryPoolRatio > 0
        ? this.calculateIL(this.entryPoolRatio, poolState.ratio)
        : 0;

    return {
      ...poolState,
      balance,
      providedLiquidity: this.providedLiquidity,
      currentIL,
      hasPosition: this.providedLiquidity > 0,
    };
  }

  protected async think(obs: Record<string, unknown>): Promise<AgentAction | null> {
    const { imbalancePct, currentIL, balance, hasPosition, ratio, volume24h } = obs as {
      imbalancePct: number;
      currentIL: number;
      balance: number;
      hasPosition: boolean;
      ratio: number;
      volume24h: number;
    };

    // Remove liquidity if IL exceeds limit
    if (hasPosition && Math.abs(currentIL) > this.impermanentLossLimit) {
      return {
        type: 'REMOVE_LIQUIDITY',
        params: { amount: this.providedLiquidity },
        reasoning: `Impermanent loss of ${currentIL.toFixed(2)}% exceeds limit of ${this.impermanentLossLimit}%`,
      };
    }

    // Provide liquidity when pool is imbalanced and we have capital
    const canProvide = !hasPosition && balance > this.maxLiquiditySOL + 0.01;
    if (canProvide && Math.abs(imbalancePct) > this.targetImbalanceThreshold) {
      return {
        type: 'PROVIDE_LIQUIDITY',
        params: { amount: this.maxLiquiditySOL, targetRatio: ratio },
        reasoning: `Pool imbalance of ${imbalancePct.toFixed(2)}% detected, volume: ${volume24h.toFixed(0)} SOL/24h`,
      };
    }

    // Rebalance existing position if imbalance grew significantly
    if (hasPosition && Math.abs(imbalancePct) > this.targetImbalanceThreshold * 2) {
      return {
        type: 'REBALANCE',
        params: { newRatio: ratio },
        reasoning: `Rebalancing due to significant imbalance: ${imbalancePct.toFixed(2)}%`,
      };
    }

    this.log(
      `MONITORING | Imbalance=${imbalancePct.toFixed(2)}% IL=${currentIL.toFixed(2)}% Position=${this.providedLiquidity.toFixed(4)} SOL`
    );
    return null;
  }

  protected async act(action: AgentAction): Promise<void> {
    switch (action.type) {
      case 'PROVIDE_LIQUIDITY': {
        const amount = action.params.amount as number;
        this.log(`PROVIDE ${amount} SOL → pool ${this.poolAddress.slice(0, 8)}… | ${action.reasoning}`);
        // Send SOL to pool address as proxy for LP deposit on devnet
        await this.wallet.sendSOL(this.poolAddress.slice(0, 44), amount);
        this.providedLiquidity += amount;
        this.entryPoolRatio = action.params.targetRatio as number;
        break;
      }

      case 'REMOVE_LIQUIDITY': {
        this.log(`REMOVE ${this.providedLiquidity.toFixed(4)} SOL from pool | ${action.reasoning}`);
        // In production: call pool's withdraw instruction
        this.providedLiquidity = 0;
        this.entryPoolRatio = 0;
        break;
      }

      case 'REBALANCE': {
        this.log(`REBALANCE position | ${action.reasoning}`);
        this.entryPoolRatio = action.params.newRatio as number;
        break;
      }
    }
  }

  /** Standard IL formula: IL = 2*sqrt(r) / (1+r) - 1, where r = priceRatio */
  private calculateIL(entryRatio: number, currentRatio: number): number {
    if (entryRatio === 0) return 0;
    const r = currentRatio / entryRatio;
    const il = (2 * Math.sqrt(r)) / (1 + r) - 1;
    return il * 100;
  }
}
