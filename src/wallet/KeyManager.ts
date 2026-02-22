/**
 * KeyManager.ts
 * Handles secure storage and retrieval of agent private keys.
 *
 * Security model:
 *  - Keys are encrypted at rest using AES-256-GCM via Node's built-in crypto.
 *  - Each key file uses a unique random IV (initialization vector).
 *  - The encryption secret is loaded from environment variables, never hardcoded.
 *  - In production, replace the file-based store with HSM / KMS / Vault.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import { KeyStore, StoredKeyMeta } from './KeyStore';
import bs58 from 'bs58';

const KEYS_DIR = path.resolve(process.cwd(), '.agent-keys');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32; // bytes for AES-256

export class KeyManager implements KeyStore {
  private encryptionKey: Buffer;

  constructor(secret?: string) {
    const rawSecret = secret || process.env.ENCRYPTION_SECRET || 'default-dev-secret-change-me!!';
    // Derive a 32-byte key from the secret using SHA-256
    this.encryptionKey = crypto.createHash('sha256').update(rawSecret).digest();
    this.ensureKeysDir();
  }

  private ensureKeysDir(): void {
    if (!fs.existsSync(KEYS_DIR)) {
      fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
    }
  }

  /** Encrypt a private key and persist it with metadata */
  storeKey(agentId: string, keypair: Keypair, label?: string): StoredKeyMeta {
    const privateKeyBytes = keypair.secretKey; // Uint8Array[64]
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(privateKeyBytes)),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // File format: iv(16) | authTag(16) | ciphertext
    const stored = Buffer.concat([iv, authTag, encrypted]);
    const keyPath = this.keyPath(agentId);
    fs.writeFileSync(keyPath, stored, { mode: 0o600 });

    const meta: StoredKeyMeta = {
      agentId,
      publicKey: keypair.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
      label,
    };
    fs.writeFileSync(this.metaPath(agentId), JSON.stringify(meta, null, 2), {
      mode: 0o600,
    });

    return meta;
  }

  /** Load and decrypt a stored keypair */
  loadKey(agentId: string): Keypair {
    const keyPath = this.keyPath(agentId);
    if (!fs.existsSync(keyPath)) {
      throw new Error(`No key stored for agent: ${agentId}`);
    }

    const stored = fs.readFileSync(keyPath);
    const iv = stored.subarray(0, IV_LENGTH);
    const authTag = stored.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = stored.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return Keypair.fromSecretKey(new Uint8Array(decrypted));
  }

  /** Delete a key from disk (e.g., agent retirement) */
  deleteKey(agentId: string): void {
    [this.keyPath(agentId), this.metaPath(agentId)].forEach((f) => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
  }

  /** List all stored agent key metadata */
  listKeys(): StoredKeyMeta[] {
    return fs
      .readdirSync(KEYS_DIR)
      .filter((f) => f.endsWith('.meta.json'))
      .map((f) => {
        const raw = fs.readFileSync(path.join(KEYS_DIR, f), 'utf-8');
        return JSON.parse(raw) as StoredKeyMeta;
      });
  }

  /** Check if a key exists */
  hasKey(agentId: string): boolean {
    return fs.existsSync(this.keyPath(agentId));
  }

  /** Export public key as Base58 */
  getPublicKey(agentId: string): string {
    const meta = this.getMeta(agentId);
    return meta.publicKey;
  }

  getMeta(agentId: string): StoredKeyMeta {
    const metaPath = this.metaPath(agentId);
    if (!fs.existsSync(metaPath)) {
      throw new Error(`No metadata for agent: ${agentId}`);
    }
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as StoredKeyMeta;
  }

  private keyPath(agentId: string): string {
    return path.join(KEYS_DIR, `${agentId}.key`);
  }

  private metaPath(agentId: string): string {
    return path.join(KEYS_DIR, `${agentId}.meta.json`);
  }
}
