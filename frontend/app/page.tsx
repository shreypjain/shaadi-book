export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-md text-center">
        {/* Logo / Title */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-brand-700 mb-2">
            Shaadi Book
          </h1>
          <p className="text-lg text-gray-500">
            Live prediction market
          </p>
          <p className="text-sm text-gray-400 mt-1">
            Parsh &amp; Spoorthi &middot; Udaipur
          </p>
        </div>

        {/* Placeholder CTA */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-8 shadow-sm">
          <p className="text-gray-600 mb-6">
            Place bets on wedding outcomes with real money.
            Early movers get the best odds.
          </p>
          <button
            className="w-full rounded-xl bg-brand-600 px-6 py-3 text-white font-semibold
                       text-base hover:bg-brand-700 active:scale-95 transition-all
                       disabled:opacity-50"
            disabled
          >
            Sign in with Phone →
          </button>
          <p className="mt-4 text-xs text-gray-400">
            Auth coming in Task 1.3
          </p>
        </div>

        {/* Status */}
        <div className="mt-8 flex items-center justify-center gap-2 text-xs text-gray-400">
          <span className="inline-block h-2 w-2 rounded-full bg-green-400"></span>
          <span>Scaffold complete · Task 0.1</span>
        </div>
      </div>
    </main>
  );
}
