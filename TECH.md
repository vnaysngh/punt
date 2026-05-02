# Punt — Technical Overview for GTM

This document explains how Punt works under the hood. Written for a GTM conversation — no code required to follow.

---

## The Product in One Paragraph

Punt is a live binary prediction market running 24/7 on Canton Network. Every 15 minutes, a round opens. Users connect their Canton wallet (Loop or Console), deposit CBTC (Canton Bitcoin), and bet on whether the BTC/USD price will be higher or lower when the round closes. Winners split the pot. A new round starts immediately. There is no counterparty risk, no order books, no liquidity providers — just a pooled bet settled by a live price feed.

---

## How a Round Works

```
0:00  Round opens — betting live
      Users place UP or DOWN bets

10:00 Betting locks (5 min before close)
      No new bets accepted

15:00 Round closes
      Server fetches live BTC/USD price
      Compares to opening price
      → UP wins, DOWN wins, or DRAW (full refund)
      Winners receive: (their bet / total winning pool) × (total pool × 95%)
      Platform takes 5% fee
      New round starts immediately
```

Edge cases handled automatically:
- **Draw** (price unchanged): full refund, no fee
- **All bets one side**: full refund, no fee (no counterparty)

---

## Architecture Overview

```
Browser (Next.js)
    │
    ├── Loop Wallet SDK (QR mobile) ──┐
    ├── Console Wallet SDK (extension) ┤── Canton Network (CBTC)
    │                                  │
    └── API Routes (Vercel serverless)─┘
            │
            ├── PostgreSQL (Supabase) — balances, bets, markets
            ├── Chainlink / Binance / Coinbase — BTC price
            └── Cron jobs — market cycling, deposit sweep
```

Everything financial settles on Canton Network. The database is the off-chain accounting layer. The two are kept in sync by the deposit and withdrawal flows.

---

## Canton Network Integration

Canton is a privacy-preserving enterprise blockchain. Punt uses it for:

**CBTC (Canton Bitcoin)** — the betting token. Users hold CBTC in their Loop or Console wallet. All deposits and withdrawals move real CBTC on-chain.

**Party IDs** — each Canton wallet has a unique on-chain identity in the format `alias::hex-fingerprint`. This is used for auth and routing transfers.

**TransferInstruction pattern** — when a user deposits:
1. User's wallet creates a pending `TransferInstruction` on-chain (funds held in escrow)
2. Punt's server reads this instruction and accepts it using the operator's key
3. Only after on-chain settlement does the server credit the user's in-app balance

This means user funds can never be credited without an on-chain transaction. No trust required.

---

## Authentication Flow

Punt uses a **cryptographic challenge-response** system — no passwords, no OAuth:

1. Browser asks server for a challenge (32 random bytes, 5-min TTL)
2. User's wallet signs the challenge with their Canton private key (Ed25519)
3. Server verifies the signature against the on-chain public key
4. Server issues a 7-day JWT session

The user's Canton wallet is their identity. If they control the wallet, they control the account.

---

## Deposit Flow

1. User enters CBTC amount in the deposit modal
2. Loop/Console wallet creates a pending transfer on Canton (async mode)
3. Browser sends the Canton contract ID to Punt's server
4. Server finds the pending instruction on-chain, verifies sender + amount
5. Server accepts the transfer using the operator private key
6. Server credits user's in-app balance in PostgreSQL (atomically, deduplicated by Canton contract ID)
7. Fallback cron runs every 2 minutes to catch any missed deposits

User's CBTC goes: **Loop/Console wallet → Punt app wallet (Canton) → in-app balance (PostgreSQL)**

---

## Betting Flow

Once a user has an in-app balance:

1. User picks UP or DOWN, enters amount, confirms
2. Server validates: market open, not in lock window, sufficient balance, one bet per user per market
3. Balance deducted atomically in DB (with `WHERE balance >= amount` guard — no overdraft possible)
4. Bet recorded with direction, amount, market ID

No Canton transaction happens at bet time — bets are purely off-chain for speed. Only deposits and withdrawals touch the blockchain.

---

## Settlement Flow

Runs every 30 seconds via cron (Vercel native cron + node-cron worker):

1. Find all expired markets
2. Fetch BTC/USD price: **Chainlink (Arbitrum)** → Binance → Coinbase → Kraken → CoinGecko
3. Compare close price to open price → determine winner
4. Calculate payouts in **integer arithmetic** (satoshis, BigInt) — no floating point errors
5. Credit winners' balances atomically
6. Create new OPEN market immediately
7. Self-healing: `GET /api/markets` also settles expired rounds inline — system never stalls even if cron is down

---

## Withdrawal Flow

1. Server issues a fresh one-time challenge
2. User signs it with their wallet (proves they still own the wallet)
3. Server deducts balance from DB and creates PENDING withdrawal record (atomic)
4. Server sends CBTC transfer on Canton using operator key
5. On success: withdrawal marked CONFIRMED with Canton transaction ID
6. On failure: balance rolled back (if Canton failed before execution) or flagged for manual reconciliation (if Canton failed after)

---

## Price Oracle

BTC/USD settlement price is fetched from a 5-source waterfall:

| Priority | Source | Type |
|---|---|---|
| 1 | Chainlink on Arbitrum | On-chain, cryptographically verified |
| 2 | Binance REST | CEX REST API |
| 3 | Coinbase REST | CEX REST API |
| 4 | Kraken REST | CEX REST API |
| 5 | CoinGecko REST | Aggregator REST API |

Settlement is blocked if all sources fail. First successful source wins.

The live BTC price shown in the browser comes from **Binance WebSocket** (`wss://stream.binance.com/ws/btcusdt@aggTrade`) with a REST fallback — this is display only and does not affect settlement.

---

## Security Model

| Threat | Mitigation |
|---|---|
| Unauthorized withdrawal | Ed25519 signature required on every withdrawal |
| Double-spend on deposit | Canton contract ID used as dedup key in DB |
| Balance overdraft | DB transaction with `WHERE balance >= amount` guard |
| Cron manipulation | `CRON_SECRET` header required on all cron routes |
| Price manipulation | 5-source oracle waterfall, Chainlink primary |
| Float arithmetic errors | All payout math in BigInt satoshis |
| Bot abuse | Edge middleware rate limiting + bot blocking |

---

## Deployment

- **Vercel** — frontend, all API routes, native cron triggers (every 1–5 min)
- **Railway** (optional) — standalone `node-cron` worker for 30-second market cycling
- **Supabase** — managed PostgreSQL
- **Canton mainnet** — `cantonloop.com` (configurable to devnet for testing)

---

## Key Numbers

- Round duration: **15 minutes**
- Betting lock window: **last 5 minutes** of each round
- Platform fee: **5%** of winning pool
- Cron frequency: **every 30 seconds**
- JWT session: **7 days**
- Deposit sweep fallback: **every 2 minutes**
- Supported tokens: **CBTC** (Canton Bitcoin)
- Supported wallets: **Loop** (mobile QR), **Console** (browser extension)
