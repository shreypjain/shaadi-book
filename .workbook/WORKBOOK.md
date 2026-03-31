# Workbook — Shared Agent Standup

> Read before starting work. Update when you start/finish tasks.
> Lock: `~/.claude/scripts/workbook-lock.sh` before writing, `~/.claude/scripts/workbook-unlock.sh` after.

## Active Sessions
| Agent | Working On | Files Touched | Started |
|-------|-----------|---------------|---------|
| CC-main | Orchestration, PR review, deploys, UI fixes | All frontend pages, components | 2026-03-28 |
| CC-secondary | Sell shares, house seeding, feature work | backend services, frontend features | 2026-03-29 |

## In Progress
- [PR #67] Fix share pricing (raise maxShares to 1000), remove price impact, add inline deposit — UNDER REVIEW
- [Arcanist:42b5b62e] Fixing PR #49 isHouse bugs + rebase onto main

## Up Next
- Responsiveness polish (PriceChart tooltip clamping, chart height responsive)
- E2E Playwright tests (redo with test user bypass)

## Recently Completed
- [2026-03-31] feat/trade-history-admin-void — Full trade log (paginated), admin time-based voiding, custom resolution timestamp
- [2026-03-30] Portal modals to document.body — fixes stacking context bug on deposit/suggest modals
- [2026-03-30] Deposit modal redesign — centered overlay, opaque white bg, gold theme, scrollable
- [2026-03-30] Responsive fixes — line-clamp on cards, flex-wrap on pills, input sizing
- [2026-03-30] Design system token unification — 321 replacements across 31 files
- [2026-03-30] PR #48 — Replace hardcoded hex colors with design tokens
- [2026-03-30] PR #46 — Integrate PriceChart into market detail page
- [2026-03-30] PR #45 — Unify tab and filter styles (gold pills/underlines)
- [2026-03-30] PR #50 — Login fix: returning users skip name field
- [2026-03-30] Apple Pay domain registration + verification file
- [2026-03-30] ACH/US bank account enabled on Stripe
- [2026-03-30] $100 credited to Shrey's account
- [2026-03-30] PR #66 — CLOSED (superseded, features already on main)
- [2026-03-29] PR #44 — UI polish: next/font migration, design system refinements
- [2026-03-29] PR #42 — Luxury UI redesign: Cormorant Garamond, gold/ivory palette
- [2026-03-29] PR #40 — Rules/how-to-play page rewrite
- [2026-03-29] PR #38 — Capped parimutuel resolution + $200 max bet
- [2026-03-29] PR #37 — Price history charts with snapshots
- [2026-03-29] PR #36 — Market suggestion UI
- [2026-03-29] PR #35 — Max bet $50 → $200
- [2026-03-29] PRs #27-#32 — Charity, payout, rules, BuyForm, deposit flow
- [2026-03-28] Production Docker deploy on DO droplet

## Key Architecture Decisions
- **No in-app charity fee** — 10% collected externally via Venmo
- **Parimutuel resolution** — winners split pool, capped at $1/share
- **$200 max bet** per user per market
- **All modals use React portals** to escape parent stacking contexts
- **Apple Pay** registered for markets.parshandspoorthi.com

## Open PRs
- #67 — Fix share pricing, raise maxShares, inline deposit (REVIEWING)

---
*Last updated: 2026-03-30T06:45:00Z*
