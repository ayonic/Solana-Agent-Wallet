# SKILLS.md
## Solana Agentic Wallet — Agent Capability Reference

This file describes the capabilities, interfaces, and protocols available to AI agents
operating within this wallet system. Agents should read this file to understand
what actions they can take, what data they can access, and what constraints apply.

---

## 1. Wallet Capabilities

An `AgentWallet` provides the following autonomous capabilities:

### Read Operations
| Method | Returns | Description |
|--------|---------|-------------|
| `getSOLBalance()` | `number` (SOL) | Current SOL balance of this agent's wallet |
| `getSPLBalance(mintAddress)` | `number` | SPL token balance for a given mint |
| `getFullBalances()` | `{ sol, tokens[] }` | All balances including SPL tokens |
| `getTransactionHistory()` | `TransactionRecord[]` | Local tx log with status |
| `getOnChainHistory(limit)` | Solana tx sigs | Confirmed signatures from chain |
| `getSummary()` | `AgentSummary` | Agent ID, public key, tx count |

### Write Operations (autonomous signing — no human approval required)
| Method | Params | Description |
|--------|--------|-------------|
| `sendSOL(to, amount)` | address, SOL amount | Transfer SOL to any address |
| `sendSPL(to, mint, amount)` | address, mint, amount | Transfer SPL tokens |
| `signAndSend(transaction)` | `Transaction` | Sign and submit any Transaction |
| `requestAirdrop(amount)` | SOL amount | Request devnet airdrop (devnet only) |

---

## 2. Agent Decision Loop

All agents follow the **Observe → Think → Act** cycle:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   OBSERVE   │───▶│    THINK    │───▶│     ACT     │
│             │    │             │    │             │
│ Query chain │    │ Decide what │    │ Execute tx  │
│ Query oracle│    │ action to   │    │ via wallet  │
│ Check state │    │ take        │    │ autonomously│
└─────────────┘    └─────────────┘    └─────────────┘
       ▲                                     │
       └─────────────────────────────────────┘
                    (next cycle)
```

### Cycle Configuration
- `cycleMs` — milliseconds between each decision cycle (default: 5000)
- `maxCycles` — maximum cycles before agent self-terminates (default: unlimited)
- Agents emit events: `started`, `cycle_start`, `action`, `cycle_end`, `error`, `stopped`

---

## 3. Built-in Agent Types

### TradingAgent
**Strategy:** Trend-following with moving average crossover

**Signals:**
- `BUY` — MA5 crosses above MA10, positive momentum > threshold
- `SELL` — Stop-loss (−2%), take-profit (+3%), or bearish crossover
- `HOLD` — No signal conditions met

**Key Config:**
```typescript
{
  tradingPair: 'SOL/USDC',     // price feed identifier
  maxPositionSOL: 0.1,         // max size per trade
  spreadThreshold: 0.5,        // min % momentum to trigger
}
```

### LiquidityAgent
**Strategy:** Opportunistic LP provision based on pool imbalance

**Actions:**
- `PROVIDE_LIQUIDITY` — When pool imbalance > threshold and agent has capital
- `REMOVE_LIQUIDITY` — When impermanent loss > limit
- `REBALANCE` — Adjust entry price basis when imbalance grows

**Key Config:**
```typescript
{
  targetImbalanceThreshold: 5,  // % imbalance to trigger provide
  impermanentLossLimit: 3,      // % IL to trigger remove
  maxLiquiditySOL: 0.2,         // max liquidity to provide
}
```

---

## 4. Creating a Custom Agent

Extend `BaseAgent` and implement three abstract methods:

```typescript
import { BaseAgent, AgentAction } from './agent/BaseAgent';

class MyAgent extends BaseAgent {
  protected async observe(): Promise<Record<string, unknown>> {
    // Return current world state: prices, balances, positions
    return {
      price: await oracle.getPrice(),
      balance: await this.wallet.getSOLBalance(),
    };
  }

  protected async think(obs: Record<string, unknown>): Promise<AgentAction | null> {
    // Return an action object or null (no-op)
    if (shouldAct(obs)) {
      return {
        type: 'MY_ACTION',
        params: { amount: 0.05 },
        reasoning: 'Conditions met because...',
      };
    }
    return null;
  }

  protected async act(action: AgentAction): Promise<void> {
    if (action.type === 'MY_ACTION') {
      await this.wallet.sendSOL(TARGET, action.params.amount as number);
    }
  }
}
```

---

## 5. Security Model

| Layer | Mechanism |
|-------|-----------|
| Key storage | AES-256-GCM encrypted files, mode 0600 |
| Key derivation | SHA-256 hash of `ENCRYPTION_SECRET` env var |
| IV | 16-byte cryptographically random per key |
| Auth tag | 16-byte GCM tag prevents ciphertext tampering |
| File permissions | Keys directory: 0700 (owner only) |
| Memory | Keys loaded on demand, not cached globally |

### Production Recommendations
- Replace file-based store with **AWS KMS**, **HashiCorp Vault**, or **HSM**
- Run each agent in an isolated container/VM
- Use a dedicated RPC node, not the public endpoint
- Enable transaction simulation before broadcasting
- Set per-agent spending limits enforced in `act()` methods
- Monitor with alerts on balance below minimum thresholds

---

## 6. Protocol Integrations (Devnet → Production Upgrade Path)

| Devnet (current) | Production target |
|------------------|-------------------|
| Price oracle | Mock GBM (default) + optional Pyth via `OracleFactory` |
| Pool state | Mock pool oracle | Raydium / Orca on-chain accounts |
| DEX integration | `SimulatedDex` (default) or `JupiterAdapter` (`DEX_ADAPTER=jupiter`) |
| LP interaction | SOL transfer as proxy for LP | Orca Whirlpool SDK |

---

## 7. Events Reference

Agents emit these events on their `EventEmitter` interface:

| Event | Payload | When |
|-------|---------|------|
| `started` | `{ agentId }` | Agent loop begins |
| `cycle_start` | `{ agentId, cycle }` | Each cycle begins |
| `action` | `{ agentId, action, cycle }` | Agent decides to act |
| `cycle_end` | `{ agentId, cycle, action }` | Cycle completes |
| `error` | `{ agentId, error, cycle }` | Unhandled exception in cycle |
| `stopped` | `{ agentId, cycles }` | Agent self-terminates |
| `paused` | `{ agentId }` | Agent paused externally |
| `resumed` | `{ agentId }` | Agent resumed |

Wallet events (from `AgentWallet`):
| Event | Payload |
|-------|---------|
| `created` | `{ agentId, publicKey }` |
| `airdrop` | `{ sig, amount }` |
| `transfer` | `{ type, sig, amount, to }` |
| `custom_tx` | `{ sig }` |

---

## 8. Environment Variables

```bash
SOLANA_CLUSTER=devnet           # devnet | testnet | mainnet-beta
SOLANA_RPC_URL=https://...      # Custom RPC (overrides cluster default)
ENCRYPTION_SECRET=...           # 32+ char secret for key encryption
AGENT_CYCLE_MS=5000             # Default cycle interval in ms
AUTO_AIRDROP=true               # Fund wallets on first run
AIRDROP_AMOUNT_SOL=1            # SOL amount per airdrop
LOG_LEVEL=info                  # error | warn | info | debug
DASHBOARD_ENABLE=true           # Enable web dashboard
DASHBOARD_PORT=3000             # Port for web dashboard
DEX_ADAPTER=simulated           # simulated | jupiter (controls which DEX adapter agents use)
ORACLE_SOURCE=mock              # mock | pyth (controls price oracle source)
ORACLE_MAX_STALENESS_MS=0       # Max allowed age of oracle data (0 = no check)
PYTH_FEED_ID=                   # Optional Pyth price feed ID for devnet/mainnet
JUP_BASE_MINT=So111111...       # Base token mint (usually wrapped SOL)
JUP_QUOTE_MINT=4zMMC9...        # Quote token mint (USDC devnet by default)
JUP_SLIPPAGE_BPS=50             # Max slippage in basis points for Jupiter swaps
```

Key behaviors:

- Setting `DEX_ADAPTER=jupiter` switches TradingAgents from the simulated DEX to real Jupiter swaps.
- Setting `ORACLE_SOURCE=pyth` enables Pyth price feeds (with automatic fallback to the mock oracle when unavailable).

---

## 9. Dashboard Capabilities

The system includes both CLI and web-based dashboards for monitoring agents:

### Web Dashboard
- Real-time metrics visualization
- Interactive agent controls
- Balance distribution charts
- Transaction history tracking
- Performance metrics monitoring

### Enhanced CLI Observer
- Colorful terminal UI with blessed
- Real-time updating tables
- Visual charts in terminal
- Performance metrics display

Run the web dashboard with: `npm run dashboard`
Run the CLI observer with: `npm run observe`

---

## 10. File Structure Quick Reference

```
src/
├── wallet/
│   ├── AgentWallet.ts      ← Core wallet: sign, send, balance
│   ├── KeyManager.ts       ← Encrypted key persistence
│   └── WalletRegistry.ts   ← Multi-agent wallet manager
├── agent/
│   ├── BaseAgent.ts        ← Abstract agent with Observe→Think→Act loop
│   ├── TradingAgent.ts     ← MA crossover trading strategy
│   └── LiquidityAgent.ts   ← Impermanent loss aware LP agent
├── oracles/
│   ├── OracleFactory.ts    ← Chooses between mock and Pyth price oracles
│   └── PythPriceOracle.ts  ← Live price feed (via Pyth Hermes API)
├── protocols/
│   ├── MockPriceOracle.ts  ← GBM price simulation
│   ├── MockPoolOracle.ts   ← AMM pool state simulation
│   ├── SimulatedDex.ts     ← Devnet trade execution proxy
│   └── JupiterAdapter.ts   ← Jupiter DEX integration (quote + swap APIs)
├── cli/
│   ├── observer.ts         ← Enhanced live balance/activity dashboard
│   └── dashboard.ts        ← Web-based dashboard server
├── dashboard/
│   ├── DashboardServer.ts  ← Web dashboard server with Socket.IO
│   ├── EnhancedObserver.ts ← Advanced CLI dashboard using blessed
│   └── RealTimeMetricsService.ts ← Real-time metrics collection
├── utils/
│   ├── logger.ts           ← Winston logger
│   └── connection.ts       ← Solana Connection factory
└── tests/
    └── integration.ts      ← Full test suite (10 tests)
```
