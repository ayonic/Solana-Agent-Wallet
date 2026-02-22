/**
 * MockPoolOracle.ts
 * Simulates an AMM pool state for devnet testing.
 * In production, query an actual Raydium / Orca pool on-chain.
 */

export interface PoolState {
  tokenAReserve: number;
  tokenBReserve: number;
  ratio: number;
  imbalancePct: number;
  volume24h: number;
  fee: number;
}

export class MockPoolOracle {
  private poolAddress: string;
  private reserveA = 10000;
  private reserveB = 10000;
  private targetRatio = 1.0;

  constructor(poolAddress: string) {
    this.poolAddress = poolAddress;
  }

  async getPoolState(): Promise<PoolState> {
    // Simulate random trade activity shifting reserves
    const tradeSize = (Math.random() - 0.45) * 200; // slight buy pressure
    this.reserveA = Math.max(100, this.reserveA - tradeSize);
    this.reserveB = Math.max(100, this.reserveB + tradeSize * (Math.random() * 0.1 + 0.95));

    const ratio = this.reserveA / this.reserveB;
    const imbalancePct = ((ratio - this.targetRatio) / this.targetRatio) * 100;
    const volume24h = Math.abs(tradeSize) * (20 + Math.random() * 50);

    return {
      tokenAReserve: this.reserveA,
      tokenBReserve: this.reserveB,
      ratio,
      imbalancePct,
      volume24h,
      fee: 0.003, // 0.3% like Uniswap v2
    };
  }
}
