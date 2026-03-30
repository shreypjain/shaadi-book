# Workbook — Shared Agent Standup

> Read before starting work. Update when you start/finish tasks.
> Lock: `~/.claude/scripts/workbook-lock.sh` before writing, `~/.claude/scripts/workbook-unlock.sh` after.

## Active Sessions
| Agent | Working On | Files Touched | Started |
|-------|-----------|---------------|---------|
| Udaipur-main | Orchestration, PR review, deploys | CLAUDE.md, .workbook/ | 2026-03-28 |

## In Progress
- [Arcanist:048c4a66] SMS notifications — top 5 hottest markets, resolution alerts (backend/src/services/smsNotifier.ts, notificationService.ts, marketService.ts)
- [Arcanist:984dd163] Min 5 bettors + house seed $20/outcome (backend/src/services/marketService.ts, purchaseEngine.ts, prisma/schema.prisma)
- [Arcanist:79a7b1a3] Stripe ACH bank transfers (backend/src/routers/payment.ts, services/stripe.ts, frontend/components/DepositButton.tsx)

## Up Next
- Razorpay UPI integration for Indian guests
- Deposit flow on insufficient balance (re-do after parimutuel lands)
- E2E Playwright tests (redo with test user bypass)

## Recently Completed
- [2026-03-29] PR #44 — UI polish: next/font migration, design system refinements
- [2026-03-29] PR #42 — Luxury UI redesign: Cormorant Garamond, gold/ivory palette
- [2026-03-29] PR #43 — PS favicon, manifest, SMS branding
- [2026-03-29] PR #40 — Rules/how-to-play page rewrite
- [2026-03-29] PR #37 — Price history charts with 1h/2h/4h snapshots
- [2026-03-29] PR #38 — Capped parimutuel resolution + $200 max bet
- [2026-03-28] PR #34 — SMS notifications for new markets + periodic updates
- [2026-03-28] Stripe live keys deployed, webhook fixed to payment_intent.succeeded
- [2026-03-28] Production Docker deploy on DO droplet (Caddy + Next.js + Express + PG + Redis)

## Dependencies & Blockers
- [Stripe ACH] independent — no blockers
- [House seeding] depends on parimutuel resolution being on main (already merged)
- [SMS resolution alerts] depends on marketService.resolveMarket having the pool data available

## Merge Order
1. SMS notifications (#pending) — independent
2. House seeding (#pending) — may touch marketService.ts, merge after SMS
3. Stripe ACH (#pending) — independent of above

---
*Last updated: 2026-03-30T04:00:00Z*
