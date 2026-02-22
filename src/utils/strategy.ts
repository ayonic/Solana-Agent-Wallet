export function calculateIL(entryRatio: number, currentRatio: number): number {
  if (entryRatio === 0) return 0;
  const r = currentRatio / entryRatio;
  const il = (2 * Math.sqrt(r)) / (1 + r) - 1;
  return il * 100;
}

export function crossoverDecision(
  ma5: number,
  ma10: number,
  momentum: number,
  spreadThreshold: number,
  position: 'long' | 'none',
  pnl: number
): 'BUY' | 'SELL' | null {
  const bullish = ma5 > ma10 && momentum > spreadThreshold;
  const bearish = ma5 < ma10 && momentum < -spreadThreshold;
  const cutLoss = position === 'long' && pnl < -2;
  const takeProfit = position === 'long' && pnl > 3;
  if (position === 'none' && bullish) return 'BUY';
  if (position === 'long' && (bearish || cutLoss || takeProfit)) return 'SELL';
  return null;
}
