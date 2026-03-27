"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { api } from "@/lib/api";
import { getToken, getStoredUser } from "@/lib/auth";
import { LeaderboardRow } from "@/components/LeaderboardRow";
import { CharityCounter } from "@/components/CharityCounter";

export default function LeaderboardPage() {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const storedUser = getStoredUser();

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ["leaderboard.list"],
    queryFn: () => api.leaderboard.list(),
    staleTime: 10_000,
  });

  const { data: charityData, isLoading: charityLoading } = useQuery({
    queryKey: ["leaderboard.charityTotal"],
    queryFn: () => api.leaderboard.charityTotal(),
    staleTime: 10_000,
  });

  // Real-time update: re-fetch leaderboard when markets resolve (PRD §10)
  useEffect(() => {
    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001";
    const token = getToken();

    const socket = io(wsUrl, {
      auth: token ? { token } : {},
      transports: ["websocket", "polling"],
    });

    socket.on("marketResolved", () => {
      void queryClient.invalidateQueries({ queryKey: ["leaderboard.list"] });
      void queryClient.invalidateQueries({
        queryKey: ["leaderboard.charityTotal"],
      });
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 pt-12 pb-2">
        <h1 className="text-2xl font-bold text-gray-900">Leaderboard</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Ranked by realized P&amp;L across resolved markets
        </p>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Charity counter */}
        <CharityCounter
          totalCents={charityData?.totalCents ?? 0}
          loading={charityLoading}
        />

        {/* Leaderboard list */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4">
          {entriesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 py-2 animate-pulse"
                >
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex-shrink-0" />
                  <div className="flex-1">
                    <div className="h-3 w-28 bg-gray-100 rounded" />
                  </div>
                  <div className="h-3 w-16 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-3xl mb-2">🏆</p>
              <p className="font-semibold text-gray-700">
                Leaderboard is empty
              </p>
              <p className="text-sm text-gray-400 mt-1">
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
        <p className="text-xs text-gray-400 text-center pb-2">
          P&amp;L = net payouts − total bets placed · Updates in real-time
        </p>
      </div>
    </div>
  );
}
