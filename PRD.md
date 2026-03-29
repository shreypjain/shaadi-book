# Shaadi Book — PRD & Technical Spec
### Live Prediction Market for Parsh & Spoorthi's Wedding · Udaipur

**Author:** Shrey Jain
**Version:** 0.1 · March 2026

---

## 1. Product Overview

Shaadi Book is a mobile-first web application that runs a live prediction market during Parsh and Spoorthi's wedding in Udaipur. Guests buy in with real money (via Apple Pay or credit card), place bets on wedding-related outcomes, and cash out winnings via Venmo/Zelle after market resolution. All transactions are in USD.

**Core loop:** Admin creates market → Guests see live odds → Guests place orders on a central limit order book → Admin resolves market → Winnings distributed → Guests cash out.

---

## 2. Users & Roles

| Role | Description | Auth |
|------|-------------|------|
| **Guest** | Wedding attendee. Browses markets, deposits credits, places bets, withdraws winnings. | Name + phone → OTP (supports +91 IN and +1 US numbers) |
| **Admin** | Shrey or Parsh. Creates/resolves markets, manages questions, monitors activity. | Same OTP flow + admin flag on account (whitelisted phone numbers) |

---

## 3. User Flows

### 3.1 Guest Onboarding
1. Guest scans QR code at venue **or** opens link shared beforehand.
2. Enters name + phone number (country picker for IN/US).
3. Receives OTP via SMS, verifies.
4. Lands on market feed — account created with $0 balance.
5. Taps "Add Credits" → Apple Pay or credit card (all guests, charged in USD) → credits appear instantly. Indian guests see a ₹93 = $1 reference rate for convenience.

### 3.2 Placing a Bet
1. Guest taps into a market (e.g., "Will the groom cry during the pheras?").
2. Sees current prices for each outcome (e.g., Yes: 62¢ / No: 38¢) with implied probability bars.
3. Selects an outcome (e.g., "Yes").
4. Enters dollar amount (max $200 per market, system shows remaining capacity).
5. UI previews the purchase: "You'll get 14.3 shares of Yes at avg $0.70. Price moves from $0.62 → $0.78."
6. Confirms → balance debited, shares added to position, prices update for everyone.
7. Position appears in "My Bets" tab. No cancellation, no selling — you're locked in until resolution.

### 3.3 Admin: Market Creation
- **Web admin panel:** Form with question text, outcome labels (2–5), and market open/close times.
- **SMS shortcut:** Admin texts a formatted string (e.g., `NEW | Will Spoorthi's dad dance to Bollywood? | Yes, No`) to a Twilio number → system parses and creates market → confirms via SMS reply.
- Markets can be created in advance or live during the event.

### 3.4 Admin: Market Resolution
- **Web admin panel:** Select market → select winning outcome → confirm → market resolved.
- **SMS shortcut:** Admin texts `RESOLVE | <market_id> | <winning_outcome>` → system resolves → confirms via SMS.
- On resolution:
  1. Each share of the winning outcome pays out $1.00 gross.
  2. 20% charity fee deducted → net $0.80 per winning share credited to balance.
  3. Losing shares pay $0.00.
  4. Charity fee accumulated in charity pool (displayed on leaderboard).
  5. All prices freeze and market is marked resolved.

### 3.5 Cash-Out
1. Guest navigates to "Wallet" → taps "Withdraw."
2. Enters Venmo handle or Zelle email/phone.
3. Shrey sends payout manually from his Venmo/Zelle and marks complete in admin panel.
4. All payouts batched post-event. Admin dashboard shows all pending and completed withdrawals.

---

## 4. Market & Pricing Mechanics

### 4.1 Instrument Design
- Each market has 2–5 **mutually exclusive, exhaustive outcomes**.
- Each outcome is a contract that pays $1.00 if correct, $0.00 if not.
- There is a **single price** per outcome at any given moment — no bid/ask spread.
- Prices always sum to $1.00 across all outcomes (guaranteed by the AMM).
- **No selling.** Once you buy a position, you hold it until the market resolves.

### 4.2 Automated Market Maker — LMSR

The system uses a **Logarithmic Market Scoring Rule (LMSR)**, the same mechanism used by early prediction markets. There is no order book. The house (Shrey) effectively takes the other side of every trade via a mathematical pricing function.

**How it works:**

Each market tracks a vector of outstanding shares per outcome: `q = [q1, q2, ..., qn]`. The cost function and prices are:

```
Cost function:    C(q) = b × ln(Σ e^(qi/b))

Price of outcome i:  p(i) = e^(qi/b) / Σ e^(qj/b)

Cost to buy Δ shares of outcome i:
cost = C(q1, ..., qi + Δ, ..., qn) - C(q1, ..., qi, ..., qn)
```

**Key properties:**
- Prices always sum to exactly $1.00 — no arbitrage possible.
- Every purchase of one outcome increases its price and decreases all others.
- No liquidity problem — the AMM always offers a price, regardless of how many guests are active.
- Price moves are smooth and continuous.

### 4.3 Adaptive Liquidity Parameter `b(t, V)`

The parameter `b` controls price sensitivity. It adapts dynamically using a **hybrid of market age and volume** — early bets on fresh markets swing prices hard, and the market hardens as both time passes and money flows in.

**Formula:**
```
b(t, V) = b_floor + (w_time × k_t × √(Δt_ms)) + (w_vol × k_v × V)

where:
  b_floor  = 20          — absolute minimum, ensures first bet has massive impact
  w_time   = 0.6         — weight for time component (60%)
  w_vol    = 0.4         — weight for volume component (40%)
  k_t      = 0.25        — time scaling constant
  k_v      = 0.5         — volume scaling constant (per dollar of volume)
  Δt_ms    = milliseconds since market opened
  V        = total dollar volume in this market (sum of all purchases)
```

**Why hybrid:** Pure time-based means a market open for an hour with zero bets is rock-solid stable (wrong — it has no price discovery). Pure volume-based means a market that gets $500 in the first 10 seconds is already frozen (wrong — it should still be reactive early). The hybrid ensures you need **both** time **and** money to harden a market.

**Behavior — effect of a single $200 max bet on a 50/50 binary:**

| Market age | Volume before bet | b(t,V) | $200 bet moves price from 50¢ to... |
|------------|-------------------|--------|-------------------------------------|
| 0 sec | $0 | 20 | 92¢ (first mover massively rewarded) |
| 30 sec | $0 | 46 | 83¢ (time alone provides some stability) |
| 30 sec | $100 | 66 | 75¢ (volume adds significant damping) |
| 2 min | $200 | 106 | 66¢ (market maturing) |
| 5 min | $500 | 182 | 60¢ (stable market) |
| 15 min | $1000 | 447 | 55¢ (hardened market) |
| 30 min | $2000 | 661 | 54¢ (effectively settled) |

**The weighting (60% time / 40% volume) means:**
- Time provides a baseline hardening so markets don't stay permanently volatile even with low participation.
- Volume rewards popular markets with faster stabilization.
- A market that's been open 30 min with zero bets still has `b ≈ 82` (not frozen, but not trivially manipulable).
- A market that gets $500 in the first minute has `b ≈ 218` (volume fast-tracks maturity).

**House exposure:** Worst-case loss is `b(t,V) × ln(n)` at any given moment. Because `b` grows with both time and volume, exposure increases as the market matures — but so does the volume of offsetting bets. At `b = 20` (market open, no volume): max binary loss = $13.86. At `b = 200` (after several minutes of trading): max binary loss = $138.63.

**Admin override:** Admin can set a custom `b_floor` per market at creation time if they want a specific market to be more or less reactive. The hybrid formula still applies on top.

### 4.4 Pricing Example — Binary Market

Market: "Will Spoorthi's dad give a speech?" — outcomes: Yes, No.
Opens at t=0: `q = [0, 0]`, `b(0,0) = 20`. Both prices = $0.50.

```
t=0s    V=$0    Guest A bets $20 on "Yes" → b=20  → price swings to Yes=$0.88, No=$0.12
t=15s   V=$20   Guest B bets $10 on "No"  → b=39  → price settles to Yes=$0.78, No=$0.22
t=45s   V=$30   Guest C bets $15 on "Yes" → b=56  → price moves to  Yes=$0.82, No=$0.18
t=2min  V=$45   Guest D bets $50 on "No"  → b=90  → price corrects to Yes=$0.65, No=$0.35
t=5min  V=$95   Guest E bets $10 on "Yes" → b=141 → price nudges to  Yes=$0.67, No=$0.33
...
Market resolves → "Yes" wins → each "Yes" share pays $1.00 (minus 20% charity fee)
```

Early movers (Guest A) got cheap shares and moved the market dramatically. Late movers (Guest E) paid more and barely moved it. This creates a natural incentive to bet early — perfect for generating excitement at the start of each wedding event.

### 4.5 Market Notifications

When an admin creates a new market, all connected guests receive a real-time notification:

**Notification flow:**
1. Admin creates market (via admin panel or SMS) → market status set to `pending`.
2. Admin sets market open time (now, or scheduled for a future time).
3. If **scheduled:** 5 minutes before open, all connected clients receive a WebSocket push: "New market opening in 5 min: 'Will the groom cry during the pheras?'" — with a countdown timer on the market card.
4. If **immediate:** All connected clients receive instant push — market card appears at top of feed with a "NEW" badge and a pulsing animation for 30 seconds.
5. Guests who are not currently on the app receive an **SMS notification** (via Twilio): "New bet just dropped on Shaadi Book! Open the app to place your bet." — sent to all registered phone numbers.

**Why this matters:** With the hybrid `b(t,V)`, early bets are disproportionately powerful. The notification system ensures everyone has a fair shot at being an early mover, which generates a burst of volume in the first 30 seconds — exactly the excitement loop you want at a wedding event.

### 4.6 What Guests Experience

The UX is radically simple compared to an order book:

1. **Get notified** — "New market just opened: Will the groom cry?"
2. **See the odds** — "Yes: 62¢ / No: 38¢"
3. **Pick a side** — tap "Yes" or "No"
4. **Enter dollar amount** — "$10" (max $200 per market)
5. **System calculates shares** — "You get 14.3 shares of Yes at avg price $0.70" (price slides as you buy more)
6. **Confirm** — balance debited, position locked until resolution
7. **Watch odds move** — your purchase just shifted the price for everyone

No limit orders, no order types, no cancellation, no selling. Just buy and hold.

---

## 5. Information Architecture

### 5.1 Guest Views
| Screen | Content |
|--------|---------|
| **Market Feed** | List of active markets with current odds (prices) per outcome, total volume, and time remaining. Sorted by recency. |
| **Market Detail** | Question, outcomes with live prices + implied probability bars, buy form, price history chart, recent purchases. |
| **My Bets** | Positions held (outcome, shares, avg cost, current value), potential payout if each outcome wins. |
| **Wallet** | Balance, deposit button, withdrawal button, transaction history. |
| **Leaderboard** | Ranked by total P&L across all resolved markets. Charity Impact counter. |

### 5.2 Admin Views
| Screen | Content |
|--------|---------|
| **Market Manager** | Create new market (question, outcomes, `b_floor` override, open time — immediate or scheduled), list all markets (active/pending/resolved), resolve market, void market. |
| **User Manager** | List of guests, balances, flag suspicious activity. |
| **Withdrawal Queue** | Pending withdrawal requests → approve/reject. |
| **Dashboard** | Total volume, active users, house pool balance, house exposure per market. |

---

## 6. Technical Architecture

### 6.1 Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Frontend** | Next.js (React) + Tailwind CSS | Mobile-first PWA, fast iteration, SSR for initial load. |
| **Backend API** | Node.js (Express or tRPC) | WebSocket support for real-time updates, JS ecosystem consistency. |
| **Database** | PostgreSQL | ACID transactions critical for AMM state updates and balance management. |
| **Real-time** | WebSockets (via Socket.io or native ws) | Push price updates, purchase events, market resolutions to all clients. |
| **SMS Gateway** | Twilio | OTP delivery (IN + US), admin SMS commands for market creation/resolution. |
| **Payments In** | Stripe (Apple Pay + credit card, all guests, USD only) | Webhook-driven deposits. Funds settle to Shrey's US bank account. |
| **Payments Out** | Manual Venmo/Zelle from Shrey | All payouts manual post-event. |
| **Hosting** | Vercel (frontend) + Railway or Render (backend + DB) | Simple deployment, auto-scaling, managed Postgres. |
| **Auth** | Custom OTP flow via Twilio Verify | No third-party auth provider needed; phone number is the identity. |

### 6.2 Data Model

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   users           │     │   markets         │     │   outcomes        │
├──────────────────┤     ├──────────────────┤     ├──────────────────┤
│ id (uuid)         │     │ id (uuid)         │     │ id (uuid)         │
│ name              │     │ question (text)    │     │ market_id (fk)    │
│ phone             │     │ status (enum)      │     │ label (text)      │
│ country (enum)    │     │ created_by (fk)    │     │ position (int)    │
│ role (enum)       │     │ opened_at          │     │ shares_sold (dec) │
│ created_at        │     │ scheduled_open_at  │     │ is_winner (bool?) │
└──────────────────┘     │ b_floor_override   │     └──────────────────┘
                          │ created_at         │
                          │ resolved_at        │
                          │ winning_outcome_id │
                          └──────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   positions       │     │   transactions    │     │   purchases       │
├──────────────────┤     ├──────────────────┤     ├──────────────────┤
│ id (uuid)         │     │ id (uuid)         │     │ id (uuid)         │
│ user_id (fk)      │     │ user_id (fk)      │     │ user_id (fk)      │
│ market_id (fk)    │     │ debit_account     │     │ market_id (fk)    │
│ outcome_id (fk)   │     │ credit_account    │     │ outcome_id (fk)   │
│ shares (decimal)  │     │ type (enum)       │     │ shares (decimal)  │
│ total_cost (dec)  │     │   deposit         │     │ cost (decimal)    │
│ created_at        │     │   purchase        │     │ avg_price (dec)   │
│ updated_at        │     │   withdrawal      │     │ price_before (dec)│
└──────────────────┘     │   payout          │     │ price_after (dec) │
                          │   charity_fee     │     │ created_at        │
                          │ amount (decimal)  │     └──────────────────┘
                          │ prev_hash (char64)│
                          │ tx_hash (char64)  │     ┌──────────────────┐
                          │ created_at        │     │   admin_audit_log │
                          └──────────────────┘     ├──────────────────┤
                                                    │ id (uuid)         │
┌──────────────────┐                                │ admin_id (fk)     │
│   charity_pool    │                                │ action (enum)     │
├──────────────────┤                                │ target_id (uuid)  │
│ total (decimal)   │  ← derived from SUM           │ metadata (jsonb)  │
└──────────────────┘    of charity_fee txns          │ ip_address (inet) │
                                                    │ created_at        │
                                                    └──────────────────┘
```

**Key differences from an order book model:**
- **No `orders` table.** There is no order book. The AMM is the counterparty.
- **`outcomes.shares_sold`** tracks the LMSR state vector `q[i]` — the total shares sold for each outcome. This is the only mutable market state and is the input to the pricing function.
- **`positions`** tracks each user's holdings per outcome per market. Updated on every purchase (append-only `purchases` table records the individual buys).
- **`purchases`** is the immutable record of every buy — includes shares received, cost paid, and the price before/after for audit.

**Key constraints:**
- **Append-only ledger:** The `transactions` and `purchases` tables are INSERT-only. No UPDATE, no DELETE — ever. Postgres RLS policy + trigger enforced.
- **Double-entry:** Every transaction has `debit_account` and `credit_account` fields. Sum of all debits = sum of all credits — trigger-enforced on INSERT.
- **Hash chain:** Each row's `tx_hash = SHA256(prev_hash || type || amount || user_id || created_at)`. Background worker verifies chain integrity every 60s.
- **Reconciliation invariant:** `SUM(user balances) + SUM(charity fees) + SUM(withdrawals paid) + SUM(house AMM pool) = SUM(deposits received)` — checked inside every balance-modifying transaction. Violation = ROLLBACK + admin alert.
- **User balance** is derived from the `transactions` ledger (never stored independently — always computed).
- **$200 per market cap** enforced at purchase: `SUM(purchases.cost) WHERE user_id = X AND market_id = Y <= 200.00`.

### 6.3 Purchase Engine (LMSR)

```
buyShares(userId, marketId, outcomeId, dollarAmount):
  1. Validate: market is active, user balance >= dollarAmount,
     user's total spend in this market + dollarAmount <= $200.
  2. BEGIN TRANSACTION
  3. Lock market's outcome rows (SELECT ... FOR UPDATE on outcomes where market_id).
  4. Compute adaptive b:
       Δt_ms = now_ms - market.opened_at_ms
       V = SUM(purchases.cost) WHERE market_id = marketId
       b = max(b_floor, 20 + (0.6 × 0.25 × √(Δt_ms)) + (0.4 × 0.5 × V))
  5. Read current state vector: q[] = outcomes[].shares_sold
  6. Compute current cost: C_before = b × ln(Σ e^(qi/b))
  7. Binary search for Δ shares such that:
       C(q1, ..., qi + Δ, ..., qn) - C_before = dollarAmount
       (solve to 4 decimal places)
  8. Update outcomes[i].shares_sold += Δ
  9. Compute new prices: p(j) = e^(qj/b) / Σ e^(qk/b) for all outcomes
  10. INSERT into purchases: { user, market, outcome, shares=Δ, cost=dollarAmount,
        price_before, price_after, b_at_purchase=b }
  11. INSERT into transactions: { type='purchase', debit=user, credit=house_amm,
        amount=dollarAmount, prev_hash, tx_hash }
  12. UPDATE positions: add Δ shares to user's position for this outcome
        (INSERT if first purchase, UPDATE shares += Δ and total_cost += dollarAmount if exists)
  13. Run reconciliation invariant — ROLLBACK if fails.
  14. Append hash chain entry.
  15. COMMIT TRANSACTION
  16. Broadcast via WebSocket:
        - New prices for all outcomes in this market
        - Purchase event (anonymized: "Someone bought Yes, price → 62¢")
        - Updated user balance (private channel)
```

**Price slippage display:** Before confirming, the UI shows the guest exactly how many shares they'll receive and the effective average price. For large purchases relative to `b`, the price slides significantly — this is shown clearly: "You'll get 14.3 shares at avg $0.70 (price moves from $0.62 → $0.78)."

### 6.4 Market Resolution Flow

```
resolveMarket(marketId, winningOutcomeId):
  1. BEGIN TRANSACTION
  2. Set market.status = 'resolved', market.winning_outcome_id.
  3. For each user holding shares of winning outcome (from positions table):
       - gross_payout = shares × $1.00
       - charity_fee = gross_payout × 0.20
       - net_payout = gross_payout - charity_fee
       - Credit user balance: net_payout.
       - Credit charity_pool account: charity_fee.
       - Create payout + fee transaction records (append-only).
  4. For losing outcome shares: no action (already paid for via AMM).
  5. Run reconciliation invariant check — ROLLBACK if fails.
  6. Append hash-chain entry for all new transactions.
  7. COMMIT TRANSACTION
  8. Broadcast resolution event to all clients (winning outcome, payout amounts).
  9. Send SMS confirmation to admin with payout summary.
```

### 6.5 SMS Command Interface (Twilio Webhook)

| Command | Format | Response |
|---------|--------|----------|
| Create market | `NEW \| Question? \| Outcome1, Outcome2, ...` | `Created market #7: "Question?" with 2 outcomes.` |
| Resolve market | `RESOLVE \| 7 \| Outcome1` | `Resolved market #7. Winner: Outcome1. 12 users paid out.` |
| Pause market | `PAUSE \| 7` | `Market #7 paused. No new orders accepted.` |
| Market status | `STATUS \| 7` | `Market #7: 45 trades, midpoint Yes=$0.62` |

### 6.6 Real-Time Update Architecture

```
Client connects via WebSocket on page load.
Subscribes to channels:
  - market:{id}:prices   → updated prices for all outcomes on every purchase
  - market:{id}:activity → purchase events (anonymized) + price history
  - markets:feed         → new market created / resolved / opening soon
  - markets:notify       → push notifications for new/scheduled markets (triggers SMS)
  - user:{id}:balance    → balance changes (private channel)

Server publishes on every purchase engine event.
Debounce price updates to max 2/sec to avoid flooding.
```

---

## 7. Payment Flow Detail

### 7.1 Escrow Model — Shrey's US Bank Account

All money flows through Shrey's US bank account via Stripe as the sole payment processor. There is no Indian bank account. All transactions are denominated in USD. Indian guests pay via credit card or Apple Pay in USD — they see a ₹93 = $1 reference rate for convenience, but the charge is in dollars.

**How it works:** Stripe collects all guest deposits (Apple Pay + credit card) and settles funds into Shrey's connected US bank account. Shrey's bank account is the escrow. Payouts to winners are sent manually by Shrey via Venmo or Zelle after market resolution. The immutable ledger in Postgres (§7.4) is the source of truth for who is owed what.

**Invariant:** At any point in time, the sum of all user balances in the ledger must equal the total deposits received minus total withdrawals paid out. The system enforces this with a reconciliation check that runs on every transaction commit and blocks any operation that would break the invariant.

### 7.2 Deposits
```
Guest taps "Add Credits" → selects amount ($10, $25, $50 presets or custom)
  → Stripe Checkout (Apple Pay / credit card) → charged in USD
  → Stripe webhook confirms → credits balance
```

- Stripe Checkout Session with Apple Pay and credit card support.
- Payment intent created server-side, confirmed client-side.
- `payment_intent.succeeded` webhook triggers ledger credit.
- Stripe settles to Shrey's US bank account on a manual payout schedule (funds held up to 90 days via `transfer_schedule.interval = manual`).
- Processing fee: ~2.9% + $0.30 per transaction.
- Indian guests' banks handle the INR→USD conversion at their card network's rate. The app displays a ₹93 ≈ $1 reference so guests know roughly what they're spending in rupees, but the actual charge is in USD.

### 7.3 Withdrawals & Payouts
```
Guest taps "Withdraw" → enters amount + Venmo handle or Zelle email/phone
  → Shrey sends from his Venmo/Zelle → marks complete in admin panel
```

**Payout flow on market resolution:**
1. Market resolves → system calculates gross winnings per user.
2. **20% charity fee** deducted from each user's gross winnings (see §7.5).
3. Net winnings credited to user's in-app balance.
4. User requests withdrawal → provides Venmo handle or Zelle email/phone.
5. Shrey sends payout manually from his Venmo/Zelle and marks the withdrawal complete in admin panel.
6. Ledger records the withdrawal with Shrey's confirmation timestamp.

All payouts batched post-event — Shrey settles all withdrawals after the wedding.

**Critical rule:** The system will never allow a withdrawal that would cause total payouts to exceed total deposits received. The app ledger balance is the ceiling — no IOUs.

### 7.4 Immutable Ledger Guarantees

Because all money sits in Shrey's bank account, the ledger must be bulletproof. Corruption = Shrey loses real money. The following safeguards are non-negotiable:

**Append-only transaction log:**
- The `transactions` table is INSERT-only. No UPDATE, no DELETE — ever.
- Postgres row-level security policy enforces this at the database level, not just the application layer.
- Every balance change (deposit, escrow lock, escrow release, payout, fee, withdrawal) is a separate row.

**Double-entry bookkeeping:**
- Every transaction has a debit and credit side. User deposit = debit to user balance, credit to house pool. Trade fill = debit buyer, credit seller. Payout = debit house pool, credit user.
- The sum of all debits must equal the sum of all credits at all times.
- A `CHECK` constraint or trigger validates this on every INSERT.

**Cryptographic audit trail:**
- Each transaction row includes a SHA-256 hash of: `previous_hash + transaction_data + timestamp`.
- This creates a hash chain (blockchain-lite). Any tampering with a historical row breaks the chain and is immediately detectable.
- A background job runs every 60 seconds to verify chain integrity and alerts admin on mismatch.

**Reconciliation invariant:**
```
SUM(all user balances) + SUM(charity_fee_collected) + SUM(withdrawals_paid) = SUM(deposits_received)
```
This check runs inside every transaction that modifies a balance. If it fails, the transaction is rolled back and an alert fires.

**Backup & recovery:**
- Postgres WAL (Write-Ahead Log) streaming to a secondary replica.
- Hourly logical backups (`pg_dump`) to object storage.
- Point-in-time recovery (PITR) enabled — can restore to any second.

**Admin audit log:**
- All admin actions (confirm deposit, resolve market, approve withdrawal) logged with timestamp, IP, and admin user ID.
- Admin cannot modify the transaction ledger directly — only trigger predefined operations that append to it.

### 7.5 Charity Fee — 20% of Winnings

On every market resolution, 20% of each winner's gross payout is retained as a charity fee, donated to a charity of Parsh and Spoorthi's choice.

**Calculation:**
```
gross_payout     = winning_shares × $1.00
charity_fee      = gross_payout × 0.20
net_payout       = gross_payout × 0.80
```

**Example:** Guest holds 10 shares of winning outcome at avg cost $0.40.
- Gross payout: 10 × $1.00 = $10.00
- Charity fee: $10.00 × 0.20 = $2.00
- Net payout credited to balance: $8.00
- Guest's P&L: $8.00 - $4.00 (cost basis) = +$4.00

**The fee is deducted from the payout, not from the user's existing balance.** Losing bets have no fee (they already lost their stake).

**Charity pool tracking:**
- A dedicated `charity_pool` ledger account accumulates all fees.
- The admin dashboard shows running total of charity fees collected.
- Post-wedding, Shrey donates the full charity pool amount and records the donation receipt.

### 7.6 Currency Handling

All transactions are in USD. There is no INR accounting. Indian guests are charged in USD via their credit card — their bank handles the currency conversion at the card network rate. The app displays a ₹93 ≈ $1 reference rate as a convenience label so Indian guests can mentally convert, but this is display-only and has no effect on pricing or balances. Withdrawals are in USD via Venmo/Zelle.

---

## 8. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| **Latency** | Purchase confirmation < 500ms p95 |
| **Concurrent users** | 300 simultaneous connections |
| **Uptime** | Best-effort (non-critical) — single region fine |
| **Mobile performance** | Lighthouse score > 85 on 4G |
| **Data retention** | Keep all data for 90 days post-event, then archive |

---

## 9. Edge Cases & Rules

1. **No selling.** Once you buy shares, you hold them until the market resolves. No secondary market, no cancellation, no exit. This is by design — keeps UX dead simple and prevents gaming.
2. **Market cap enforcement:** The $200 cap is enforced per user per market. `SUM(purchases.cost) WHERE user_id = X AND market_id = Y` must not exceed $200. The UI prevents overspending and shows remaining capacity.
3. **Price slippage on large buys:** A $200 purchase will move the price significantly. The UI must show the user their effective average price and the post-purchase price before they confirm. No surprises.
4. **Resolution disputes:** Admin decision is final. No appeal process (it's a wedding, not the SEC).
5. **Inactive markets:** Markets with no purchases for 30+ minutes auto-display a "low activity" badge.
6. **Duplicate phone numbers:** Rejected at registration. One account per phone.
7. **Currency:** Everything is USD. Indian guests are charged in USD via credit card (their bank handles FX). A ₹93 ≈ $1 reference rate is displayed for convenience only.
8. **Refunds on cancelled markets:** If admin voids a market, all purchase costs refunded to users' balances via the AMM. No charity fee on voided markets. `outcomes.shares_sold` reset to 0.
9. **Charity fee:** 20% of gross winnings deducted on resolution. Fee applies to payouts only — losing bets are fee-free.
10. **Withdrawal ceiling:** No user can withdraw more than their ledger balance. Total withdrawals across all users can never exceed total deposits. The system blocks any withdrawal that would violate this.
11. **Ledger corruption recovery:** If hash chain integrity check fails, all purchasing is halted immediately. Admin is alerted. System enters read-only mode until manual review and PITR restore if needed.
12. **House exposure:** The admin dashboard shows real-time worst-case house loss per market (`b × ln(n)`) and aggregate across all active markets. If aggregate exposure exceeds the house pool, admin should pause new market creation.

---

## 10. Leaderboard

Ranked by **realized P&L** across all resolved markets:

```
P&L = (total net payouts after 20% charity fee) - (total cost of all positions taken)
```

Leaderboard is public and updates in real-time as markets resolve. Top 3 get bragging rights (and maybe a toast at the reception). A separate "Charity Impact" counter shows total fees collected for the couple's chosen charity.

---

## 11. MVP Scope & Phasing

### Phase 1 — MVP (Build This)
- Guest auth (OTP), market feed with live prices, LMSR purchase engine, price slippage preview, admin panel for market CRUD + resolution (with `b` parameter tuning), wallet with Stripe deposits (Apple Pay + card, USD only), immutable transaction ledger with hash chain, 20% charity fee on resolution, leaderboard with charity counter, WebSocket real-time price updates.

### Phase 2 — Polish (If Time Permits)
- SMS admin commands via Twilio.
- Push notifications for market resolution.
- Market activity charts (price over time).
- Automated deposit confirmation via Stripe (already webhook-driven in MVP).

### Phase 3 — Nice to Have
- Social features (reactions, comments on markets).
- Guest-proposed questions (admin approves).
- Photo integration (market thumbnails from wedding photos).

---

## 12. Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | House pool size — need to cover worst-case LMSR exposure. ~$70 per binary market, ~$120 per 5-way. If running 10 markets simultaneously, need $700–$1200 seed. | Shrey's upfront capital |
| 2 | Post-wedding: kill the app or keep it for future events? | Infra decisions |
| 3 | Which charity will Parsh & Spoorthi choose for the 20% fee pool? | Leaderboard display + post-event donation |

---

## 13. Infrastructure & Deployment

### 13.1 Architecture Overview

```
          ┌──────────────┐
          │   Vercel      │
          │  (Next.js)    │ ← Frontend (SSR + PWA)
          └──────┬───────┘
                 │ HTTPS
          ┌──────▼───────┐
          │   Railway     │
          │  (Node.js)    │ ← Backend API + WebSocket server
          └──┬────┬──────┘
             │    │
    ┌────────▼┐  ┌▼────────┐
    │ Postgres │  │  Redis   │ ← Session store + WebSocket pub/sub
    │(Railway) │  │(Railway) │
    └──────────┘  └──────────┘
```

### 13.2 Docker Setup (Local Development on MBP)

```yaml
# docker-compose.yml
version: "3.9"
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: shaadi_book
      POSTGRES_USER: shaadi
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports: ["3001:3001"]
    environment:
      DATABASE_URL: postgres://shaadi:${DB_PASSWORD}@db:5432/shaadi_book
      REDIS_URL: redis://redis:6379
      TWILIO_ACCOUNT_SID: ${TWILIO_ACCOUNT_SID}
      TWILIO_AUTH_TOKEN: ${TWILIO_AUTH_TOKEN}
      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY}
      JWT_SECRET: ${JWT_SECRET}
    depends_on: [db, redis]

volumes:
  pgdata:
```

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/server.js"]
```

### 13.3 Cloud Deployment (Production)

| Component | Service | Cost Estimate | Why |
|-----------|---------|---------------|-----|
| **Frontend** | Vercel (Hobby → Pro) | $0–$20/mo | Instant deploys, edge CDN, Next.js native. |
| **Backend** | Railway (Starter) | ~$5–$10/mo | Managed Node.js, auto-scaling, built-in logs. Simple deploy via `railway up`. |
| **Postgres** | Railway Postgres | ~$5/mo | Managed, backups included, same network as backend (low latency). |
| **Redis** | Railway Redis | ~$5/mo | WebSocket pub/sub, session store. |
| **Domain** | Any registrar | ~$12/yr | `shaadibook.com` or similar. |
| **Total** | | ~$25–$40/mo | Runs for 2–3 months around the wedding, then tear down. |

**Deploy flow:**
```bash
# Frontend
cd frontend && vercel --prod

# Backend
cd backend && railway up

# Database migrations
railway run npx prisma migrate deploy
```

**Scaling notes:** Railway auto-scales on the Starter plan. For 300 concurrent WebSocket connections, a single instance is fine. If needed, Railway supports horizontal scaling with Redis pub/sub for WebSocket fanout across instances.

### 13.4 Environment Variables

```env
# Auth
JWT_SECRET=                     # Random 64-char hex
TWILIO_ACCOUNT_SID=             # From Twilio console
TWILIO_AUTH_TOKEN=               # From Twilio console
TWILIO_VERIFY_SERVICE_SID=      # Twilio Verify service for OTP
TWILIO_PHONE_NUMBER=            # For SMS notifications + admin commands

# Payments
STRIPE_SECRET_KEY=              # Stripe account (connected to Shrey's US bank)
STRIPE_WEBHOOK_SECRET=          # Stripe webhook signing secret

# Database
DATABASE_URL=                   # Postgres connection string

# Redis
REDIS_URL=                      # Redis connection string

# App Config
ADMIN_PHONE_NUMBERS=            # Comma-separated: +1XXXXXXXXXX,+91XXXXXXXXXX
B_FLOOR_DEFAULT=                # Default b_floor for new markets, e.g., 20
NEXT_PUBLIC_WS_URL=             # WebSocket endpoint URL
NEXT_PUBLIC_API_URL=            # Backend API URL
```

---

## 14. External APIs & Services

| Service | API | Purpose | Docs |
|---------|-----|---------|------|
| **Twilio Verify** | `POST /v2/Services/{sid}/Verifications` | Send OTP to IN/US phone numbers | twilio.com/docs/verify |
| **Twilio SMS** | `POST /2010-04-01/Accounts/{sid}/Messages` | Market notifications + admin SMS commands | twilio.com/docs/sms |
| **Stripe Checkout** | `POST /v1/checkout/sessions` | Apple Pay + credit card deposits (all guests, USD) | stripe.com/docs/payments/checkout |
| **Stripe Webhooks** | `checkout.session.completed` | Confirm deposit, credit ledger | stripe.com/docs/webhooks |

**No other payment APIs required.** All guests pay in USD via Stripe. Indian guests' banks handle INR→USD conversion at the card network rate. Apple Pay is automatically available via Stripe Checkout on supported devices — just enable it in Stripe Dashboard under Settings → Payment Methods.

**No other external APIs required.** Auth is custom (Twilio OTP), real-time is WebSocket (no Pusher/Ably needed), and the LMSR pricing is pure math — no external pricing service.

---

## 15. Agent-Based Development Plan

This entire app will be built using Claude Code agents. The PRD serves as the primary spec document that gets fed into each agent session.

### 15.1 Project Setup for Claude Code

**CLAUDE.md** — Create a comprehensive project memory file at the repo root:

```markdown
# Shaadi Book — Project Context

## Stack
- Frontend: Next.js 14 (App Router) + Tailwind CSS + shadcn/ui
- Backend: Node.js + Express + tRPC
- Database: PostgreSQL 16 + Prisma ORM
- Real-time: Socket.io (WebSocket)
- Auth: Custom OTP via Twilio Verify
- Payments: Stripe only (Apple Pay + credit card, USD). No Razorpay.

## Architecture Rules
- All monetary operations go through the append-only transactions table.
- User balances are ALWAYS derived from the transactions ledger, never stored.
- The LMSR purchase engine runs inside a single Postgres transaction with row-level locking.
- Every transaction row has a SHA-256 hash chain. No UPDATE/DELETE on transactions or purchases.
- b(t,V) = max(b_floor, 20 + (0.6 × 0.25 × √(Δt_ms)) + (0.4 × 0.5 × V))

## Conventions
- TypeScript strict mode everywhere.
- Prisma for DB schema + migrations. Raw SQL only for the LMSR cost function (performance).
- API routes use tRPC with Zod validation.
- All prices in cents (integer math) to avoid floating point issues. $0.50 = 50.
- Error handling: never swallow errors in the purchase engine. ROLLBACK + log + alert.

## Testing
- Unit tests for LMSR math (cost function, price calculation, binary search).
- Integration tests for purchase engine (concurrent purchases, cap enforcement, reconciliation).
- E2E tests for Stripe payment webhooks (mock checkout.session.completed).

## File Structure
shaadi-book/
├── frontend/          # Next.js app
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
└── .claude/
    ├── agents/        # Custom subagents
    └── commands/      # Custom slash commands
```

### 15.2 Custom Subagents

Create specialized agents in `.claude/agents/`:

**lmsr-mathematician** — For the pricing engine:
```yaml
---
name: lmsr-mathematician
description: Implements and tests the LMSR cost function, pricing, and binary search solver
tools: Read, Write, Edit, Bash, Grep
---
You are an expert in market microstructure and automated market makers.
You implement the LMSR (Logarithmic Market Scoring Rule) pricing engine.
All monetary values are in cents (integers). Use BigNumber or Decimal.js for precision.
The adaptive b formula is: b = max(b_floor, 20 + (0.6 * 0.25 * sqrt(dt_ms)) + (0.4 * 0.5 * V))
Write comprehensive property-based tests for all edge cases.
```

**ledger-guardian** — For the immutable ledger:
```yaml
---
name: ledger-guardian
description: Implements append-only transaction ledger, hash chain, double-entry bookkeeping, reconciliation
tools: Read, Write, Edit, Bash, Grep
---
You are a financial systems engineer specializing in immutable ledgers.
Every transaction is INSERT-only. Implement Postgres RLS policies and triggers
that prevent UPDATE/DELETE. Implement SHA-256 hash chain verification.
The reconciliation invariant must hold on every balance-modifying transaction.
Test for race conditions with concurrent purchases.
```

**payments-integrator** — For Stripe:
```yaml
---
name: payments-integrator
description: Integrates Stripe for deposits and manual withdrawal tracking
tools: Read, Write, Edit, Bash, Grep
---
You integrate Stripe (Apple Pay + credit card, USD only) for all deposits.
All guests pay in USD. Deposits credit the immutable ledger.
Withdrawals are manual (Venmo/Zelle) — you build the admin tracking UI.
Handle webhook idempotency. All payment events must be atomic with ledger updates.
Use Stripe Checkout Sessions with mode='payment'. Enable Apple Pay in Dashboard.
Webhook event: checkout.session.completed.
```

### 15.3 MCP Servers to Install

```bash
# PostgreSQL — for direct DB queries during development
claude mcp add postgres-mcp npx @anthropic-ai/postgres-mcp --connection-string $DATABASE_URL

# Context7 — for up-to-date framework docs (Next.js, Prisma, Socket.io, Stripe)
claude mcp add context7 npx @anthropic-ai/context7-mcp

# GitHub — for PR management and issue tracking
claude mcp add github npx @anthropic-ai/github-mcp
```

---

## 16. Task Breakdown — Sequential & Parallel

Tasks are designed for independent Claude Code agent sessions. Each task has a clear input, output, and acceptance criteria. Tasks within the same phase can be parallelized.

### Phase 0: Scaffolding (Sequential — 1 session)

```
TASK 0.1: Project Init
  Input:  CLAUDE.md + this PRD
  Do:     Create monorepo structure. Init Next.js frontend, Express backend,
          Prisma schema, Docker Compose, .env.example. Install all dependencies.
  Output: Working `docker compose up` with empty app + DB connection verified.
  Test:   `curl localhost:3001/health` returns 200.
```

### Phase 1: Core Backend (Parallel — 4 sessions)

```
TASK 1.1: Database Schema + Migrations
  Input:  Data model from §6.2
  Do:     Write full Prisma schema: users, markets, outcomes, positions,
          purchases, transactions, admin_audit_log. Add RLS policies
          (INSERT-only on transactions + purchases). Add triggers for
          double-entry validation and hash chain.
  Output: `npx prisma migrate dev` runs clean. RLS policies verified.
  Test:   Attempt UPDATE/DELETE on transactions → blocked.

TASK 1.2: LMSR Pricing Engine
  Input:  §4.2, §4.3 (formulas), §6.3 (purchase engine pseudocode)
  Do:     Implement lmsr.ts: costFunction(), price(), computeShares(),
          adaptiveB(). Use Decimal.js for precision. Binary search solver
          for shares-given-dollar-amount.
  Output: Pure functions with no DB dependency. Fully unit tested.
  Test:   100% test coverage. Property tests: prices sum to 1.00,
          cost is monotonically increasing, b grows correctly.

TASK 1.3: Auth (OTP Flow)
  Input:  §3.1 (onboarding), §6.1 (Twilio Verify)
  Do:     Implement sendOTP(phone, country) and verifyOTP(phone, code).
          JWT issuance on success. Phone normalization for IN (+91) and US (+1).
          Admin role assignment from ADMIN_PHONE_NUMBERS env var.
  Output: Working auth endpoints. JWT middleware for protected routes.
  Test:   Mock Twilio. Verify JWT contains userId, role, country.

TASK 1.4: WebSocket Infrastructure
  Input:  §6.6 (real-time architecture)
  Do:     Socket.io server with Redis adapter for pub/sub. Channel structure:
          market:{id}:prices, market:{id}:activity, markets:feed,
          user:{id}:balance. Auth middleware (JWT in handshake).
  Output: WebSocket server that broadcasts on publish events.
  Test:   Connect 2 clients, publish to channel, both receive.
```

### Phase 2: Business Logic (Parallel — 3 sessions, depends on Phase 1)

```
TASK 2.1: Purchase Engine (Full Transaction)
  Input:  TASK 1.1 (schema) + TASK 1.2 (LMSR) + §6.3 (pseudocode)
  Do:     Implement buyShares() as a single Postgres transaction:
          validate → lock → compute b → compute shares → update state →
          insert purchase → insert transaction → update position →
          reconciliation check → hash chain → commit → broadcast.
  Output: tRPC endpoint `market.buy` that is atomic and concurrent-safe.
  Test:   10 concurrent purchases on same market → all succeed, no race
          conditions, reconciliation invariant holds. $50 cap enforced.

TASK 2.2: Market CRUD + Resolution + Notifications
  Input:  TASK 1.1 (schema) + TASK 1.4 (WebSocket) + §3.3, §3.4, §4.5, §6.4
  Do:     Admin endpoints: createMarket, resolveMarket, pauseMarket, voidMarket.
          Resolution: compute payouts, apply 20% charity fee, credit balances.
          Notifications: WebSocket push on market create/open, SMS via Twilio
          to all registered users on new market. Scheduled market support
          (opens at future time, 5-min countdown push).
  Output: Full market lifecycle with notifications.
  Test:   Create → buy shares → resolve → verify payouts + charity fee.
          Void market → verify full refunds.

TASK 2.3: Immutable Ledger + Reconciliation
  Input:  TASK 1.1 (schema) + §7.4 (ledger guarantees)
  Do:     Implement hash chain (SHA-256). Background worker that verifies
          chain integrity every 60s. Reconciliation function that checks
          SUM(balances) + SUM(charity) + SUM(withdrawals) = SUM(deposits).
          Admin audit log for all admin actions. Read-only mode trigger
          on integrity failure.
  Output: Ledger module with chain verification + reconciliation.
  Test:   Tamper with a transaction row → chain breaks → system halts.
          Run 100 random operations → reconciliation invariant holds.
```

### Phase 3: Payments (Parallel — 2 sessions, depends on Phase 2)

```
TASK 3.1: Stripe Integration (All Deposits)
  Input:  §7.2 (deposits) + §14 (APIs)
  Do:     Stripe Checkout Session creation for deposit amounts ($10, $25, $50 presets + custom).
          Apple Pay + credit card support (Apple Pay auto-enabled via Stripe Checkout).
          All charges in USD. Webhook handler for
          checkout.session.completed → credit ledger atomically.
          Idempotency key to prevent double-crediting.
          Currency display helper: show ₹93 ≈ $1 reference for IN guests (display-only).
  Output: Working deposit flow for all guests.
  Test:   Stripe test mode. Mock webhook → balance credited exactly once.

TASK 3.2: Withdrawal Tracking (Admin)
  Input:  §7.3 (withdrawals)
  Do:     Withdrawal request form (guest enters Venmo handle or Zelle email/phone).
          Admin panel queue: list pending withdrawals, approve/reject, mark as sent.
          Ledger records withdrawal with admin confirmation timestamp.
          System blocks any withdrawal exceeding ledger balance.
  Output: Working withdrawal request + admin approval flow.
  Test:   Request withdrawal → appears in admin queue → approve → balance updated.
```

### Phase 4: Frontend (Parallel — 3 sessions, depends on Phase 2)

```
TASK 4.1: Guest App — Market Feed + Market Detail
  Input:  §4.6 (UX), §5.1 (guest views)
  Do:     Mobile-first responsive UI. Market feed page: list of active
          markets with live prices, volume, NEW badge for recent markets.
          Market detail page: outcome prices with probability bars,
          purchase form with slippage preview, recent activity feed,
          price history mini-chart.
          WebSocket integration for live price updates.
  Output: Fully functional market browsing and betting UX.
  Test:   Lighthouse > 85 on mobile. Prices update in real-time.

TASK 4.2: Guest App — Wallet + My Bets + Leaderboard
  Input:  §5.1 (guest views), §7.2 (deposits), §10 (leaderboard)
  Do:     Wallet page: balance display, deposit button (Stripe Checkout),
          withdrawal request form (Venmo/Zelle handle), transaction history.
          My Bets page: active positions with cost basis + potential payout.
          Leaderboard: ranked by P&L, charity impact counter.
  Output: Complete guest account management UX.
  Test:   Deposit flow end-to-end. Position display matches ledger.

TASK 4.3: Admin Panel
  Input:  §5.2 (admin views), §3.3 (market creation), §3.4 (resolution)
  Do:     Admin dashboard: active users, total volume, house exposure
          per market, charity pool total. Market manager: create market
          form (question, outcomes, b_floor override, open time), resolve
          button, void button. Withdrawal queue: list pending, approve/reject.
          User manager: list guests, balances, flag suspicious.
  Output: Fully functional admin panel behind admin role check.
  Test:   Create market → appears in guest feed. Resolve → payouts correct.
```

### Phase 5: SMS Admin Commands (Sequential — 1 session, depends on Phase 2)

```
TASK 5.1: Twilio Webhook for Admin SMS
  Input:  §6.5 (SMS command interface)
  Do:     Twilio webhook endpoint. Parse incoming SMS from admin phone
          numbers. Commands: NEW | RESOLVE | PAUSE | STATUS.
          Reply with confirmation SMS.
  Output: Admin can create and resolve markets from their phone.
  Test:   Mock Twilio webhook → market created → confirmation SMS sent.
```

### Phase 6: QA + Polish (Sequential — 1–2 sessions, depends on all)

```
TASK 6.1: Integration Testing + Security Review
  Input:  All previous tasks
  Do:     End-to-end flow: register → deposit → bet → resolution → withdraw.
          Concurrent load test (100 simultaneous purchases).
          Security review: JWT validation, admin role checks, SQL injection,
          RLS policy verification, webhook signature verification.
          Hash chain full integrity check.
  Output: All tests pass. Security checklist complete.

TASK 6.2: Deploy to Production
  Input:  §13 (infrastructure)
  Do:     Deploy frontend to Vercel, backend to Railway, DB + Redis on Railway.
          Configure env vars. Set up domain. Verify Stripe
          webhooks point to production URL. Run smoke test with real OTP.
          Generate QR code for venue.
  Output: Live app at production URL with QR code ready for printing.
```

### Parallelization Map

```
Phase 0 ──────────────────────────────────────────────────
  [0.1 Scaffold]
         │
Phase 1  ▼─────────── (all parallel) ────────────────────
  [1.1 Schema] [1.2 LMSR] [1.3 Auth] [1.4 WebSocket]
         │          │         │           │
Phase 2  ▼──────────▼─────────▼───────────▼── (parallel) ─
  [2.1 Purchase Engine]  [2.2 Markets+Notif]  [2.3 Ledger]
         │                      │                  │
Phase 3  ▼──────────────────────▼──────────────────▼──────
  [3.1 Stripe]  [3.2 Withdrawals]      │
         │           │                  │
Phase 4  ▼───────────▼─────────────────▼── (parallel) ────
  [4.1 Market UI]  [4.2 Wallet/Bets]  [4.3 Admin Panel]
         │              │                  │
Phase 5  ▼──────────────▼──────────────────▼──────────────
  [5.1 SMS Commands]
         │
Phase 6  ▼────────────────────────────────────────────────
  [6.1 QA + Security]  →  [6.2 Deploy]
```

**Maximum parallelism:** 4 agents in Phase 1, 3 agents in Phase 2, 2 agents in Phase 3, 3 agents in Phase 4. Total: ~16 tasks across 6 phases.

**Estimated build time with agents:** 2–3 days of active work. Phase 0+1 in day 1, Phase 2+3 in day 2, Phase 4+5+6 in day 3.

### 15.4 Agent Session Best Practices

These practices are informed by the latest Claude Code documentation and community patterns (as of March 2026):

1. **Spec-first, then execute.** Feed this entire PRD into each agent session. Each task references specific PRD sections — the agent reads those sections for context.

2. **One task per session.** Start a fresh session (`/clear`) for each task. Context pollution across tasks degrades output quality. Each task is scoped to fit within a single context window.

3. **Writer/Reviewer pattern.** After each task completes, spawn a review subagent in a fresh context to audit the code. A fresh context catches bugs that the writer's session would miss (confirmation bias).

4. **Use git worktrees for parallel agents.** Each parallel agent works in its own worktree so file edits don't conflict:
```bash
git worktree add ../shaadi-book-task-1.1 -b task/1.1-schema
git worktree add ../shaadi-book-task-1.2 -b task/1.2-lmsr
# Each agent session runs in its own worktree directory
```

5. **LMSR math is the highest-risk module.** Use the `lmsr-mathematician` subagent and demand property-based tests. Verify by hand that the binary search solver converges for edge cases (very small b, very large b, near-boundary prices).

6. **Test the ledger adversarially.** Use the `ledger-guardian` subagent. Intentionally corrupt a transaction row and verify the hash chain catches it. Run concurrent writes and verify the reconciliation invariant holds under contention.

7. **Background agents for monitoring.** While building, use `/loop` to run a background agent that monitors test output and flags regressions as you iterate.

8. **Compact at 70% context.** If a session runs long, use `/compact` before context degrades. For the purchase engine (Task 2.1), which is the most complex single task, plan for 1–2 compactions.

---

## Appendix A: API Reference & Integration Patterns

Exact SDK versions, code patterns, and setup steps for every external service. This appendix is the authoritative reference for agent sessions — if in doubt, follow the patterns here, not generic examples from training data.

### A.1 Stripe — Deposits (Apple Pay + Credit Card, USD Only)

**SDK:** `npm install stripe` (Node.js server-side)
**Dashboard setup:** Enable Apple Pay under Settings → Payment Methods. Register your domain for Apple Pay web.

**Create Checkout Session (server-side):**
```typescript
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Called when guest taps "Add Credits"
async function createDepositSession(amountCents: number, userId: string) {
  const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency: 'usd',
      line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: 'Shaadi Book Credits' },
            unit_amount: amountCents, // e.g. 2500 = $25.00
          },
          quantity: 1,
      }],
      client_reference_id: userId, // links session to our user
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/wallet?deposit=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/wallet?deposit=cancelled`,
  });
  return session.url; // redirect guest to this URL
}
```

**Webhook handler (server-side):**
```typescript
// POST /api/webhooks/stripe
import { buffer } from 'micro';

async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const body = await buffer(req);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id!;
    const amountCents = session.amount_total!;

    // Idempotency: check if this session.id already processed
    // Credit ledger atomically (INSERT into transactions)
    await creditUserBalance(userId, amountCents, session.id);
  }

  res.status(200).json({ received: true });
}
```

**Apple Pay:** Automatically available in Stripe Checkout on supported devices (Safari on iOS/macOS). No additional frontend code needed — Stripe's hosted checkout page renders the Apple Pay button when available. Just ensure the domain is registered in Stripe Dashboard → Settings → Payment Methods → Apple Pay → Add domain.

**Key details:**
- Stripe Checkout handles PCI compliance — card details never touch our server.
- Apple Pay, Google Pay, Link, and credit cards all work through the same Checkout Session — no branching.
- `client_reference_id` links the Stripe session to our user for webhook processing.
- Always verify webhook signatures. Never trust client-side success redirects for crediting balances.

### A.2 Twilio — OTP Authentication + SMS Notifications

**SDK:** `npm install twilio`
**Dashboard setup:** Create a Verify Service (console.twilio.com → Verify → Services). Set code length to 6. Note the Service SID.

**Send OTP:**
```typescript
import twilio from 'twilio';
const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

async function sendOTP(phoneNumber: string) {
  // phoneNumber must be E.164 format: +14155551234 or +919876543210
  const verification = await client.verify.v2
  .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
  .verifications.create({
      to: phoneNumber,
      channel: 'sms',
  });
  return verification.status; // 'pending'
}
```

**Verify OTP:**
```typescript
async function verifyOTP(phoneNumber: string, code: string) {
  const check = await client.verify.v2
  .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
  .verificationChecks.create({
      to: phoneNumber,
      code: code,
  });
  return check.status; // 'approved' or 'pending' (wrong code)
}
```

**Send SMS notification (market alerts):**
```typescript
async function sendMarketNotification(phoneNumbers: string[], message: string) {
  const promises = phoneNumbers.map(phone =>
    client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: phone,
    })
  );
  await Promise.allSettled(promises); // don't fail if one SMS bounces
}
```

**Key details:**
- Twilio Verify handles phone number routing globally — no need to buy phone numbers for OTP delivery.
- You DO need a Twilio phone number for outbound SMS notifications (market alerts, admin commands).
- Supports both +1 (US) and +91 (IN) numbers natively.
- OTP codes expire after 10 minutes by default.
- Verify Service SID starts with `VA`.

### A.3 Socket.io v4 — Real-Time Price Updates

**SDK:** `npm install socket.io` (server), `npm install socket.io-client` (frontend)
**Redis adapter:** `npm install @socket.io/redis-adapter redis`
**Latest stable:** v4.8.3 (December 2025)

**Server setup with Redis adapter:**
```typescript
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import http from 'http';
import jwt from 'jsonwebtoken';

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: process.env.NEXT_PUBLIC_APP_URL },
});

// Redis adapter for multi-instance scaling
const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));

// Auth middleware — JWT in handshake
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!);
      socket.data.userId = decoded.userId;
      socket.data.role = decoded.role;
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
});

io.on('connection', (socket) => {
    // Auto-join user's private balance channel
    socket.join(`user:${socket.data.userId}:balance`);
    // Join the global market feed
    socket.join('markets:feed');
    socket.join('markets:notify');

    // Client subscribes to specific market price feeds
    socket.on('subscribe:market', (marketId: string) => {
        socket.join(`market:${marketId}:prices`);
        socket.join(`market:${marketId}:activity`);
    });

    socket.on('unsubscribe:market', (marketId: string) => {
        socket.leave(`market:${marketId}:prices`);
        socket.leave(`market:${marketId}:activity`);
    });
});
```

**Broadcasting from purchase engine:**
```typescript
// After a successful purchase in buyShares()
function broadcastPurchase(io, marketId, newPrices, purchaseEvent, userId, newBalance) {
  // Everyone subscribed to this market sees new prices
  io.to(`market:${marketId}:prices`).emit('priceUpdate', {
      marketId,
      prices: newPrices, // { outcomeId: priceCents }[]
      timestamp: Date.now(),
  });

  // Activity feed (anonymized)
  io.to(`market:${marketId}:activity`).emit('purchase', {
      marketId,
      outcome: purchaseEvent.outcomeLabel,
      amount: purchaseEvent.dollarAmount,
      newPrice: purchaseEvent.priceAfter,
  });

  // Private balance update to the buyer only
  io.to(`user:${userId}:balance`).emit('balanceUpdate', {
      balance: newBalance,
  });
}
```

**Client-side (Next.js):**
```typescript
import { io } from 'socket.io-client';

const socket = io(process.env.NEXT_PUBLIC_WS_URL!, {
    auth: { token: userJWT },
});

socket.on('priceUpdate', (data) => {
    // Update React state with new prices
});

socket.on('purchase', (data) => {
    // Show activity feed item
});
```

**Key details:**
- Use `@socket.io/redis-adapter` (NOT deprecated `socket.io-redis`). The old package will not work with Socket.io v4.
- Rooms are the primary abstraction — `io.to("room").emit()` broadcasts to all sockets in the room.
- Debounce price updates to max 2/sec on the server side to avoid flooding clients.
- Socket.io handles reconnection, buffering, and transport fallback automatically.

### A.4 Prisma ORM — Database Schema & Migrations

**SDK:** `npm install prisma @prisma/client`
**Setup:** `npx prisma init` creates `prisma/schema.prisma`

**Key patterns for this project:**
```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  name      String
  phone     String   @unique
  country   Country
  role      Role     @default(GUEST)
  createdAt DateTime @default(now())
  // Balance is DERIVED from transactions — never stored here
}

enum Country { US IN }
enum Role { GUEST ADMIN }
enum MarketStatus { PENDING ACTIVE PAUSED RESOLVED VOIDED }
```

**Raw SQL for LMSR (performance-critical):**
```typescript
// Use Prisma.$queryRaw for the purchase engine hot path
const result = await prisma.$queryRaw`
SELECT shares_sold FROM outcomes
WHERE market_id = ${marketId}
FOR UPDATE  -- row-level lock for concurrent safety
`;
```

**Migrations:**
```bash
npx prisma migrate dev --name init          # create initial migration
npx prisma migrate deploy                   # apply in production
npx prisma db push                          # quick sync in development
```

**RLS policies (applied via raw SQL migration):**
```sql
-- Prevent UPDATE/DELETE on transactions table
CREATE OR REPLACE FUNCTION prevent_modify() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Modifications to this table are not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_no_update
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_modify();

CREATE TRIGGER purchases_no_update
  BEFORE UPDATE OR DELETE ON purchases
  FOR EACH ROW EXECUTE FUNCTION prevent_modify();
```

### A.5 NPM Package Versions (Pin These)

```json
{
  "dependencies": {
    "next": "^14.2",
    "react": "^18.3",
    "stripe": "^17.0",
    "twilio": "^5.0",
    "socket.io": "^4.8",
    "socket.io-client": "^4.8",
    "@socket.io/redis-adapter": "^8.3",
    "redis": "^4.7",
    "@prisma/client": "^6.0",
    "jsonwebtoken": "^9.0",
    "decimal.js": "^10.4",
    "zod": "^3.23",
    "@trpc/server": "^11.0",
    "@trpc/client": "^11.0",
    "express": "^5.1"
  },
  "devDependencies": {
    "prisma": "^6.0",
    "typescript": "^5.6",
    "vitest": "^2.0",
    "@types/node": "^22.0"
  }
}
```
