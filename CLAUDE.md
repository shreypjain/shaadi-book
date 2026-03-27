# Shaadi Book — Project Context

## What This Is
Live prediction market web app for Parsh & Spoorthi's wedding in Udaipur. Guests bet real money (USD) on wedding outcomes via an LMSR automated market maker. 20% charity fee on winnings.

## Stack
- Frontend: Next.js 14 (App Router) + Tailwind CSS + shadcn/ui
- Backend: Node.js + Express + tRPC
- Database: PostgreSQL 16 + Prisma ORM
- Real-time: Socket.io (WebSocket) with Redis adapter
- Auth: Custom OTP via Twilio Verify (phone-based, supports +1 US and +91 IN)
- Payments: Stripe only (Apple Pay + credit card, USD). No Razorpay.
- Hosting: Vercel (frontend) + Railway (backend, Postgres, Redis)

## Architecture Rules
- All monetary operations go through the append-only `transactions` table.
- User balances are ALWAYS derived from the transactions ledger, never stored independently.
- The LMSR purchase engine runs inside a single Postgres transaction with row-level locking.
- Every transaction row has a SHA-256 hash chain. No UPDATE/DELETE on `transactions` or `purchases` — trigger-enforced.
- Double-entry bookkeeping: every transaction has debit_account and credit_account.
- Reconciliation invariant: SUM(user balances) + SUM(charity fees) + SUM(withdrawals paid) = SUM(deposits received) — checked on every balance-modifying transaction.
- Adaptive b formula: b(t,V) = max(b_floor, 20 + (0.6 * 0.25 * sqrt(dt_ms)) + (0.4 * 0.5 * V))
- $50 max bet per user per market.
- No selling — buy and hold until resolution.

## Conventions
- TypeScript strict mode everywhere.
- Prisma for DB schema + migrations. Raw SQL only for LMSR cost function (performance).
- API routes use tRPC with Zod validation.
- All prices in cents (integer math) to avoid floating point issues. $0.50 = 50.
- Use Decimal.js for LMSR math precision.
- Error handling: never swallow errors in the purchase engine. ROLLBACK + log + alert.
- Vitest for all tests.

## Testing
- Unit tests for LMSR math (cost function, price calculation, binary search).
- Integration tests for purchase engine (concurrent purchases, cap enforcement, reconciliation).
- E2E tests for Stripe payment webhooks (mock checkout.session.completed).

## File Structure
```
shaadi-book/
├── frontend/          # Next.js 14 app
│   ├── app/           # App Router pages
│   ├── components/    # React components
│   └── lib/           # Client utilities
├── backend/           # Express + tRPC server
│   ├── src/
│   │   ├── routers/   # tRPC routers
│   │   ├── services/  # Business logic (LMSR, ledger, payments)
│   │   ├── ws/        # WebSocket handlers
│   │   └── utils/     # Shared utilities
│   └── prisma/        # Schema + migrations
├── shared/            # Shared types between frontend/backend
├── docker-compose.yml
├── CLAUDE.md
└── PRD.md             # Full product requirements document — READ THIS for detailed specs
```

## Key PRD Sections for Reference
- Section 4.2: LMSR pricing formulas
- Section 4.3: Adaptive b parameter formula
- Section 6.2: Complete data model
- Section 6.3: Purchase engine pseudocode
- Section 6.4: Market resolution flow
- Section 7.4: Immutable ledger guarantees
- Appendix A: Exact API patterns for Stripe, Twilio, Socket.io, Prisma

## Commands
```bash
# Local dev
docker compose up -d          # Start Postgres + Redis
cd backend && npm run dev     # Backend on :3001
cd frontend && npm run dev    # Frontend on :3000

# Database
cd backend && npx prisma migrate dev    # Run migrations
cd backend && npx prisma studio         # DB browser

# Tests
cd backend && npm test        # Vitest
cd frontend && npm test       # Vitest
```
