export interface StoredKeyMeta {
  agentId: string;
  publicKey: string;
  createdAt: string;
  label?: string;
}

export interface KeyStore {
  storeKey(agentId: string, keypair: import('@solana/web3.js').Keypair, label?: string): StoredKeyMeta;
  loadKey(agentId: string): import('@solana/web3.js').Keypair;
  deleteKey(agentId: string): void;
  listKeys(): StoredKeyMeta[];
  hasKey(agentId: string): boolean;
  getPublicKey(agentId: string): string;
  getMeta(agentId: string): StoredKeyMeta;
}
