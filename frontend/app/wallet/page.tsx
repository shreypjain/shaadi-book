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
  CHARITY_FEE:  { label: "Charity fee",icon: "C" },
  REFUND:       { label: "Refund",     icon: "R" },
};

const TX_ICON_COLORS: Record<string, string> = {
  DEPOSIT:    "bg-gold-pale text-[#B8860B]",
  PURCHASE:   "bg-[#FAF7F2] text-[#6B6156]",
  PAYOUT:     "bg-gold-pale text-[#B8860B]",
  WITHDRAWAL: "bg-[#EDE8E0] text-[#6B6156]",
  CHARITY_FEE:"bg-gold-pale text-[#B8860B]",
  REFUND:     "bg-[#EDE8E0] text-[#6B6156]",
};

function TxRow({ tx }: { tx: TransactionItem }) {
  const meta = TX_LABELS[tx.type] ?? { label: tx.type, icon: "·" };
  const iconColor = TX_ICON_COLORS[tx.type] ?? "bg-[#EDE8E0] text-[#6B6156]";
  const isPositive = tx.amountCents >= 0;

  return (
    <div className="flex items-center gap-3 py-3 border-b border-[rgba(184,134,11,0.08)] last:border-0">
      {/* Icon */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${iconColor}`}>
        {meta.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-charcoal">{meta.label}</p>
        <p className="text-xs text-warmGray">
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
          ${isPositive ? "text-[#B8860B]" : "text-warmGray"}`}
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
    <Suspense fallback={<div className="p-8 text-center text-warmGray">Loading wallet...</div>}>
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
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-charcoal text-white
                        text-sm px-4 py-2.5 rounded-full shadow-lg whitespace-nowrap">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="bg-ivory-card border-b border-[rgba(184,134,11,0.12)] px-4 pt-12 pb-2">
        <h1 className="font-serif text-2xl font-semibold text-charcoal tracking-tight">My Wallet</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-2">
        {/* Balance card */}
        <div className="bg-ivory-card rounded-xl shadow-card border border-[rgba(184,134,11,0.12)] mt-4 px-6">
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
              className="flex-1 rounded-xl border border-[rgba(44,44,44,0.15)] px-5 py-3
                         text-charcoal font-medium text-sm hover:bg-gold-light hover:border-gold/30
                         active:scale-95 transition-all"
            >
              Withdraw
            </button>
          </div>
        </div>

        {/* Withdrawal form */}
        {showWithdrawal && (
          <div className="bg-ivory-card rounded-xl shadow-card border border-[rgba(184,134,11,0.12)] mt-4 p-5">
            <h2 className="font-serif text-base font-semibold text-charcoal mb-4">
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
        <div className="bg-ivory-card rounded-xl shadow-card border border-[rgba(184,134,11,0.12)] mt-4 p-5">
          <h2 className="font-serif text-base font-semibold text-charcoal mb-3">
            Transaction History
          </h2>

          {txLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-8 h-8 bg-gold-light rounded-full" />
                  <div className="flex-1">
                    <div className="h-3 w-32 bg-gold-light rounded mb-1" />
                    <div className="h-2 w-20 bg-gold-light/60 rounded" />
                  </div>
                  <div className="h-3 w-14 bg-gold-light rounded" />
                </div>
              ))}
            </div>
          ) : !txData || txData.length === 0 ? (
            <p className="text-sm text-warmGray text-center py-6">
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
