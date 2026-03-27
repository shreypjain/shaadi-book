import type { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import type { Socket } from "socket.io";

// ---------------------------------------------------------------------------
// WebSocket channel names (mirrors PRD §6.6)
// ---------------------------------------------------------------------------
export const WS_CHANNELS = {
  marketPrices: (marketId: string) => `market:${marketId}:prices`,
  marketActivity: (marketId: string) => `market:${marketId}:activity`,
  marketsFeed: "markets:feed",
  marketsNotify: "markets:notify",
  userBalance: (userId: string) => `user:${userId}:balance`,
} as const;

// ---------------------------------------------------------------------------
// Socket.io server setup
// ---------------------------------------------------------------------------
let io: SocketIOServer | null = null;

export function createWebSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Debounce: handled at publish site (max 2 price updates/sec per PRD §6.6)
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[ws] client connected: ${socket.id}`);

    // Join a market room to receive price updates for that market
    socket.on("subscribe:market", (marketId: string) => {
      void socket.join(WS_CHANNELS.marketPrices(marketId));
      void socket.join(WS_CHANNELS.marketActivity(marketId));
    });

    // Leave a market room
    socket.on("unsubscribe:market", (marketId: string) => {
      void socket.leave(WS_CHANNELS.marketPrices(marketId));
      void socket.leave(WS_CHANNELS.marketActivity(marketId));
    });

    // Auth handshake — join private balance channel
    // Full JWT validation wired in Task 1.3/1.4
    socket.on("auth", (data: { userId: string }) => {
      if (typeof data.userId === "string" && data.userId.length > 0) {
        void socket.join(WS_CHANNELS.userBalance(data.userId));
        socket.emit("auth:ok");
      } else {
        socket.emit("auth:error", { message: "Missing userId" });
      }
    });

    socket.on("disconnect", () => {
      console.log(`[ws] client disconnected: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Get the global Socket.io server instance.
 * Throws if called before createWebSocketServer().
 */
export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error("WebSocket server not initialized. Call createWebSocketServer() first.");
  }
  return io;
}
