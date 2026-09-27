# KORAMP — Crypto On/Off-Ramp

**Top Up Crypto & Sell Crypto with IDR**

Wallet-only crypto on/off-ramp. No account registration required.

## Stack

- Next.js 14 · TypeScript · Prisma · SQLite/PostgreSQL
- Wagmi + RainbowKit (EVM) · Solana Wallet Adapter
- Xendit (QRIS payment collection + IDR bank payouts; Payments API v3 + Payout API v3)

## Setup

```bash
cp .env.example .env
# Fill in all values in .env

npm install
npx prisma db push
node scripts/setup-admin.cjs   # generate admin key (run locally, never commit output)
npm run dev
```

## Environment

Copy `.env.example` → `.env` and fill in:
- `DATABASE_URL`
- `XENDIT_API_KEY`, `XENDIT_MODE`, `XENDIT_WEBHOOK_TOKEN`
- `JWT_SECRET`, `ADMIN_ACCESS_KEY`
- Blockchain RPC URLs and platform wallet private keys

See `.env.example` for full list.
