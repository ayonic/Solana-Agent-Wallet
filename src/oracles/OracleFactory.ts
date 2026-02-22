import { MockPriceOracle } from '../protocols/MockPriceOracle';
import { MockPoolOracle } from '../protocols/MockPoolOracle';
import { PythPriceOracle } from './PythPriceOracle';

export interface PriceOracle {
  getPrice(): Promise<number>;
}

export interface PoolOracle {
  getPoolState(): Promise<{
    tokenAReserve: number;
    tokenBReserve: number;
    ratio: number;
    imbalancePct: number;
    volume24h: number;
    fee: number;
  }>;
}

class StaleGuard {
  private maxStalenessMs: number;
  constructor(maxMs: number) {
    this.maxStalenessMs = maxMs;
  }
  assertFresh(timestamp: number) {
    if (this.maxStalenessMs <= 0) return;
    const age = Date.now() - timestamp;
    if (age > this.maxStalenessMs) {
      throw new Error(`Oracle data stale: ${age}ms > ${this.maxStalenessMs}ms`);
    }
  }
}

export function createPriceOracle(pair: string): PriceOracle {
  const source = (process.env.ORACLE_SOURCE || 'mock').toLowerCase();
  const maxStale = parseInt(process.env.ORACLE_MAX_STALENESS_MS || '0');
  const guard = new StaleGuard(maxStale);
  if (source === 'pyth') {
    const feedId = process.env.PYTH_FEED_ID || '';
    const pyth = new PythPriceOracle(feedId);
    const mock = new MockPriceOracle(pair);
    return {
      async getPrice() {
        const price = await pyth.getPrice();
        if (price > 0) {
          if (guard) guard.assertFresh(Date.now());
          return price;
        }
        const fallback = await mock.getPrice();
        return fallback;
      },
    };
  } else {
    const oracle = new MockPriceOracle(pair);
    return {
      async getPrice() {
        const price = await oracle.getPrice();
        guard.assertFresh(Date.now());
        return price;
      },
    };
  }
}

export function createPoolOracle(addr: string): PoolOracle {
  const source = (process.env.ORACLE_SOURCE || 'mock').toLowerCase();
  const maxStale = parseInt(process.env.ORACLE_MAX_STALENESS_MS || '0');
  const guard = new StaleGuard(maxStale);
  if (source === 'mock') {
    const oracle = new MockPoolOracle(addr);
    return {
      async getPoolState() {
        const state = await oracle.getPoolState();
        guard.assertFresh(Date.now());
        return state;
      },
    };
  }
  const oracle = new MockPoolOracle(addr);
  return {
    async getPoolState() {
      const state = await oracle.getPoolState();
      guard.assertFresh(Date.now());
      return state;
    },
  };
}
