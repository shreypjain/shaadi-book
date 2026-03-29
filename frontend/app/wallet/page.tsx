"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, formatDollars, type TransactionItem } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { BalanceDisplay } from "@/components/BalanceDisplay";
import { DepositButton } from "@/components/DepositButton";
import { WithdrawalForm } from "@/components/WithdrawalForm";

// ---------------------------------------------------------------------------
// Transaction type → human label
// ---------------------------------------------------------------------------

const TX_LABELS: Record<string, { label: string; icon: string }> = {
  DEPOSIT:      { label: "Deposit",    icon: "D" },
  PURCHASE:     { label: "Bet placed", icon: "B" },
  PAYOUT:       { label: "Winnings",   icon: "W" },
  WITHDRAWAL:   { label: "Withdrawal", icon: "X" },

  REFUND:       { label: "Refund",     icon: "R" },
};

const TX_ICON_COLORS: Record<string, string> = {
  DEPOSIT:    "bg-emerald-50 text-emerald-600",
  PURCHASE:   "bg-brand-50 text-brand-600",
  PAYOUT:     "bg-emerald-50 text-emerald-600",
  WITHDRAWAL: "bg-[#f0ece7] text-[#4a4a5a]",

  REFUND:     "bg-[#f0ece7] text-[#4a4a5a]",
};

function TxRow({ tx }: { tx: TransactionItem }) {
  const meta = TX_LABELS[tx.type] ?? { label: tx.type, icon: "·" };
  const iconColor = TX_ICON_COLORS[tx.type] ?? "bg-[#f0ece7] text-[#4a4a5a]";
  const isPositive = tx.amountCents >= 0;

  return (
    <div className="flex items-center gap-3 py-3 border-b border-[#f0ece7] last:border-0">
      {/* Icon */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${iconColor}`}>
        {meta.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1a1a2e]">{meta.label}</p>
        <p className="text-xs text-[#8a8a9a]">
          {new Date(tx.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
      <p
        className={`text-sm font-bold tabular-nums flex-shrink-0
          ${isPositive ? "text-emerald-600" : "text-[#4a4a5a]"}`}
      >
        {isPositive ? "+" : ""}
        {formatDollars(tx.amountCents)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function WalletPageWrapper() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading wallet...</div>}>
      <WalletPage />
    </Suspense>
  );
}

function WalletPage() {
  const searchParams = useSearchParams();
  const depositStatus = searchParams.get("deposit");

  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const storedUser = getStoredUser();

  useEffect(() => {
    if (depositStatus === "success") {
      setToastMsg("Deposit received! Credits will appear shortly.");
    } else if (depositStatus === "cancelled") {
      setToastMsg("Deposit cancelled.");
    }
  }, [depositStatus]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const {
    data: balanceData,
    isLoading: balanceLoading,
    refetch: refetchBalance,
  } = useQuery({
    queryKey: ["wallet.balance"],
    queryFn: () => api.wallet.balance(),
    enabled: true,
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ["wallet.transactions"],
    queryFn: () => api.wallet.transactions(50),
  });

  const handleDepositSuccess = useCallback(() => {
    void refetchBalance();
  }, [refetchBalance]);

  const handleWithdrawalSuccess = useCallback(() => {
    setShowWithdrawal(false);
    setToastMsg("Withdrawal request submitted!");
    void refetchBalance();
  }, [refetchBalance]);

  const balanceCents = balanceData?.balanceCents ?? 0;

  return (
    <div className="min-h-screen pb-24">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#1a1a2e] text-white
                        text-sm px-4 py-2.5 rounded-full shadow-lg whitespace-nowrap">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-[#e8e4df] px-4 pt-12 pb-2">
        <h1 className="text-2xl font-bold text-[#1a1a2e] tracking-tight">My Wallet</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-2">
        {/* Balance card */}
        <div className="bg-white rounded-xl shadow-card border border-[#e8e4df] mt-4 px-6">
          <BalanceDisplay
            balanceCents={balanceCents}
            country={storedUser?.country}
            loading={balanceLoading}
          />

          {/* Action buttons */}
          <div className="flex gap-3 pb-6">
            <DepositButton onSuccess={handleDepositSuccess} />
            <button
              onClick={() => setShowWithdrawal((v) => !v)}
              className="flex-1 rounded-xl border border-[#e8e4df] px-5 py-3
                         text-[#1a1a2e] font-medium text-sm hover:bg-cream-100
                         active:scale-95 transition-all"
            >
              Withdraw
            </button>
          </div>
        </div>

        {/* Withdrawal form */}
        {showWithdrawal && (
          <div className="bg-white rounded-xl shadow-card border border-[#e8e4df] mt-4 p-5">
            <h2 className="text-base font-bold text-[#1a1a2e] mb-4">
              Request Withdrawal
            </h2>
            <WithdrawalForm
              balanceCents={balanceCents}
              onSuccess={handleWithdrawalSuccess}
              onCancel={() => setShowWithdrawal(false)}
            />
          </div>
        )}

        {/* Transaction history */}
        <div className="bg-white rounded-xl shadow-card border border-[#e8e4df] mt-4 p-5">
          <h2 className="text-base font-bold text-[#1a1a2e] mb-3">
            Transaction History
          </h2>

          {txLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-8 h-8 bg-[#f0ece7] rounded-full" />
                  <div className="flex-1">
                    <div className="h-3 w-32 bg-[#f0ece7] rounded mb-1" />
                    <div className="h-2 w-20 bg-[#f5f2ed] rounded" />
                  </div>
                  <div className="h-3 w-14 bg-[#f0ece7] rounded" />
                </div>
              ))}
            </div>
          ) : !txData || txData.length === 0 ? (
            <p className="text-sm text-[#8a8a9a] text-center py-6">
              No transactions yet.
            </p>
          ) : (
            <div>
              {txData.map((tx) => (
                <TxRow key={tx.id} tx={tx} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
