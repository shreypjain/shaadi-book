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
          <h1 className="text-3xl font-bold text-[#1a1a2e] tracking-tight">
            How to Play
          </h1>
          {/* Gold accent underline */}
          <div className="mt-2.5 h-px w-14 mx-auto bg-[#c8a45c]" />
          <p className="mt-3 text-sm text-[#4a4a5a] font-medium">
            A crash course in wedding prediction markets
          </p>
          <p className="mt-1.5 text-xs text-[#8a8a9a]">
            No finance degree required. Vibes &amp; probability only.
          </p>
        </div>

        {/* ── Section 1: The Basics ─────────────────────────────────── */}
        <SectionCard
          emoji="🎯"
          title="The Basics"
          subtitle="Everything you need to know in 30 seconds"
        >
          <ul className="flex flex-col gap-3 mt-1">
            <RuleItem
              icon="💍"
              text="Bet on real outcomes from the wedding — Will the baraat be late? How many outfit changes? Who cries first?"
            />
            <RuleItem
              icon="💰"
              text={
                <>
                  Each outcome has a price between{" "}
                  <Highlight>1¢ and 99¢</Highlight>. That price{" "}
                  <em>is</em> the crowd&apos;s implied probability.
                  If &quot;Yes&quot; is at 75¢, the room thinks
                  it&apos;s a 75% chance.
                </>
              }
            />
            <RuleItem
              icon="📈"
              text={
                <>
                  If your outcome wins, you{" "}
                  <Highlight>split the total pool</Highlight> with other
                  winners. The fewer people on your side, the bigger your
                  share. Payouts are capped at{" "}
                  <Highlight>$1.00 per share</Highlight>.
                </>
              }
            />
            <RuleItem
              icon="💎"
              text={
                <>
                  <Highlight>$200 max bet per market.</Highlight> No
                  selling — diamond hands only. You hold till
                  resolution.
                </>
              }
            />
          </ul>
        </SectionCard>

        {/* ── Section 2: How Prices Work ───────────────────────────── */}
        <SectionCard
          emoji="📊"
          title="How Prices Work"
          subtitle="The spicy quant stuff — don't skip this"
        >
          <div className="flex flex-col gap-3 mt-1 text-sm text-[#4a4a5a]">
            <p>
              Prices are set by a{" "}
              <span className="font-semibold text-[#1a1a2e]">
                Logarithmic Market Scoring Rule (LMSR)
              </span>{" "}
              — inspired by previous attempts to build prediction markets
              optimized for low volume and small numbers of traders. Shrey
              is the bookie, but{" "}
              <span className="font-semibold text-[#1a1a2e]">
                not the house or market maker
              </span>
              . This is a{" "}
              <span className="font-semibold text-[#1a1a2e]">
                parimutuel system
              </span>{" "}
              — you&apos;re betting against other guests, not against
              the house.
            </p>

            {/* LMSR mechanics block */}
            <div className="rounded-lg bg-[#f5f1eb] border border-[#e8e4df] p-4 flex flex-col gap-2.5">
              <p className="text-xs font-semibold text-[#8a8a9a] uppercase tracking-wider">
                LMSR mechanics
              </p>
              <p className="text-sm text-[#1a1a2e]">
                The market maintains a{" "}
                <span className="font-semibold">cost function</span>:
              </p>
              <p className="text-sm font-mono text-[#1a1a2e] bg-white border border-[#e8e4df] rounded px-3 py-2 text-center tracking-tight">
                C(q) = b · ln( Σ exp(q<sub>i</sub> / b) )
              </p>
              <p className="text-sm text-[#4a4a5a]">
                where <span className="font-mono font-semibold">q<sub>i</sub></span> is the
                total shares outstanding for outcome <em>i</em> and{" "}
                <span className="font-mono font-semibold">b</span> is the
                liquidity parameter. You pay the{" "}
                <span className="font-semibold text-[#1a1a2e]">
                  change in cost
                </span>{" "}
                — C(q_after) − C(q_before) — not a fixed price per share.
              </p>
              <p className="text-sm text-[#4a4a5a]">
                The exponential in the sum guarantees that the implied
                probability of each outcome is{" "}
                <span className="font-semibold text-[#1a1a2e]">
                  exp(q<sub>i</sub>/b) / Σ exp(q<sub>j</sub>/b)
                </span>
                , which always sums to exactly 1 across all outcomes.
                Buy shares on &quot;Yes&quot; and its price rises;
                &quot;No&quot; falls proportionally — the market
                reprices continuously, with no manual intervention.
              </p>
              <p className="text-sm text-[#4a4a5a]">
                When you enter a dollar amount, the engine runs a{" "}
                <span className="font-semibold text-[#1a1a2e]">
                  binary search
                </span>{" "}
                over share counts to find the exact quantity that costs
                that amount under the current cost function — no
                closed-form inverse, just fast iteration inside a
                single Postgres transaction with row-level locks.
              </p>
            </div>

            {/* Example block */}
            <div className="rounded-lg bg-[#f5f1eb] border border-[#e8e4df] p-4 flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-[#8a8a9a] uppercase tracking-wider">
                Example
              </p>
              <p className="text-sm text-[#1a1a2e]">
                &quot;Will Parsh cry during the pheras?&quot; opens at{" "}
                <Highlight>50¢ / 50¢</Highlight>. Guest A slams $20 on
                Yes → price jumps to <Highlight>88¢</Highlight>. Guest B
                bets $10 on No → settles back to{" "}
                <Highlight>78¢</Highlight>. Every buy moves the market
                in real time.
              </p>
            </div>

            <p>
              Liquidity adjusts dynamically via the{" "}
              <span className="font-semibold text-[#1a1a2e]">
                adaptive b parameter
              </span>
              . The two dominant factors are{" "}
              <span className="font-semibold text-[#1a1a2e]">
                time since market open
              </span>{" "}
              and{" "}
              <span className="font-semibold text-[#1a1a2e]">
                total market volume
              </span>{" "}
              — both cause b to grow over time, meaning the market hardens
              and individual bets move prices less. Early bets swing prices
              hard (first-mover advantage 🏃); late bets barely nudge them.
              Plus a few more features under the hood.
            </p>

            {/* b table */}
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#e8e4df]">
                    <th className="text-left py-1.5 px-2 text-[#8a8a9a] font-medium">
                      Market age
                    </th>
                    <th className="text-left py-1.5 px-2 text-[#8a8a9a] font-medium">
                      Volume
                    </th>
                    <th className="text-left py-1.5 px-2 text-[#8a8a9a] font-medium">
                      $50 bet moves 50¢ to…
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[#4a4a5a]">
                  <tr className="border-b border-[#f0ece7]">
                    <td className="py-1.5 px-2">0 sec</td>
                    <td className="py-1.5 px-2">$0</td>
                    <td className="py-1.5 px-2 font-semibold text-[#c8a45c]">
                      96¢ 🚀
                    </td>
                  </tr>
                  <tr className="border-b border-[#f0ece7]">
                    <td className="py-1.5 px-2">30 sec</td>
                    <td className="py-1.5 px-2">$100</td>
                    <td className="py-1.5 px-2 font-semibold text-[#1a1a2e]">
                      77¢
                    </td>
                  </tr>
                  <tr className="border-b border-[#f0ece7]">
                    <td className="py-1.5 px-2">5 min</td>
                    <td className="py-1.5 px-2">$500</td>
                    <td className="py-1.5 px-2 font-semibold text-[#1a1a2e]">
                      61¢
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 px-2">30 min</td>
                    <td className="py-1.5 px-2">$2,000</td>
                    <td className="py-1.5 px-2 font-semibold text-[#1a1a2e]">
                      54¢ (hardened)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-xs text-[#8a8a9a]">
              tl;dr — be early, be right, print money.
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
          emoji="🏆"
          title="Payouts"
          subtitle="The part everyone actually cares about"
        >
          <div className="flex flex-col gap-3 mt-1 text-sm text-[#4a4a5a]">
            <ul className="flex flex-col gap-3">
              <RuleItem
                icon="✅"
                text={
                  <>
                    Winning shares split the total market pool. Your payout
                    per share ={" "}
                    <Highlight>
                      min(total pool / winning shares, $1.00)
                    </Highlight>
                    . If the pool is thin, you might get less than $1.00.
                    If few people picked your side, you can make bank.
                    Losing shares pay $0.00.
                  </>
                }
              />
              <RuleItem
                icon="🎗️"
                text={
                  <>
                    <Highlight>10% of your profit</Highlight> goes to
                    charity when you cash out. The couple hasn&apos;t
                    chosen the cause yet. You&apos;re basically a
                    quantitative philanthropist.
                  </>
                }
              />
            </ul>

            {/* Worked example */}
            <div className="rounded-lg bg-[#f5f1eb] border border-[#e8e4df] p-4 flex flex-col gap-2">
              <p className="text-xs font-semibold text-[#8a8a9a] uppercase tracking-wider">
                Worked example
              </p>
              <div className="flex flex-col gap-1 text-sm text-[#1a1a2e]">
                <ExampleRow label="You buy" value="10 shares at 40¢" />
                <ExampleRow label="Your cost" value="$4.00" />
                <ExampleRow label="Outcome wins → pool pays $0.90/share" value="$9.00" />
                <ExampleRow label="Profit" value="$5.00" />
                <ExampleRow
                  label="Charity (10% of profit)"
                  value="− $0.50"
                  accent
                />
                <div className="border-t border-[#e8e4df] mt-1 pt-2">
                  <ExampleRow
                    label="You take home"
                    value="$8.50 🎉"
                    bold
                  />
                </div>
              </div>
            </div>

            <RuleItem
              icon="📱"
              text="Payouts sent via Venmo or Zelle after the wedding. Shrey is the bookie. He&apos;s good for it."
            />
          </div>
        </SectionCard>

        {/* ── Section 4: House Rules ────────────────────────────────── */}
        <SectionCard
          emoji="📜"
          title="House Rules"
          subtitle="Short list. No fine print."
        >
          <ul className="flex flex-col gap-3 mt-1">
            <RuleItem icon="🇺🇸" text="All bets are in USD." />
            <RuleItem
              icon="🎲"
              text={
                <>
                  Shrey is the bookie — but he&apos;s not the house.{" "}
                  <span className="text-[#8a8a9a]">
                    You&apos;re betting against each other in a parimutuel
                    pool.
                  </span>
                </>
              }
            />
            <RuleItem
              icon="⚖️"
              text="Markets are resolved by admin decree. No appeals, no arbitration, no crying (unless you bet on it)."
            />
            <RuleItem
              icon="😂"
              text="Have fun. Don't bet your rent money. This is a wedding, not a hedge fund."
            />
            <RuleItem
              icon="❤️"
              text="This is for charity and entertainment. Winning feels great. Losing still helped a good cause."
            />
          </ul>
        </SectionCard>

        {/* ── Disclaimer ───────────────────────────────────────────── */}
        <div className="px-2 pb-2">
          <p className="text-[10px] text-[#8a8a9a] text-center leading-relaxed">
            This is a private entertainment experience for the wedding of
            Parsh &amp; Spoorthi. All proceeds benefit charity. Play
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
  emoji,
  title,
  subtitle,
  children,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white border border-[#e8e4df] shadow-card overflow-hidden animate-slide-up">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-[#e8e4df] bg-cream-100 flex items-center gap-3">
        <span className="text-xl leading-none">{emoji}</span>
        <div>
          <h2 className="text-sm font-semibold text-[#1a1a2e]">{title}</h2>
          <p className="text-xs text-[#8a8a9a] mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

function RuleItem({
  icon,
  text,
}: {
  icon: string;
  text: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 items-start list-none">
      <span className="text-base leading-none mt-0.5 shrink-0">{icon}</span>
      <p className="text-sm text-[#4a4a5a] leading-relaxed">{text}</p>
    </li>
  );
}

function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-semibold text-[#1a1a2e]">{children}</span>
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
        className={`text-xs ${bold ? "font-semibold text-[#1a1a2e]" : "text-[#8a8a9a]"}`}
      >
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${
          bold
            ? "font-bold text-[#1a1a2e]"
            : accent
            ? "font-medium text-[#c8a45c]"
            : "font-medium text-[#1a1a2e]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
