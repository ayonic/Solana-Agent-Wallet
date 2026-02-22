import { Connection, clusterApiUrl, Cluster } from '@solana/web3.js';
import * as dotenv from 'dotenv';
dotenv.config();

const CLUSTER = (process.env.SOLANA_CLUSTER || 'devnet') as Cluster;
const CUSTOM_RPC = process.env.SOLANA_RPC_URL;

export function createConnection(): Connection {
  const endpoint = CUSTOM_RPC || clusterApiUrl(CLUSTER);
  return new Connection(endpoint, 'confirmed');
}

export { CLUSTER };
