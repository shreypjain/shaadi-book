import Link from "next/link";

// ---------------------------------------------------------------------------
// /rules — How to Play · Shaadi Book
// ---------------------------------------------------------------------------

export default function RulesPage() {
  return (
    <div className="min-h-screen bg-cream-100 pb-24">
      {/* Top gold accent line */}
      <div className="h-0.5 bg-[#c8a45c]" />

      <div className="max-w-lg mx-auto px-4 pt-10 pb-6 flex flex-col gap-6">

        {/* ── Hero ────────────────────────────────────────────────────── */}
        <div className="text-center animate-fade-in">
          <h1 className="text-3xl font-bold text-charcoal tracking-tight">
            How to Play
          </h1>
          {/* Gold accent underline */}
          <div className="mt-2.5 h-px w-14 mx-auto bg-[#c8a45c]" />
          <p className="mt-3 text-sm text-warmGray font-medium">
            A quick rundown in wedding prediction markets
          </p>
          <p className="mt-1.5 text-xs text-warmGray">
            A background in degeneracy required 
          </p>
        </div>

        {/* ── Section 1: The Basics ─────────────────────────────────── */}
        <SectionCard
          label="01"
          title="The Basics"
          subtitle="Everything you need to know in 30 seconds"
        >
          <ul className="flex flex-col gap-3 mt-1">
            <RuleItem
              text="Bet on real outcomes from the wedding — Will the baraat be late? How many outfit changes? Who (if anyone) cries first?"
            />
            <RuleItem
              text={
                <>
                  Each "outcome" has a price between{" "}
                  <Highlight>1¢ and 99¢</Highlight>. That price{" "}
                  <em>is</em> the crowd&apos;s implied probability.
                  If &quot;Yes&quot; is at 75¢, our market thinks
                  it has a 75% chance of being true.
                </>
              }
            />
            <RuleItem
              text={
                <>
                  If your outcome wins, you{" "}
                  <Highlight>split the total pool</Highlight> with other
                  winners. The less volume being bet on your side, the bigger your
                  share. Payouts are capped at{" "}
                  <Highlight>$1.00 per share</Highlight>.
                </>
              }
            />
            <RuleItem
              text={
                <>
                  <Highlight>$200 max bet per market (to protect from shovers).</Highlight> You
                  can sell shares back to the market at the current price — with a{" "}
                  <Highlight>10% fee on proceeds</Highlight> and a{" "}
                  <Highlight>30-minute cooldown</Highlight> after purchase. No flipping
                  immediately after buying.
                </>
              }
            />
          </ul>
        </SectionCard>

        {/* ── Section 2: How Prices Work ───────────────────────────── */}
        <SectionCard
          label="02"
          title="How Prices Work"
          subtitle="The spicy quant stuff — don't skip this"
        >
          <div className="flex flex-col gap-3 mt-1 text-sm text-warmGray">
            <p>
              Prices are set by a{" "}
              <span className="font-semibold text-charcoal">
                Logarithmic Market Scoring Rule (LMSR)
              </span>{" "}
              — inspired by previous attempts to build prediction markets
              optimized for low volume and small numbers of traders. Shrey
              is the bookie, but{" "}
              <span className="font-semibold text-charcoal">
                not the house or market maker
              </span>
              . This is a{" "}
              <span className="font-semibold text-charcoal">
                parimutuel system
              </span>{" "}
              — you&apos;re betting against other guests, not against
              the house.
            </p>

            {/* LMSR mechanics block */}
            <div className="rounded-lg bg-[#f5f1eb] border border-[rgba(184,134,11,0.12)] p-4 flex flex-col gap-2.5">
              <p className="text-xs font-semibold text-warmGray uppercase tracking-wider">
                LMSR mechanics
              </p>
              <p className="text-sm text-charcoal">
                The market maintains a{" "}
                <span className="font-semibold">cost function</span>:
              </p>
              <p className="text-sm font-mono text-charcoal bg-white border border-[rgba(184,134,11,0.12)] rounded px-3 py-2 text-center tracking-tight">
                C(q) = b · ln( Σ exp(q<sub>i</sub> / b) )
              </p>
              <p className="text-sm text-warmGray">
                where <span className="font-mono font-semibold">q<sub>i</sub></span> is the
                total shares outstanding for outcome <em>i</em> and{" "}
                <span className="font-mono font-semibold">b</span> is the
                liquidity parameter. You pay the{" "}
                <span className="font-semibold text-charcoal">
                  change in cost to acquire a stake in that outcome
                </span>{" "}
                — C(q_after) − C(q_before) — not a fixed price per share.
              </p>
              <p className="text-sm text-warmGray">
                The exponential in the sum guarantees that the implied
                probability of each outcome is{" "}
                <span className="font-semibold text-charcoal">
                  exp(q<sub>i</sub>/b) / Σ exp(q<sub>j</sub>/b)
                </span>
                , which always sums to exactly 1 across all outcomes.
                Buy shares on &quot;Yes&quot; and its price rises;
                &quot;No&quot; falls proportionally — the market
                reprices continuously, with no manual intervention.
              </p>
              <p className="text-sm text-warmGray">
                When you enter a dollar amount, the engine uses a{" "}
                <span className="font-semibold text-charcoal">
                  closed-form analytical solution
                </span>{" "}
                to compute the exact share quantity — derived directly
                from the cost function algebra, inside a single Postgres
                transaction with row-level locks.
              </p>
            </div>

            {/* Example block */}
            <div className="rounded-lg bg-[#f5f1eb] border border-[rgba(184,134,11,0.12)] p-4 flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-warmGray uppercase tracking-wider">
                Example
              </p>
              <p className="text-sm text-charcoal">
                &quot;Will Parsh cry during the pheras?&quot; opens at{" "}
                <Highlight>50¢ / 50¢</Highlight>. Guest A slams $20 on
                Yes → price jumps to <Highlight>88¢</Highlight>. Guest B
                bets $10 on No → settles back to{" "}
                <Highlight>78¢</Highlight>. Every buy moves the market
                 in real time.
              </p>
            </div>

            <p className="text-sm text-warmGray">
              Each market has a{" "}
              <span className="font-semibold text-charcoal">
                fixed liquidity parameter (b)
              </span>{" "}
              set at creation based on the number of outcomes and max shares
              per outcome. A higher b means individual bets move prices less;
              a lower b means prices are more volatile. Early bets still swing
              prices harder than later ones as shares get bought up.
            </p>

            {/* Strategy note */}
            <div className="rounded-lg bg-[#1a1a2e] p-4 flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-[#c8a45c] uppercase tracking-wider">
                Pro tip
              </p>
              <p className="text-sm text-[#e8e4df] leading-relaxed">
                When a whale drops a big bet early and the market
                hasn&apos;t settled yet, there&apos;s serious money to be
                made taking the other side. The market maker doesn&apos;t
                need to find a matching bet for you — it automatically
                evens out the pricing. Early contrarian bets on an
                unsettled market can print.
              </p>
            </div>
          </div>
        </SectionCard>

        {/* ── Section 3: Payouts ────────────────────────────────────── */}
        <SectionCard
          label="03"
          title="Payouts"
          subtitle="The part everyone actually cares about"
        >
          <div className="flex flex-col gap-3 mt-1 text-sm text-warmGray">
            <ul className="flex flex-col gap-3">
              <RuleItem
                text={
                  <>
                    Winning shares split the total market pool. Your payout
                    per share ={" "}
                    <Highlight>
                      min(total pool / winning shares, $1.00)
                    </Highlight>
                    . If the pool is thin, you might get less than $1.00.
                    If few people picked your side, we'll have to start calculating MOIC.
                    Losing shares pay $0.00.
                  </>
                }
              />
              <RuleItem
                text={
                  <>
                    <Highlight>10% of your profit</Highlight> goes to
                    charity — collected externally via Venmo after the
                    wedding, not deducted in-app. The couple hasn&apos;t
                    chosen the cause yet. You&apos;re basically a
                    quantitative philanthropist.
                  </>
                }
              />
            </ul>

            {/* Worked example */}
            <div className="rounded-lg bg-[#f5f1eb] border border-[rgba(184,134,11,0.12)] p-4 flex flex-col gap-2">
              <p className="text-xs font-semibold text-warmGray uppercase tracking-wider">
                Worked example
              </p>
              <div className="flex flex-col gap-1 text-sm text-charcoal">
                <ExampleRow label="You buy: 10 shares at 40¢" value="$4.00" />
                <ExampleRow label="Outcome wins, pool pays $0.90/share" value="$9.00" />
                <ExampleRow label="Profit" value="$5.00" />
                <ExampleRow
                  label="Charity (10% of profit)"
                  value="− $0.50"
                  accent
                />
                <div className="border-t border-[rgba(184,134,11,0.12)] mt-1 pt-2">
                  <ExampleRow
                    label="You take home"
                    value="$8.50"
                    bold
                  />
                </div>
              </div>
            </div>

            <RuleItem
              text="Payouts sent via Venmo or Zelle after the wedding. Shrey is the bookie. He&apos;s good for it."
            />
          </div>
        </SectionCard>

        {/* ── Section 4: House Rules ────────────────────────────────── */}
        <SectionCard
          label="04"
          title="House Rules"
          subtitle="Short list. No fine print."
        >
          <ul className="flex flex-col gap-3 mt-1">
            <RuleItem text="All bets are in USD." />
            <RuleItem
              text={
                <>
                  Shrey is the bookie — but he&apos;s not the house.{" "}
                  <span className="text-warmGray">
                    You&apos;re betting against each other in a parimutuel
                    pool.
                  </span>
                </>
              }
            />
            <RuleItem
              text="Markets are resolved by admin decree. No appeals, no arbitration, no crying (unless you bet on it)."
            />
            <RuleItem
              text="Have fun. Feel free to game the system to win back your Air India flight ticket. This is a wedding, not a hedge fund."
            />
            <RuleItem
              text={
                <>
                  You can sell shares back to the market at any time{" "}
                  <Highlight>(30-minute cooldown after buying, 10% fee on proceeds)</Highlight>.
                  Change your mind, lock in a gain, or cut a loss — the market
                  will take the other side.
                </>
              }
            />
            <RuleItem
              text="This is for charity and entertainment. Winning feels like a music video. Losing still helped a good cause."
            />
          </ul>
        </SectionCard>

        {/* ── Disclaimer ───────────────────────────────────────────── */}
        <div className="px-2 pb-2">
          <p className="text-[10px] text-warmGray text-center leading-relaxed">
            This is a private entertainment experience for the wedding of
            Parsh &amp; Spoorthi. Partial proceeds benefit charity (we're slightly selfish). Play
            responsibly.
          </p>
        </div>

        {/* Back link */}
        <div className="text-center">
          <Link
            href="/"
            className="text-xs text-[#1e3a5f] underline underline-offset-2 font-medium"
          >
            ← Back to markets
          </Link>
        </div>
      </div>

      {/* Bottom gold accent line */}
      <div className="h-0.5 bg-[#c8a45c]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({
  label,
  title,
  subtitle,
  children,
}: {
  label: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white border border-[rgba(184,134,11,0.12)] shadow-card overflow-hidden animate-slide-up">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-[rgba(184,134,11,0.12)] bg-cream-100 flex items-center gap-3">
        <span className="text-xs font-mono font-bold text-[#c8a45c] leading-none mt-0.5">{label}</span>
        <div>
          <h2 className="text-sm font-semibold text-charcoal">{title}</h2>
          <p className="text-xs text-warmGray mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

function RuleItem({
  text,
}: {
  text: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 items-start list-none">
      <span className="text-[#c8a45c] leading-none mt-1 shrink-0">—</span>
      <p className="text-sm text-warmGray leading-relaxed">{text}</p>
    </li>
  );
}

function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-semibold text-charcoal">{children}</span>
  );
}

function ExampleRow({
  label,
  value,
  accent,
  bold,
}: {
  label: string;
  value: string;
  accent?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span
        className={`text-xs ${bold ? "font-semibold text-charcoal" : "text-warmGray"}`}
      >
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${
          bold
            ? "font-bold text-charcoal"
            : accent
            ? "font-medium text-[#c8a45c]"
            : "font-medium text-charcoal"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
