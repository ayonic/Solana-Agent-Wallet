/**
 * WalletRegistry.ts
 * Central registry for managing multiple independent agent wallets.
 * Supports creating, retrieving, and broadcasting across all agents.
 */

import { Connection } from '@solana/web3.js';
import { AgentWallet, WalletConfig } from './AgentWallet';
import { KeyStore } from './KeyStore';
import { PublicKey } from '@solana/web3.js';
import { metrics } from '../metrics/Metrics';
import { logger } from '../utils/logger';

export class WalletRegistry {
  private wallets: Map<string, AgentWallet> = new Map();
  private connection: Connection;
  private keyStore: KeyStore;

  constructor(connection: Connection, keyStore: KeyStore) {
    this.connection = connection;
    this.keyStore = keyStore;
  }

  /** Create or load a wallet for a given agent ID */
  getOrCreate(agentId: string, label?: string): AgentWallet {
    if (this.wallets.has(agentId)) {
      return this.wallets.get(agentId)!;
    }
    const wallet = new AgentWallet({
      agentId,
      connection: this.connection,
      keyManager: this.keyStore,
      label,
    });
    this.wallets.set(agentId, wallet);
    return wallet;
  }

  get(agentId: string): AgentWallet | undefined {
    return this.wallets.get(agentId);
  }

  getAll(): AgentWallet[] {
    return Array.from(this.wallets.values());
  }

  remove(agentId: string): void {
    this.wallets.delete(agentId);
    logger.info(`[Registry] Removed wallet for agent ${agentId}`);
  }

  /** Restore all previously created wallets from disk */
  restoreAll(): number {
    const metas = this.keyStore.listKeys();
    let restored = 0;
    for (const meta of metas) {
      if (!this.wallets.has(meta.agentId)) {
        this.getOrCreate(meta.agentId, meta.label);
        restored++;
      }
    }
    logger.info(`[Registry] Restored ${restored} wallets from disk`);
    return restored;
  }

  /** Snapshot balances for all registered wallets */
  async snapshotBalances(): Promise<{ agentId: string; label: string; sol: number }[]> {
    const wallets = this.getAll();
    const pubkeys = wallets.map((w) => new PublicKey(w.publicKey));
    const infos = await this.connection.getMultipleAccountsInfo(pubkeys);
    const results = wallets.map((w, i) => ({
      agentId: w.agentId,
      label: w.getSummary().label,
      sol: infos[i]?.lamports ? infos[i]!.lamports / 1_000_000_000 : 0,
    }));
    for (const r of results) metrics.setBalance(r.agentId, r.sol);
    return results;
  }

  count(): number {
    return this.wallets.size;
  }
}
