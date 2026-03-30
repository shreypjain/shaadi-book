# Shaadi Book — Project Context

## What This Is
Live prediction market web app for Parsh & Spoorthi's wedding in Udaipur. Guests bet real money (USD) on wedding outcomes via an LMSR automated market maker. 10% of winnings go to charity — collected externally via Venmo after the wedding, not tracked in-app.

## Stack
- Frontend: Next.js 14 (App Router) + Tailwind CSS + shadcn/ui
- Backend: Node.js + Express + tRPC
- Database: PostgreSQL 16 + Prisma ORM
- Real-time: Socket.io (WebSocket) with Redis adapter
- Auth: Custom OTP via Twilio Verify (phone-based, supports +1 US and +91 IN)
- Payments: Stripe (ACH preferred, card fallback, USD)
- Hosting: DigitalOcean droplet (159.223.173.109) — Docker Compose with Caddy + Next.js + Express + Postgres + Redis
- Domain: markets.parshandspoorthi.com (SSL via Caddy/Let's Encrypt)
- CI/CD: GitHub Actions → SSH deploy to droplet on push to main

## Architecture Rules
- All monetary operations go through the append-only `transactions` table.
- User balances are ALWAYS derived from the transactions ledger, never stored independently.
- The LMSR purchase engine runs inside a single Postgres transaction with row-level locking.
- Every transaction row has a SHA-256 hash chain. No UPDATE/DELETE on `transactions` or `purchases` — trigger-enforced.
- Double-entry bookkeeping: every transaction has debit_account and credit_account.
- Reconciliation invariant: SUM(user balances) + SUM(withdrawals paid) = SUM(deposits received) — checked on every balance-modifying transaction.
- **Capped parimutuel resolution**: payout_per_share = min($1.00, total_pool / winning_shares). House NEVER loses.
- **House seeding**: markets auto-seed $20/outcome from a House account on creation (internal ledger credit, no Stripe).
- **Minimum 5 unique bettors** to resolve a market.
- Adaptive b formula: b(t,V) = max(b_floor, 20 + (0.6 * 0.25 * sqrt(dt_ms)) + (0.4 * 0.5 * V))
- $200 max bet per user per market.
- No selling — buy and hold until resolution.

## Deployment & Operations
- Production: `docker compose -f docker-compose.prod.yml` on DO droplet
- SSH: `ssh -i ~/.ssh/shaadi_droplet root@159.223.173.109`
- Deploy: push to main → GitHub Actions auto-deploys, or manual: `git pull && docker compose build && up -d`
- Env: `.env` on droplet only (never committed). Contains Stripe live keys, Twilio, JWT secret.
- Migrations: `docker compose exec -T api npx prisma migrate deploy`
- Hash chain fixes: use `/tmp/fix-chain.mjs` script via `docker cp` + `docker exec`

## Agent Orchestration (Arcanist)
This project is developed using Claude Code as an orchestrator with Arcanist coding agents.
See the arcanist skill instructions for full patterns. Key conventions:
- Launch agents with detailed prompts including file paths, exact changes, branch names
- Always include "Create a PR to main" in agent prompts
- Poll for PRs with exponential backoff after launching agents
- Nudge stuck agents with `arcanist message <session-id>`
- Review PRs: check diffs, rebase conflicts, merge with `gh pr merge --admin`
- After merging: pull to droplet, rebuild, run migrations, fix hash chain if needed
- Close stale/superseded PRs with comments explaining why

## Workbook — Shared Agent Context (.workbook/WORKBOOK.md)
Every Claude Code session on this repo MUST use the workbook to coordinate with other sessions.

### On session start:
1. Generate your agent name: run `~/.claude/scripts/workbook-init.sh` to get a city-based ID
2. Read `.workbook/WORKBOOK.md` to see what other agents are doing
3. Register yourself in the Active Sessions table

### Before starting work:
1. Read the workbook's "In Progress" section
2. If another agent is touching the same files, coordinate or pick different work
3. Claim your task by moving it from "Up Next" to "In Progress" with your name and files

### Updating the workbook:
1. Acquire lock: `~/.claude/scripts/workbook-lock.sh`
2. Read the file, make edits, write back
3. Release lock: `~/.claude/scripts/workbook-unlock.sh`
4. If lock fails (another agent writing), retry with exponential backoff (the lock script handles this)
5. Update the "Last updated" timestamp at the bottom

### When finishing work:
1. Move your task from "In Progress" to "Recently Completed"
2. Note any PRs created, dependencies, or follow-up needed
3. Remove yourself from Active Sessions if the conversation is ending

### Key rules:
- NEVER skip reading the workbook before starting work on files
- Always list the specific files you're touching so others avoid them
- If you see a merge conflict risk, note it in Dependencies & Blockers
- Keep the workbook concise — it's a standup board, not a novel

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
