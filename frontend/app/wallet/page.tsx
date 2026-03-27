"use client";

import { useEffect, useState, useCallback } from "react";
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
  DEPOSIT: { label: "Deposit", icon: "⬇️" },
  PURCHASE: { label: "Bet placed", icon: "🎯" },
  PAYOUT: { label: "Winnings", icon: "🏆" },
  WITHDRAWAL: { label: "Withdrawal", icon: "⬆️" },
  CHARITY_FEE: { label: "Charity fee", icon: "💝" },
  REFUND: { label: "Refund", icon: "↩️" },
};

function TxRow({ tx }: { tx: TransactionItem }) {
  const meta = TX_LABELS[tx.type] ?? { label: tx.type, icon: "·" };
  const isPositive = tx.amountCents >= 0;

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
      <span className="text-xl w-8 text-center flex-shrink-0">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{meta.label}</p>
        <p className="text-xs text-gray-400">
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
          ${isPositive ? "text-green-600" : "text-gray-700"}`}
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

export default function WalletPage() {
  const searchParams = useSearchParams();
  const depositStatus = searchParams.get("deposit");

  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const storedUser = getStoredUser();

  // Show Stripe return status
  useEffect(() => {
    if (depositStatus === "success") {
      setToastMsg("Deposit received! Credits will appear shortly.");
    } else if (depositStatus === "cancelled") {
      setToastMsg("Deposit cancelled.");
    }
  }, [depositStatus]);

  // Auto-dismiss toast
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
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white
                        text-sm px-4 py-2.5 rounded-full shadow-lg whitespace-nowrap">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 pt-12 pb-2">
        <h1 className="text-2xl font-bold text-gray-900">My Wallet</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-2">
        {/* Balance card */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 mt-4 px-6">
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
              className="flex-1 rounded-xl border-2 border-brand-600 px-5 py-3
                         text-brand-700 font-semibold text-sm hover:bg-brand-50
                         active:scale-95 transition-all"
            >
              Withdraw
            </button>
          </div>
        </div>

        {/* Withdrawal form */}
        {showWithdrawal && (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 mt-4 p-5">
            <h2 className="text-base font-bold text-gray-900 mb-4">
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
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 mt-4 p-5">
          <h2 className="text-base font-bold text-gray-900 mb-3">
            Transaction History
          </h2>

          {txLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-8 h-8 bg-gray-100 rounded-full" />
                  <div className="flex-1">
                    <div className="h-3 w-32 bg-gray-100 rounded mb-1" />
                    <div className="h-2 w-20 bg-gray-50 rounded" />
                  </div>
                  <div className="h-3 w-14 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          ) : !txData || txData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
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
