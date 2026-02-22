import { DexAdapter } from './DexAdapter';
import { logger } from '../utils/logger';
import { AgentWallet } from '../wallet/AgentWallet';
import { LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';

type QuoteResponse = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  routes?: unknown[];
};

export class JupiterAdapter implements DexAdapter {
  private totalBuyVolume = 0;
  private totalSellVolume = 0;
  private tradeCount = 0;
  private wallet: AgentWallet;

  constructor(wallet: AgentWallet) {
    this.wallet = wallet;
  }

  private getMints() {
    const baseMint = process.env.JUP_BASE_MINT || 'So11111111111111111111111111111111111111112';
    const quoteMint =
      process.env.JUP_QUOTE_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
    const slippageBps = parseInt(process.env.JUP_SLIPPAGE_BPS || '50');
    return { baseMint, quoteMint, slippageBps };
  }

  private async quote(inputMint: string, outputMint: string, amount: string, slippageBps: number) {
    const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as QuoteResponse;
    return data;
  }

  private async swap(route: QuoteResponse): Promise<string> {
    const userPublicKey = this.wallet.pubkey.toBase58();
    const res = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: route,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });
    if (!res.ok) throw new Error(`Jupiter swap failed: ${res.status} ${res.statusText}`);
    const json = await res.json();
    const base64Tx = json.swapTransaction as string;
    const tx = Transaction.from(Buffer.from(base64Tx, 'base64'));
    const sig = await this.wallet.signAndSend(tx);
    return sig;
  }

  async buy(amountSOL: number): Promise<string | null> {
    try {
      const { baseMint, quoteMint, slippageBps } = this.getMints();
      const inLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL).toString();
      const quote = await this.quote(baseMint, quoteMint, inLamports, slippageBps);
      const sig = await this.swap(quote);
      this.totalBuyVolume += amountSOL;
      this.tradeCount++;
      logger.info(`[Jupiter] BUY ${amountSOL} SOL → ${quote.outputMint} | sig: ${sig.slice(0, 10)}…`);
      return sig;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[Jupiter] BUY failed: ${msg}`);
      return null;
    }
  }

  async sell(amountSOL: number): Promise<string | null> {
    try {
      const { baseMint, quoteMint, slippageBps } = this.getMints();
      const inLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL).toString();
      const quote = await this.quote(quoteMint, baseMint, inLamports, slippageBps);
      const sig = await this.swap(quote);
      this.totalSellVolume += amountSOL;
      this.tradeCount++;
      logger.info(`[Jupiter] SELL ${amountSOL} SOL ← ${quote.inputMint} | sig: ${sig.slice(0, 10)}…`);
      return sig;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[Jupiter] SELL failed: ${msg}`);
      return null;
    }
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
