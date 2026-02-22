export function validateConfig(): void {
  const num = (v: string | undefined, def: number) => {
    const n = v !== undefined ? parseFloat(v) : def;
    if (Number.isNaN(n)) throw new Error('Invalid numeric env');
    return n;
  };
  const maxPerTx = num(process.env.MAX_SPEND_SOL_PER_TX, 0);
  const minBalance = num(process.env.MIN_BALANCE_SOL, 0);
  const maxDaily = num(process.env.MAX_DAILY_SPEND_SOL, 0);
  const airdrop = num(process.env.AIRDROP_AMOUNT_SOL, 1);
  const cycle = num(process.env.AGENT_CYCLE_MS, 5000);
  if (maxPerTx < 0) throw new Error('MAX_SPEND_SOL_PER_TX must be ≥ 0');
  if (minBalance < 0) throw new Error('MIN_BALANCE_SOL must be ≥ 0');
  if (maxDaily < 0) throw new Error('MAX_DAILY_SPEND_SOL must be ≥ 0');
  if (airdrop <= 0) throw new Error('AIRDROP_AMOUNT_SOL must be > 0');
  if (cycle <= 0) throw new Error('AGENT_CYCLE_MS must be > 0');
}
