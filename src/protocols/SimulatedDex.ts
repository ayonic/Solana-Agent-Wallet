/**
 * SimulatedDex.ts
 * Wraps AgentWallet to simulate DEX interactions on devnet.
 * Executes real on-chain transactions (SOL transfers) as stand-ins
 * for swap instructions, demonstrating autonomous signing.
 *
 * In production: replace with Jupiter aggregator CPI calls or
 * direct Orca/Raydium instruction construction.
 */

import { AgentWallet } from '../wallet/AgentWallet';
import { logger } from '../utils/logger';
import { DexAdapter } from './DexAdapter';

// Devnet "pool" address — a known devnet account used as the counterparty
const DEVNET_POOL_ADDRESS = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const MIN_TRADE_SOL = 0.001; // lamport buffer for fees

export class SimulatedDex implements DexAdapter {
  private wallet: AgentWallet;
  private totalBuyVolume = 0;
  private totalSellVolume = 0;
  private tradeCount = 0;

  constructor(wallet: AgentWallet) {
    this.wallet = wallet;
  }

  /** Simulate buying: send SOL to pool address as proxy for swap-in */
  async buy(amountSOL: number): Promise<string | null> {
    const balance = await this.wallet.getSOLBalance();
    if (balance < amountSOL + MIN_TRADE_SOL) {
      logger.warn(`[DEX] Insufficient balance for buy. Have ${balance.toFixed(4)}, need ${amountSOL}`);
      return null;
    }

    try {
      // Real on-chain TX on devnet demonstrating autonomous signing
      const sig = await this.wallet.sendSOL(DEVNET_POOL_ADDRESS, amountSOL);
      this.totalBuyVolume += amountSOL;
      this.tradeCount++;
      logger.info(`[DEX] BUY executed: ${amountSOL} SOL | sig: ${sig.slice(0, 20)}…`);
      return sig;
    } catch (err) {
      logger.warn(`[DEX] Buy simulation skipped (devnet): ${err}`);
      return null;
    }
  }

  /** Simulate selling: record the action (receiving SOL from pool not simulated) */
  async sell(amountSOL: number): Promise<string | null> {
    this.totalSellVolume += amountSOL;
    this.tradeCount++;
    logger.info(`[DEX] SELL recorded: ${amountSOL} SOL (position closed)`);
    // In production: call Jupiter or pool withdraw instruction
    return null;
  }

  getStats() {
    return {
      tradeCount: this.tradeCount,
      totalBuyVolume: this.totalBuyVolume,
      totalSellVolume: this.totalSellVolume,
      netFlow: this.totalBuyVolume - this.totalSellVolume,
    };
  }
}
