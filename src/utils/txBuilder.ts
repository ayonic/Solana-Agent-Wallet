import { Connection, PublicKey, SystemProgram, Transaction, Commitment, Keypair } from '@solana/web3.js';

export async function prepareTransfer(
  connection: Connection,
  from: Keypair,
  to: PublicKey,
  lamports: number,
  commitment: Commitment
) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports,
    })
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = blockhash;
  tx.sign(from);
  return { tx, blockhash, lastValidBlockHeight };
}

export async function simulateAndSend(
  connection: Connection,
  tx: Transaction,
  blockhash: string,
  lastValidBlockHeight: number,
  commitment: Commitment
) {
  const sim = await connection.simulateTransaction(tx);
  if (sim.value.err) throw new Error(JSON.stringify(sim.value.err));
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, commitment);
  return sig;
}
