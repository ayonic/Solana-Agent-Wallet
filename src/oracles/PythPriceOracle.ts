import { logger } from '../utils/logger';

export class PythPriceOracle {
  private feedId: string;
  private lastPrice: number | null = null;
  private lastTs: number = 0;

  constructor(feedId: string) {
    this.feedId = feedId;
  }

  async getPrice(): Promise<number> {
    try {
      const url = `https://hermes.pyth.network/api/v2/updates/price/latest?ids[]=${this.feedId}&verbose=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Pyth fetch failed: ${res.status} ${res.statusText}`);
      const data = (await res.json()) as any;
      const feed = data.parsed[0];
      const priceInfo = feed.price?.price;
      const expo = feed.price?.expo;
      if (typeof priceInfo !== 'number' || typeof expo !== 'number') throw new Error('Invalid Pyth response');
      const price = priceInfo * Math.pow(10, expo);
      this.lastPrice = price;
      this.lastTs = Date.now();
      return price;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[Pyth] Fetch failed, fallback: ${msg}`);
      if (this.lastPrice !== null) return this.lastPrice;
      return 0;
    }
  }

  isStale(maxMs: number): boolean {
    if (maxMs <= 0) return false;
    return Date.now() - this.lastTs > maxMs;
  }
}
