# Monte Carlo Simulation Report

A full-stack Next.js App Router MVP for trading-system Monte Carlo reports.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui-style components
- Prisma ORM
- SQLite
- Recharts
- Vitest

## Local Setup

1. Create `.env`:

```bash
DATABASE_URL="file:./dev.db"
```

2. Install dependencies:

```bash
corepack pnpm install
```

3. Create database tables:

```bash
corepack pnpm prisma migrate dev
```

If Prisma migrate is unavailable in a restricted local shell, initialize the SQLite tables directly:

```bash
corepack pnpm run db:init-sqlite
```

4. Start the app:

```bash
corepack pnpm dev
```

Open `http://localhost:3000`.

## CSV Fields

CSV upload supports:

```text
date,symbol,direction,pnl,riskAmount,rMultiple,note
```

If `rMultiple` exists, it is used directly. Otherwise the importer computes `rMultiple = pnl / riskAmount`.
