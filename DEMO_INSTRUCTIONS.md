## Solana Agentic Wallet — Jupiter Devnet Demo

This guide explains, step by step, how to run the `npm run demo` script so that the TradingAgents execute real swaps on Solana **devnet** using the **JupiterAdapter** and a Pyth-backed price oracle (with safe fallbacks).

If you are new to Solana, web3, or Node.js, follow the sections in order. You do **not** need any prior blockchain experience.

---

### 0. What You Will See

When you finish this guide and run the demo:

- Three AI agents will each control their **own wallet** on Solana devnet.
- Two agents (Alpha and Beta) will automatically decide when to **buy or sell** using the Jupiter DEX aggregator.
- You will see:
  - A list of agent wallet addresses.
  - Logs showing decisions like `BUY`, `SELL`, or `HOLD`.
  - A final report showing how many transactions each agent sent and their final balances.

---

### 1. Prerequisites (Tools You Need)

- **Node.js 18 or newer**
  - Download from https://nodejs.org (LTS version is fine).
  - After installation, open a terminal and run:
    - `node -v` (should print at least `v18.x.x`)
    - `npm -v`
- **Git** (to clone the repository)
  - Download from https://git-scm.com if you don’t have it.
- **Solana CLI (optional)**
  - Only needed if you want to check balances or transactions from the command line.
  - You can also use a web explorer instead.

Clone the repository and install dependencies:

```bash
git clone https://github.com/ayonic/solana-agent-wallet
cd solana-agent-wallet
npm install
```

---

### 2. Configure Environment (The `.env` File)

The application reads its settings from a file called `.env`. You start from the provided template.

1. Copy the example env file:

```bash
cp .env.example .env
```

2. Open `.env` in a text editor and confirm at least the following variables:

- **Network and RPC (which Solana network to use):**
  - `SOLANA_CLUSTER=devnet`
    - “devnet” is Solana’s public testing network. You are **not** using real money.
  - `SOLANA_RPC_URL=https://api.devnet.solana.com`
    - This is the URL the app uses to talk to the Solana devnet.

- **Wallet security (how keys are encrypted on disk):**
  - `ENCRYPTION_SECRET=CHANGE_ME_TO_A_RANDOM_32+_CHAR_SECRET`
    - Replace this with a long random string.
    - You can generate one using:
      - Any password manager “generate password” feature, or
      - `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

- **DEX and price oracle (how trades and prices are fetched):**
  - `DEX_ADAPTER=jupiter`
    - Tells the system to use the real Jupiter DEX API instead of the built-in simulator.
  - `ORACLE_SOURCE=pyth`
  - `ORACLE_MAX_STALENESS_MS=0`
  - `PYTH_FEED_ID=`
    - You can leave `PYTH_FEED_ID` empty for now. When empty, the app falls back to a mock price oracle so the strategy still runs.

- **Jupiter mints (which tokens to trade):**
  - `JUP_BASE_MINT=So11111111111111111111111111111111111111112` (wrapped SOL)
  - `JUP_QUOTE_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (USDC devnet)
  - `JUP_SLIPPAGE_BPS=50` (0.50% max slippage)

---

### 3. Fund Agent Wallets (Getting Test Tokens)

The demo creates three **agent wallets**. Think of each wallet as a separate bank account controlled by an AI agent:

- `agent-alpha` — TradingAgent (trades SOL/USDC based on price trends)
- `agent-beta` — TradingAgent (similar idea, slightly different config)
- `agent-gamma` — LiquidityAgent (simulated LP strategy)

When you first run the demo, the system:

- Creates or loads keys from the `.agent-keys/` folder.
- Tries to request SOL airdrops on devnet for each agent (if `AUTO_AIRDROP=true` in `.env`).

Sometimes the Solana devnet faucet is **rate-limited**. If that happens:

- Open https://faucet.solana.com in your browser.
- Copy the agent wallet addresses printed in the console under “Agent Wallet Addresses”.
- Paste one address into the faucet and request SOL for each agent.

For Jupiter swaps, you also need **USDC** on devnet:

- Use the official devnet USDC faucet (see Circle or Solana dev docs).
- Send USDC to the **Alpha** and **Beta** agent wallets (you can reuse the same addresses).
- USDC devnet mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

You do **not** need to understand SPL token internals; just ensure Alpha and Beta wallets receive some USDC and SOL.

---

### 4. Run the Demo (Step by Step)

Once `.env` is configured and wallets have some SOL (and ideally USDC), you can start the demo:

```bash
npm run demo
```

What you will see in the terminal:

1. A banner and configuration info.
2. A list of **Agent Wallet Addresses**, like:

   ```text
   📍 Agent Wallet Addresses:
     agent-alpha     → <ALPHA_PUBLIC_KEY>
     agent-beta      → <BETA_PUBLIC_KEY>
     agent-gamma     → <GAMMA_PUBLIC_KEY>
   ```

3. Airdrop logs (if enabled), then initial balances for each agent.
4. Logs for each agent cycle, for example:

   ```text
   [Cycle 3] Alpha Trader → BUY | MA crossover bullish, momentum=0.75%
   [Cycle 4] Beta Trader → HOLD | Price=23.10 MA5=23.05 MA10=22.90 ...
   ```

5. After a fixed number of cycles, a **FINAL REPORT** showing:
   - How many cycles each agent ran.
   - Final SOL balance.
   - Number of confirmed on-chain transactions.

Behind the scenes, during the run:

1. Configuration is validated and a Solana devnet `Connection` is created.
2. `KeyManager` and `WalletRegistry` initialize or load three agent wallets.
3. If enabled, the metrics server and dashboard server start.
4. Airdrops are requested for each wallet (if `AUTO_AIRDROP=true`).
5. Agents are started:
   - Alpha and Beta use `TradingAgent`, which:
     - Reads prices from the oracle (Pyth if configured, otherwise mock).
     - Uses the `createDex` factory, which returns a `JupiterAdapter` when `DEX_ADAPTER=jupiter`.
     - Calls `dex.buy()` and `dex.sell()` when its strategy decides to act.
   - Gamma uses `LiquidityAgent` with a simulated pool oracle.
6. The demo runs for a fixed number of cycles and then prints a final report with balances and transaction counts.

---

### 5. What the JupiterAdapter Does (Plain English)

File: `src/protocols/JupiterAdapter.ts`

You do **not** need to edit this file to use the demo, but it helps to know what it does:

- It reads token addresses and slippage from the environment:
  - `JUP_BASE_MINT` (SOL side of the pair)
  - `JUP_QUOTE_MINT` (USDC side of the pair)
  - `JUP_SLIPPAGE_BPS` (how much price movement is allowed during a trade)
- When the agent wants to **buy**:
  - It asks Jupiter for a price quote.
  - It asks Jupiter for the best swap transaction for that quote.
  - It decodes that transaction and asks the agent wallet to sign and send it.
- When the agent wants to **sell**:
  - It does the same thing but in the opposite direction (USDC back to SOL).
- It keeps simple statistics:
  - How many trades have been made.
  - Total buy and sell volume.
  - Net flow (buys minus sells).

For this demo, the amounts passed into `buy(amount)` and `sell(amount)` are expressed in SOL terms and used directly to size trades.

---

### 6. Verifying Swaps on Devnet (Checking It Really Worked)

To confirm that real on-chain swaps are happening:

1. Run the demo and wait until you see several `BUY` or `SELL` log lines.
2. Copy the public key of `agent-alpha` or `agent-beta` from the earlier “Agent Wallet Addresses” section in the console.
3. Open a Solana explorer (for example, Solscan) in your browser.
4. Switch the explorer to the **devnet** network.
5. Paste the agent’s public key into the search box.
6. You should see transactions appearing while the demo is running (or shortly after).

If you see errors instead of swaps:

- Check the console logs for messages starting with:
  - `[Jupiter] BUY failed` or `[Jupiter] SELL failed`.
- Then verify:
  - The agent wallet has enough SOL for **fees and trades**.
  - The agent wallet holds some USDC for reverse swaps (when selling).
  - Your RPC endpoint (`SOLANA_RPC_URL`) is healthy and not rate-limited.

---

### 7. Common Issues and Tips

- **Devnet airdrop limits**
  - If you see 429 “Too Many Requests” or faucet errors when requesting airdrops:
    - Wait and try again later, or
    - Fund the wallets manually from another devnet wallet using a faucet.

- **Price oracle failures**
  - If `PYTH_FEED_ID` is empty or Pyth is unavailable, the system automatically falls back to a mock oracle so the strategy can still run.

- **Switching back to simulated DEX**
  - To use the simulated DEX instead of Jupiter, change in `.env`:
    - `DEX_ADAPTER=simulated`
  - You can still keep `ORACLE_SOURCE=pyth` or change it to `mock`.

For deeper architectural details, see `README.md` and `SKILLS.md`.
