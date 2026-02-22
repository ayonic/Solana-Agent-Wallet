/**
 * TradingAgent.ts
 * An AI agent that simulates autonomous trading decisions.
 *
 * Strategy: Simple trend-following with a mock price oracle.
 *  - Observes simulated price feed
 *  - Calculates moving average and momentum
 *  - Decides to BUY, SELL, or HOLD
 *  - Executes SOL transfers as proxy for trades on devnet
 *
 * In production, replace the mock oracle with Pyth or Switchboard,
 * and the simulated DEX calls with Jupiter aggregator swaps.
 */

import { BaseAgent, AgentAction, AgentConfig } from './BaseAgent';
import { MockPriceOracle } from '../protocols/MockPriceOracle';
import { createPriceOracle } from '../oracles/OracleFactory';
import { DexAdapter } from '../protocols/DexAdapter';
import { createDex } from '../protocols/DexFactory';
import { logger } from '../utils/logger';

export interface TradingAgentConfig extends AgentConfig {
  tradingPair?: string;
  maxPositionSOL?: number;
  spreadThreshold?: number; // min price delta % to trigger trade
  counterpartyAddress?: string; // devnet address to simulate trades against
}

interface PriceHistory {
  price: number;
  timestamp: Date;
}

export class TradingAgent extends BaseAgent {
  private oracle: { getPrice: () => Promise<number> };
  private dex: DexAdapter;
  private priceHistory: PriceHistory[] = [];
  private tradingPair: string;
  private maxPositionSOL: number;
  private spreadThreshold: number;
  private counterpartyAddress: string;
  private position: 'long' | 'none' = 'none';
  private entryPrice = 0;

  constructor(config: TradingAgentConfig) {
    super(config);
    this.oracle = createPriceOracle(config.tradingPair || 'SOL/USDC');
    this.dex = createDex(config.wallet);
    this.tradingPair = config.tradingPair || 'SOL/USDC';
    this.maxPositionSOL = config.maxPositionSOL || 0.1;
    this.spreadThreshold = config.spreadThreshold || 0.5;
    this.counterpartyAddress =
      config.counterpartyAddress || '11111111111111111111111111111111';
  }

  protected async observe(): Promise<Record<string, unknown>> {
    const [price, balance] = await Promise.all([
      this.oracle.getPrice(),
      this.wallet.getSOLBalance(),
    ]);

    this.priceHistory.push({ price, timestamp: new Date() });
    if (this.priceHistory.length > 20) this.priceHistory.shift();

    const ma5 = this.movingAverage(5);
    const ma10 = this.movingAverage(10);
    const momentum = this.priceHistory.length >= 3
      ? ((price - this.priceHistory[this.priceHistory.length - 3].price) / price) * 100
      : 0;

    return {
      price,
      ma5,
      ma10,
      momentum,
      balance,
      position: this.position,
      entryPrice: this.entryPrice,
      historyLength: this.priceHistory.length,
      unrealizedPnL:
        this.position === 'long' && this.entryPrice > 0
          ? ((price - this.entryPrice) / this.entryPrice) * 100
          : 0,
    };
  }

  protected async think(obs: Record<string, unknown>): Promise<AgentAction | null> {
    const { price, ma5, ma10, momentum, balance, position, unrealizedPnL } = obs as {
      price: number;
      ma5: number;
      ma10: number;
      momentum: number;
      balance: number;
      position: string;
      unrealizedPnL: number;
    };

    // Need enough history before trading
    if (this.priceHistory.length < 5) {
      this.log(`Accumulating price history (${this.priceHistory.length}/5)…`);
      return null;
    }

    // ── Decision logic ─────────────────────────────────────────
    // BUY signal: short MA crosses above long MA + positive momentum
    const bullishCrossover = ma5 > ma10 && momentum > this.spreadThreshold;
    // SELL signal: stop-loss at -2% or take profit at +3%
    const shouldCutLoss = position === 'long' && (unrealizedPnL as number) < -2;
    const shouldTakeProfit = position === 'long' && (unrealizedPnL as number) > 3;
    // SELL signal: bearish crossover
    const bearishCrossover = ma5 < ma10 && momentum < -this.spreadThreshold;

    const hasEnoughBalance = balance > this.maxPositionSOL + 0.01; // keep 0.01 for fees

    if (position === 'none' && bullishCrossover && hasEnoughBalance) {
      return {
        type: 'BUY',
        params: { amount: this.maxPositionSOL, price, counterparty: this.counterpartyAddress },
        reasoning: `MA crossover bullish (MA5=${ma5.toFixed(2)} > MA10=${ma10.toFixed(2)}), momentum=${momentum.toFixed(2)}%`,
      };
    }

    if (position === 'long' && (shouldCutLoss || shouldTakeProfit || bearishCrossover)) {
      const reason = shouldCutLoss
        ? `Stop-loss triggered (PnL=${(unrealizedPnL as number).toFixed(2)}%)`
        : shouldTakeProfit
        ? `Take-profit triggered (PnL=${(unrealizedPnL as number).toFixed(2)}%)`
        : `Bearish crossover (MA5=${ma5.toFixed(2)} < MA10=${ma10.toFixed(2)})`;
      return {
        type: 'SELL',
        params: { amount: this.maxPositionSOL, price, counterparty: this.counterpartyAddress },
        reasoning: reason,
      };
    }

    this.log(
      `HOLD | Price=${price.toFixed(2)} MA5=${ma5.toFixed(2)} MA10=${ma10.toFixed(2)} Mom=${momentum.toFixed(2)}% Pos=${position}`
    );
    return null;
  }

  protected async act(action: AgentAction): Promise<void> {
    const { type, params } = action;

    if (type === 'BUY') {
      this.log(`BUY ${params.amount} SOL @ ${(params.price as number).toFixed(2)} — ${action.reasoning}`);
      await this.dex.buy(params.amount as number);
      this.position = 'long';
      this.entryPrice = params.price as number;
    } else if (type === 'SELL') {
      this.log(`SELL ${params.amount} SOL @ ${(params.price as number).toFixed(2)} — ${action.reasoning}`);
      await this.dex.sell(params.amount as number);
      this.position = 'none';
      this.entryPrice = 0;
    }
  }

  private movingAverage(periods: number): number {
    const slice = this.priceHistory.slice(-periods);
    if (slice.length === 0) return 0;
    return slice.reduce((sum, p) => sum + p.price, 0) / slice.length;
  }
}
