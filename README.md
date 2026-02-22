# 🤖 Solana Agentic Wallet System

An autonomous AI agent wallet prototype for Solana — built for devnet, designed for production.

> Multiple independent AI agents, each with their own encrypted wallet, capable of signing transactions, managing positions, and interacting with DeFi protocols without any human intervention.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Orchestrator                       │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │  TradingAgent │  │  TradingAgent │  │LiquidityAgent │  │
│  │    (Alpha)    │  │    (Beta)     │  │    (Gamma)    │  │
│  └──────┬────────┘  └──────┬────────┘  └──────┬────────┘  │
│         │                  │                   │            │
│  ┌──────▼────────┐  ┌──────▼────────┐  ┌──────▼────────┐  │
│  │  AgentWallet  │  │  AgentWallet  │  │  AgentWallet  │  │
│  │  (isolated)   │  │  (isolated)   │  │  (isolated)   │  │
│  └──────┬────────┘  └──────┬────────┘  └──────┬────────┘  │
└─────────┼──────────────────┼───────────────────┼───────────┘
          │                  │                   │
          └──────────────────┼───────────────────┘
                             │
                    ┌────────▼────────┐
                    │   KeyManager    │
                    │ AES-256-GCM enc │
                    │  .agent-keys/   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Solana Devnet  │
                    │  (real on-chain │
                    │   transactions) │
                    └─────────────────┘
```

---

## Features

- ✅ **Programmatic wallet creation** — keypairs generated and stored autonomously
- ✅ **Encrypted key storage** — AES-256-GCM with per-file random IV and auth tag
- ✅ **Autonomous transaction signing** — no human approval, agents sign freely
- ✅ **Real devnet transactions** — actual SOL transfers confirmed on-chain
- ✅ **Optional live DEX swaps** — integrate with Jupiter on devnet via `JupiterAdapter`
- ✅ **Multi-agent isolation** — each agent has a separate keypair and state
- ✅ **AI decision loop** — Observe → Think → Act cycle with configurable interval
- ✅ **TradingAgent** — moving average crossover strategy with stop-loss/take-profit
- ✅ **LiquidityAgent** — IL-aware LP management strategy
- ✅ **Live CLI observer** — real-time dashboard for monitoring all agents
- ✅ **Full test suite** — 10 integration tests covering all wallet operations
- ✅ **SKILLS.md** — agent-readable capability and API reference

---

## Quick Start

### Prerequisites
- Node.js 18+
- npm 9+

### Install
```bash
git clone https://github.com/ayonic/solana-agent-wallet
cd solana-agent-wallet
npm install
```

### Configure
```bash
cp .env.example .env
# Edit .env — set ENCRYPTION_SECRET to a 32+ char random string
# Optionally set DEX_ADAPTER=jupiter to use Jupiter instead of the simulated DEX
```

### Run the Demo (3 agents on devnet)
```bash
npm run demo
```

This will:
1. Create 3 agent wallets (Alpha Trader, Beta Trader, Gamma LP)
2. Request devnet airdrops for each
3. Start autonomous decision loops
4. Execute real on-chain transactions on devnet
5. Print a final report after all cycles complete

### Observe Agents Live
In a separate terminal while the demo is running:
```bash
npm run observe
```

### Launch Web Dashboard
Run the enhanced web-based dashboard with real-time metrics:
```bash
npm run dashboard
```
Then visit http://localhost:3000 in your browser to view the dashboard.

### Run Tests
```bash
npm test
```

These are live integration tests against Solana devnet. If the public faucet is rate-limited or unavailable, some network-dependent tests may be skipped automatically, or they may fail with clear messages indicating faucet issues. In that case, rerun later or set `SKIP_NETWORK_TESTS=true` in your `.env` to focus on local behavior.

---

## Wallet Security Design

### Key Management Architecture

```
Secret (env var)
     │
     ▼ SHA-256
Encryption Key (32 bytes)
     │
     ├── Random IV (16 bytes, unique per key)
     │
     ▼ AES-256-GCM
Encrypted Private Key + Auth Tag
     │
     ▼
.agent-keys/{agentId}.key  (mode 0600)
.agent-keys/{agentId}.meta.json (mode 0600)
.agent-keys/ directory (mode 0700)
```

**Why AES-256-GCM?**
- Authenticated encryption — the 16-byte auth tag detects any tampering with the ciphertext
- A unique IV per key ensures identical secrets produce different ciphertexts
- GCM mode is parallelizable and widely audited

**Why not just use the Keypair directly in memory?**

In a long-running agent system, keys must survive process restarts. We intentionally load keys from disk on demand (not cache them globally) so that a memory dump exposes as little key material as possible.

### Separation of Concerns

| Component | Responsibility |
|-----------|---------------|
| `KeyManager` | Encrypt/decrypt/store private keys |
| `AgentWallet` | Sign & send transactions, query balances |
| `WalletRegistry` | Manage multiple wallets, no key logic |
| `BaseAgent` | Decision loop logic, no direct key access |
| `TradingAgent` / `LiquidityAgent` | Strategy, calls wallet methods only |

Agents **never** directly access raw private key bytes. They call wallet methods which handle signing internally.

### Production Hardening Checklist

- [ ] Replace file store with **AWS KMS**, **HashiCorp Vault**, or **HSM**
- [ ] Run agents in isolated containers with no shared filesystem
- [ ] Use a **private RPC node** — public endpoints expose tx patterns
- [ ] Set per-agent **spending limits** enforced in `act()` overrides
- [ ] Add **transaction simulation** (preflight) before broadcast
- [ ] Implement **circuit breakers** — pause agent if balance drops below threshold
- [ ] Monitor with **Datadog/Prometheus** alerts on balance and error rate
- [ ] Store `ENCRYPTION_SECRET` in **AWS Secrets Manager** or equivalent

---

## Agent Design

### The Observe → Think → Act Loop

```typescript
// Every cycleMs milliseconds:
const observation = await agent.observe();  // Query world state
const action      = await agent.think(obs); // Decide what to do
if (action) await agent.act(action);        // Execute autonomously
```

The loop is fully non-blocking and event-driven. Agents emit observable events at each phase, allowing external monitoring without coupling to agent internals.

### TradingAgent Strategy

Uses a classic **dual moving average crossover**:

- **MA5** (5-period) crosses above **MA10** (10-period) + positive momentum → BUY
- **Stop-loss** at −2% unrealized loss → SELL
- **Take-profit** at +3% unrealized gain → SELL
- **Bearish crossover** → SELL

Price data comes from a GBM (Geometric Brownian Motion) mock oracle on devnet by default. You can enable live prices from [Pyth Network](https://pyth.network/) by setting:

```bash
ORACLE_SOURCE=pyth
PYTH_FEED_ID=<your_pyth_price_feed_id>
```

When Pyth is unavailable or misconfigured, the system automatically falls back to the mock oracle so agents can continue operating.

### LiquidityAgent Strategy

Monitors AMM pool imbalance and impermanent loss:

- **PROVIDE**: Pool imbalance > `targetImbalanceThreshold`% and agent has free capital
- **REMOVE**: Impermanent loss > `impermanentLossLimit`%
- **REBALANCE**: Adjust cost basis when imbalance doubles threshold

IL calculation uses the standard formula: `IL = 2√r/(1+r) − 1` where `r = currentRatio/entryRatio`.

---

## Extending the System

### Add a New Agent Type

```typescript
import { BaseAgent, AgentAction } from './agent/BaseAgent';

export class ArbitrageAgent extends BaseAgent {
  protected async observe() {
    // Query multiple price sources
    return { dex1Price: ..., dex2Price: ..., spread: ... };
  }

  protected async think(obs) {
    if (obs.spread > MIN_PROFIT_THRESHOLD) {
      return {
        type: 'ARBITRAGE',
        params: { amount: 0.1, buyOn: 'dex1', sellOn: 'dex2' },
        reasoning: `Spread of ${obs.spread}% exceeds minimum`,
      };
    }
    return null;
  }

  protected async act(action) {
    // Execute buy and sell atomically
    await this.wallet.signAndSend(buildArbitrageTx(action.params));
  }
}
```

### Add a New Protocol

Implement the transaction construction in `src/protocols/` and call `wallet.signAndSend(tx)` with your built `Transaction` object. The wallet handles signing autonomously.

---

## Bounty Requirements Mapping

This section maps the project features to the bounty requirements for an agentic wallet prototype.

- **Programmatic wallet creation**
  - Implemented by `WalletRegistry` and `AgentWallet` in [`src/wallet`](file:///c:/Users/DELL-PC/OneDrive/Desktop/solana-agent-wallet/src/wallet).
  - Wallets are created or loaded per agent ID with encrypted on-disk storage.

- **Autonomous transaction signing**
  - `AgentWallet` exposes `sendSOL`, `sendSPL`, and `signAndSend`, and agents call these directly.
  - No human approval or manual signing step is required in the demo.

- **Hold SOL and SPL tokens**
  - `getSOLBalance`, `getSPLBalance`, and `getFullBalances` expose SOL and SPL token balances.
  - SPL support is implemented using `@solana/spl-token` and associated token accounts.

- **Interact with a test dApp or protocol**
  - On devnet, agents can use:
    - `SimulatedDex` for a safe, fully simulated environment, or
    - `JupiterAdapter` to execute real swaps on devnet via the Jupiter API when `DEX_ADAPTER=jupiter`.

- **Multiple independent agents**
  - `BaseAgent` provides the Observe → Think → Act loop.
  - `TradingAgent` and `LiquidityAgent` implement concrete strategies, each with its own wallet and state.

- **Safe key management and storage**
  - `KeyManager` uses AES-256-GCM with per-key IV and auth tag, derived from `ENCRYPTION_SECRET`.
  - Keys live under `.agent-keys/` with restrictive file permissions (documented in the security model).

- **Deep dive and documentation**
  - This README explains architecture, security, and agent design.
  - `SKILLS.md` serves as an agent-readable capability reference.
  - `DEMO_INSTRUCTIONS.md` provides a step-by-step runbook for running the demo with Jupiter and Pyth.

- **Working prototype on devnet**
  - `npm run demo` boots three agents on Solana devnet, executes real transactions, and prints a final report.
  - Optional `npm run observe` and `npm run dashboard` provide live monitoring during the demo.

## Upgrade Path: Devnet → Mainnet

| Component | Devnet | Mainnet |
|-----------|--------|---------|
| Price oracle | Mock GBM (default) + optional Pyth | Pyth / Switchboard |
| DEX integration | `SimulatedDex` (default) or `JupiterAdapter` (Jupiter on devnet) | Jupiter Aggregator (tuned for mainnet) |
| LP interaction | SOL transfer proxy | Orca Whirlpool SDK |
| Key storage | Encrypted files | AWS KMS / Vault |
| RPC | Public devnet | Private Helius/Triton |
| Monitoring | Console logs | Datadog + PagerDuty |

---

## Project Structure

```
solana-agent-wallet/
├── src/
│   ├── wallet/
│   │   ├── AgentWallet.ts        Core wallet: create, sign, send, balance
│   │   ├── KeyManager.ts         AES-256-GCM encrypted key storage
│   │   └── WalletRegistry.ts     Multi-agent wallet lifecycle manager
│   ├── agent/
│   │   ├── BaseAgent.ts          Abstract agent: Observe→Think→Act loop
│   │   ├── TradingAgent.ts       MA crossover trading strategy
│   │   └── LiquidityAgent.ts     IL-aware LP management strategy
│   ├── oracles/
│   │   ├── OracleFactory.ts      Oracle multiplexer (mock vs Pyth)
│   │   └── PythPriceOracle.ts    Pyth Hermes-based price oracle
│   ├── protocols/
│   │   ├── MockPriceOracle.ts    GBM price simulation
│   │   ├── MockPoolOracle.ts     AMM pool state simulation
│   │   ├── SimulatedDex.ts       Devnet trade execution wrapper
│   │   └── JupiterAdapter.ts     Jupiter DEX integration (quote + swap APIs)
│   ├── cli/
│   │   ├── observer.ts           Live multi-agent monitoring dashboard
│   │   └── dashboard.ts          Web dashboard launcher
│   ├── utils/
│   │   ├── logger.ts             Winston structured logging
│   │   └── connection.ts         Solana Connection factory
│   ├── tests/
│   │   └── integration.ts        10-test integration suite
│   └── index.ts                  Demo orchestrator
├── SKILLS.md                     Agent-readable API reference
├── DEMO_INSTRUCTIONS.md          Step-by-step demo runbook (Jupiter + Pyth)
├── README.md                     This file
├── .env.example                  Environment template
├── package.json
└── tsconfig.json
```

---

## License

MIT — See [LICENSE](LICENSE)

---

## Resources

- [Solana Web3.js Docs](https://solana-labs.github.io/solana-web3.js/)
- [Solana JSON RPC API](https://solana.com/docs/rpc)
- [SPL Token Docs](https://spl.solana.com/token)
- [Pyth Network (price oracles)](https://pyth.network/)
- [Jupiter Aggregator](https://jup.ag/developers)
- [Orca Whirlpools SDK](https://docs.orca.so/)
- [HashiCorp Vault](https://developer.hashicorp.com/vault) (production key management)
