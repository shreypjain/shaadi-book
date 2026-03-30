"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { api } from "@/lib/api";
import { getToken, getStoredUser } from "@/lib/auth";
import { LeaderboardRow } from "@/components/LeaderboardRow";

export default function LeaderboardPage() {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const storedUser = getStoredUser();

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ["leaderboard.list"],
    queryFn: () => api.leaderboard.list(),
    staleTime: 10_000,
  });

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001";
    const token = getToken();

    const socket = io(wsUrl, {
      auth: token ? { token } : {},
      transports: ["websocket", "polling"],
    });

    socket.on("marketResolved", () => {
      void queryClient.invalidateQueries({ queryKey: ["leaderboard.list"] });

    });

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, [queryClient]);

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="bg-white border-b border-[rgba(184,134,11,0.12)] px-4 pt-12 pb-2">
        <h1 className="text-2xl font-bold text-charcoal tracking-tight">Leaderboard</h1>
        <p className="text-sm text-warmGray mt-0.5">
          Ranked by realized P&amp;L across resolved markets
        </p>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Leaderboard list */}
        <div className="bg-white rounded-xl shadow-card border border-[rgba(184,134,11,0.12)] p-4">
          {entriesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3 py-2 animate-pulse">
                  <div className="w-8 h-8 bg-[#f0ece7] rounded-full flex-shrink-0" />
                  <div className="flex-1">
                    <div className="h-3 w-28 bg-[#f0ece7] rounded" />
                  </div>
                  <div className="h-3 w-16 bg-[#f0ece7] rounded" />
                </div>
              ))}
            </div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-12 h-12 rounded-full bg-[#f5efd9] flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-[#c8a45c]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" />
                </svg>
              </div>
              <p className="font-semibold text-charcoal">Leaderboard is empty</p>
              <p className="text-sm text-warmGray mt-1">
                Rankings appear after markets resolve.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <LeaderboardRow
                  key={entry.userId}
                  entry={entry}
                  isCurrentUser={storedUser?.id === entry.userId}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer note */}
        <p className="text-xs text-warmGray text-center pb-2">
          P&amp;L = net payouts − total bets placed · Updates in real-time
        </p>
      </div>
    </div>
  );
}
