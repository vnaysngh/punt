# Punt — Binary Prediction Market on Canton Network

**Punt** is a perpetual binary prediction market where users bet CBTC (Canton Bitcoin) on whether BTC/USD will go UP or DOWN over 15-minute rounds. Built on Canton Network with Loop Wallet integration.

🌐 **Live at:** [takeapunt.bet](https://takeapunt.bet)

---

## What It Is

Every 15 minutes, a new round opens. Users pick UP or DOWN on the BTC/USD price. At close, the live price is fetched, winners split the pool (minus a 5% platform fee), and a new round starts immediately. Betting locks 5 minutes before each round closes.

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS v4, Framer Motion
- **Backend:** Next.js API routes, PostgreSQL (Supabase), Prisma ORM
- **Blockchain:** Canton Network — CBTC token transfers via Loop SDK
- **Auth:** Ed25519 challenge-response signatures + JWT sessions
- **Price Oracle:** Chainlink on Arbitrum → Binance → Coinbase → Kraken → CoinGecko
- **Deployment:** Vercel (frontend + API + crons)

## Wallets Supported

- **Loop Wallet** — QR-based mobile wallet (primary)
- **Console Wallet** — browser extension

## Quick Start

```bash
npm install
cp .env.example .env.local
# fill in .env.local
npm run dev
```

See `.env.example` for all required environment variables.

## Key Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | HS256 JWT signing secret |
| `LOOP_PRIVATE_KEY` | Operator Canton private key |
| `APP_PARTY_ID` | Operator Canton party ID |
| `CRON_SECRET` | Secret for authenticating cron routes |
| `NEXT_PUBLIC_LOOP_NETWORK` | `mainnet` or `devnet` |
| `NEXT_PUBLIC_CBTC_INSTRUMENT_ID` | CBTC token instrument ID on Canton |

## Project Structure

```
src/
├── app/
│   ├── page.tsx              — Main betting UI
│   ├── portfolio/page.tsx    — User balance & history
│   └── api/                  — All API routes
├── components/               — UI components
├── lib/                      — Server utilities (canton, auth, price)
├── store/                    — Zustand state (wallet, markets)
└── workers/start-cron.ts     — Standalone cron process
prisma/schema.prisma          — DB schema
vercel.json                   — Cron schedules
```
