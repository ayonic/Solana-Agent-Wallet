export interface DexAdapter {
  buy(amountSOL: number): Promise<string | null>;
  sell(amountSOL: number): Promise<string | null>;
  getStats(): { tradeCount: number; totalBuyVolume: number; totalSellVolume: number; netFlow: number };
}
