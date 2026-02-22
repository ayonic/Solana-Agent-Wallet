import { DexAdapter } from './DexAdapter';
import { SimulatedDex } from './SimulatedDex';
import { JupiterAdapter } from './JupiterAdapter';
import { AgentWallet } from '../wallet/AgentWallet';

export function createDex(wallet: AgentWallet): DexAdapter {
  const src = (process.env.DEX_ADAPTER || 'simulated').toLowerCase();
  if (src === 'jupiter') {
    return new JupiterAdapter(wallet);
  }
  return new SimulatedDex(wallet);
}
