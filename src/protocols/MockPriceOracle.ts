/**
 * MockPriceOracle.ts
 * Simulates a price feed for devnet testing.
 * In production, replace with Pyth Network or Switchboard oracle.
 *
 * Generates realistic price movement using geometric Brownian motion.
 */

export class MockPriceOracle {
  private pair: string;
  private currentPrice: number;
  private volatility: number; // daily vol ~60% annualized
  private drift: number;

  constructor(pair: string, initialPrice = 100, volatility = 0.02, drift = 0.001) {
    this.pair = pair;
    this.currentPrice = initialPrice;
    this.volatility = volatility;
    this.drift = drift;
  }

  async getPrice(): Promise<number> {
    // GBM: dS = S(μdt + σdW)
    const dt = 1;
    const dW = this.gaussianRandom();
    const change = this.currentPrice * (this.drift * dt + this.volatility * Math.sqrt(dt) * dW);
    this.currentPrice = Math.max(0.01, this.currentPrice + change);
    return Math.round(this.currentPrice * 100) / 100;
  }

  getPair(): string {
    return this.pair;
  }

  // Box-Muller transform for Gaussian random number
  private gaussianRandom(): number {
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
}
