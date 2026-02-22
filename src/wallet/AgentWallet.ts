/**
 * AgentWallet.ts
 * Core autonomous wallet for an AI agent.
 *
 * Responsibilities:
 *  - Programmatic keypair creation
 *  - Balance queries (SOL + SPL tokens)
 *  - Transaction construction and signing
 *  - Airdrop requests on devnet
 *  - Event emission for observability
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  TransactionSignature,
  Commitment,
  ParsedAccountData,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  transfer as splTransfer,
  getMint,
  getAccount,
} from '@solana/spl-token';
import { EventEmitter } from 'events';
import { KeyStore } from './KeyStore';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { prepareTransfer, simulateAndSend } from '../utils/txBuilder';
import { metrics } from '../metrics/Metrics';

export interface WalletConfig {
  agentId: string;
  connection: Connection;
  keyManager: KeyStore;
  label?: string;
}

export interface TransactionRecord {
  signature: string;
  type: 'SOL_TRANSFER' | 'SPL_TRANSFER' | 'AIRDROP' | 'CUSTOM';
  amount: number;
  token?: string;
  from: string;
  to?: string;
  timestamp: Date;
  status: 'pending' | 'confirmed' | 'failed';
  error?: string;
}

export class AgentWallet extends EventEmitter {
  readonly agentId: string;
  readonly connection: Connection;
  private keyManager: KeyStore;
  private keypair: Keypair;
  private txHistory: TransactionRecord[] = [];
  private label: string;
  private maxSpendPerTx: number;
  private maxDailySpend: number;
  private spendLedger: Record<string, number> = {};
  private spendLedgerPath: string;

  constructor(config: WalletConfig) {
    super();
    this.agentId = config.agentId;
    this.connection = config.connection;
    this.keyManager = config.keyManager;
    this.label = config.label || config.agentId;
    this.maxSpendPerTx = parseFloat(process.env.MAX_SPEND_SOL_PER_TX || '0');
    this.maxDailySpend = parseFloat(process.env.MAX_DAILY_SPEND_SOL || '0');
    this.spendLedgerPath = path.resolve(process.cwd(), '.agent-keys', `${this.agentId}.spend.json`);
    this.loadSpendLedger();

    // Load or create keypair
    if (this.keyManager.hasKey(config.agentId)) {
      this.keypair = this.keyManager.loadKey(config.agentId);
      logger.info(`[${this.label}] Loaded existing keypair: ${this.publicKey}`);
    } else {
      this.keypair = Keypair.generate();
      this.keyManager.storeKey(config.agentId, this.keypair, config.label);
      logger.info(`[${this.label}] Created new keypair: ${this.publicKey}`);
      this.emit('created', { agentId: this.agentId, publicKey: this.publicKey });
    }
  }

  /** Public key as Base58 string */
  get publicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  get pubkey(): PublicKey {
    return this.keypair.publicKey;
  }

  // ─── Balance ─────────────────────────────────────────────────────────────

  async getSOLBalance(): Promise<number> {
    let attempts = 0;
    let lastErr: unknown = null;
    while (attempts < 3) {
      try {
        const lamports = await this.connection.getBalance(this.keypair.publicKey);
        return lamports / LAMPORTS_PER_SOL;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempts)));
        attempts++;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async getSPLBalance(mintAddress: string): Promise<number> {
    try {
      const mint = new PublicKey(mintAddress);
      const ata = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.keypair,
        mint,
        this.keypair.publicKey
      );
      const account = await getAccount(this.connection, ata.address);
      const mintInfo = await getMint(this.connection, mint);
      return Number(account.amount) / Math.pow(10, mintInfo.decimals);
    } catch {
      return 0;
    }
  }

  async getFullBalances(): Promise<{ sol: number; tokens: { mint: string; balance: number }[] }> {
    const sol = await this.getSOLBalance();
    // Fetch all token accounts
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      this.keypair.publicKey,
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );

    const tokens = tokenAccounts.value.map((ta) => {
      const data = ta.account.data as ParsedAccountData;
      return {
        mint: data.parsed.info.mint as string,
        balance: data.parsed.info.tokenAmount.uiAmount as number,
      };
    });

    return { sol, tokens };
  }

  // ─── Funding ─────────────────────────────────────────────────────────────

  async requestAirdrop(amountSOL: number = 1): Promise<TransactionSignature> {
    const lamports = amountSOL * LAMPORTS_PER_SOL;
    logger.info(`[${this.label}] Requesting airdrop of ${amountSOL} SOL…`);

    const record: TransactionRecord = {
      signature: '',
      type: 'AIRDROP',
      amount: amountSOL,
      from: 'faucet',
      to: this.publicKey,
      timestamp: new Date(),
      status: 'pending',
    };

    try {
      const sig = await this.connection.requestAirdrop(this.keypair.publicKey, lamports);
      await this.connection.confirmTransaction(sig, 'confirmed');
      record.signature = sig;
      record.status = 'confirmed';
      this.txHistory.push(record);
      this.emit('airdrop', { sig, amount: amountSOL });
      logger.info(`[${this.label}] Airdrop confirmed: ${sig}`);
      return sig;
    } catch (err) {
      record.status = 'failed';
      record.error = String(err);
      this.txHistory.push(record);
      throw err;
    }
  }

  // ─── Transfers ────────────────────────────────────────────────────────────

  /** Send SOL to another address autonomously (no human approval needed) */
  async sendSOL(
    toAddress: string,
    amountSOL: number,
    commitment: Commitment = 'confirmed'
  ): Promise<TransactionSignature> {
    if (this.maxSpendPerTx > 0 && amountSOL > this.maxSpendPerTx) {
      throw new Error(`Spend limit exceeded: ${amountSOL} SOL > ${this.maxSpendPerTx} SOL`);
    }
    if (this.maxDailySpend > 0) {
      const todaySpent = this.getTodaySpentFromLedger();
      if (todaySpent + amountSOL > this.maxDailySpend) {
        throw new Error(`Daily spend cap exceeded: ${(todaySpent + amountSOL).toFixed(4)} SOL > ${this.maxDailySpend} SOL`);
      }
    }
    const toPubkey = new PublicKey(toAddress);
    const lamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);

    logger.info(`[${this.label}] Sending ${amountSOL} SOL to ${toAddress}`);

    const record: TransactionRecord = {
      signature: '',
      type: 'SOL_TRANSFER',
      amount: amountSOL,
      from: this.publicKey,
      to: toAddress,
      timestamp: new Date(),
      status: 'pending',
    };

    try {
      const { tx, blockhash, lastValidBlockHeight } = await prepareTransfer(
        this.connection,
        this.keypair,
        toPubkey,
        lamports,
        commitment
      );
      const sig = await simulateAndSend(this.connection, tx, blockhash, lastValidBlockHeight, commitment);

      record.signature = sig;
      record.status = 'confirmed';
      this.txHistory.push(record);
      this.incrementTodaySpend(amountSOL);
      metrics.incTx('confirmed');
      this.emit('transfer', { type: 'SOL', sig, amount: amountSOL, to: toAddress });
      logger.info(`[${this.label}] SOL transfer confirmed: ${sig}`);
      return sig;
    } catch (err) {
      record.status = 'failed';
      record.error = String(err);
      this.txHistory.push(record);
      metrics.incTx('failed');
      logger.error(`[${this.label}] SOL transfer failed: ${err}`);
      throw err;
    }
  }

  /** Send SPL tokens to another address autonomously */
  async sendSPL(
    toAddress: string,
    mintAddress: string,
    amount: number,
    commitment: Commitment = 'confirmed'
  ): Promise<TransactionSignature> {
    const toPubkey = new PublicKey(toAddress);
    const mint = new PublicKey(mintAddress);
    const mintInfo = await getMint(this.connection, mint);
    const rawAmount = BigInt(Math.floor(amount * Math.pow(10, mintInfo.decimals)));

    logger.info(`[${this.label}] Sending ${amount} SPL tokens (${mintAddress}) to ${toAddress}`);

    const record: TransactionRecord = {
      signature: '',
      type: 'SPL_TRANSFER',
      amount,
      token: mintAddress,
      from: this.publicKey,
      to: toAddress,
      timestamp: new Date(),
      status: 'pending',
    };

    try {
      const fromATA = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.keypair,
        mint,
        this.keypair.publicKey
      );
      const toATA = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.keypair,
        mint,
        toPubkey
      );

      const sig = await splTransfer(
        this.connection,
        this.keypair,
        fromATA.address,
        toATA.address,
        this.keypair,
        rawAmount,
        [],
        { commitment }
      );

      record.signature = sig;
      record.status = 'confirmed';
      this.txHistory.push(record);
      this.emit('transfer', { type: 'SPL', sig, amount, mint: mintAddress, to: toAddress });
      logger.info(`[${this.label}] SPL transfer confirmed: ${sig}`);
      return sig;
    } catch (err) {
      record.status = 'failed';
      record.error = String(err);
      this.txHistory.push(record);
      throw err;
    }
  }

  /** Sign an arbitrary transaction — agent signs autonomously */
  async signAndSend(transaction: Transaction): Promise<TransactionSignature> {
    const sig = await sendAndConfirmTransaction(this.connection, transaction, [this.keypair]);

    const record: TransactionRecord = {
      signature: sig,
      type: 'CUSTOM',
      amount: 0,
      from: this.publicKey,
      timestamp: new Date(),
      status: 'confirmed',
    };
    this.txHistory.push(record);
    this.emit('custom_tx', { sig });
    return sig;
  }

  // ─── History & Observability ──────────────────────────────────────────────

  getTransactionHistory(): TransactionRecord[] {
    return [...this.txHistory];
  }

  private getTodayKey(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private loadSpendLedger(): void {
    try {
      if (fs.existsSync(this.spendLedgerPath)) {
        const raw = fs.readFileSync(this.spendLedgerPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') this.spendLedger = parsed as Record<string, number>;
      }
    } catch {}
  }

  private saveSpendLedger(): void {
    try {
      const dir = path.dirname(this.spendLedgerPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.spendLedgerPath, JSON.stringify(this.spendLedger, null, 2), { mode: 0o600 });
    } catch {}
  }

  private getTodaySpentFromLedger(): number {
    const key = this.getTodayKey();
    return Number(this.spendLedger[key] || 0);
    }

  private incrementTodaySpend(amountSOL: number): void {
    const key = this.getTodayKey();
    const current = Number(this.spendLedger[key] || 0);
    this.spendLedger[key] = current + amountSOL;
    this.saveSpendLedger();
  }

  async getOnChainHistory(limit = 10) {
    return this.connection.getConfirmedSignaturesForAddress2(this.keypair.publicKey, { limit });
  }

  getSummary() {
    return {
      agentId: this.agentId,
      label: this.label,
      publicKey: this.publicKey,
      txCount: this.txHistory.length,
      lastActivity:
        this.txHistory.length > 0
          ? this.txHistory[this.txHistory.length - 1].timestamp
          : null,
    };
  }
}
