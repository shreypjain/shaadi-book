/**
 * Socket.io server — PRD §6.6 + Appendix A.3
 *
 * Features:
 *  - Redis adapter for multi-instance scaling (skipped when REDIS_URL absent)
 *  - JWT auth in handshake: socket.handshake.auth.token
 *  - Auto-join on connect: user balance channel (private), markets:feed, markets:notify
 *  - subscribe:market / unsubscribe:market events
 */
import type { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import type { Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import jwt from "jsonwebtoken";

import { WS_CHANNELS } from "./channels.js";

// Re-export channel helpers so callers only need one import.
export { WS_CHANNELS } from "./channels.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface JwtPayload {
  userId: string;
  role: "guest" | "admin";
  iat?: number;
  exp?: number;
}

// Augment Socket.io's Socket.data type.
declare module "socket.io" {
  interface SocketData {
    userId: string;
    role: "guest" | "admin";
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton (production use)
// ---------------------------------------------------------------------------

let _io: SocketIOServer | null = null;

// ---------------------------------------------------------------------------
// Factory — can also be called by tests with a fresh httpServer
// ---------------------------------------------------------------------------

/**
 * Wire up Socket.io onto an existing HTTP server.
 *
 * Redis: if REDIS_URL is set the Redis pub/sub adapter is attached for
 * multi-instance fan-out. If absent (tests, local dev without Redis) the
 * default in-memory adapter is used.
 *
 * @param httpServer - Underlying Node.js HTTP server
 * @param jwtSecret  - JWT signing secret (defaults to JWT_SECRET env var)
 * @param setSingleton - When true (default) stores the result as the module
 *                       singleton returned by getIO(). Pass false in tests.
 */
export async function createWebSocketServer(
  httpServer: HttpServer,
  jwtSecret?: string,
  setSingleton = true
): Promise<SocketIOServer> {
  const secret = jwtSecret ?? process.env["JWT_SECRET"] ?? "test-secret";

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // ------------------------------------------------------------------
  // Redis adapter (optional — omitted when REDIS_URL is not set)
  // ------------------------------------------------------------------
  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl) {
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log("[ws] Redis pub/sub adapter attached");
  } else {
    console.log("[ws] REDIS_URL not set — using in-memory adapter (single instance)");
  }

  // ------------------------------------------------------------------
  // JWT auth middleware — runs before the connection event
  // ------------------------------------------------------------------
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth["token"] as string | undefined;

    if (!token) {
      return next(new Error("Authentication failed: no token provided"));
    }

    try {
      const decoded = jwt.verify(token, secret) as JwtPayload;
      socket.data.userId = decoded.userId;
      socket.data.role = decoded.role ?? "guest";
      next();
    } catch {
      next(new Error("Authentication failed: invalid or expired token"));
    }
  });

  // ------------------------------------------------------------------
  // Connection handler
  // ------------------------------------------------------------------
  io.on("connection", (socket: Socket) => {
    const { userId } = socket.data;
    console.log(`[ws] connected  sid=${socket.id} userId=${userId}`);

    // Auto-join private balance channel + global broadcast channels
    void socket.join(WS_CHANNELS.userBalance(userId));
    void socket.join(WS_CHANNELS.marketsFeed);
    void socket.join(WS_CHANNELS.marketsNotify);

    // ----------------------------------------------------------------
    // subscribe:market — join per-market rooms
    // ----------------------------------------------------------------
    socket.on("subscribe:market", (marketId: string) => {
      if (typeof marketId !== "string" || !marketId) return;
      void socket.join(WS_CHANNELS.marketPrices(marketId));
      void socket.join(WS_CHANNELS.marketActivity(marketId));
      console.log(`[ws] sid=${socket.id} subscribed  market=${marketId}`);
    });

    // ----------------------------------------------------------------
    // unsubscribe:market — leave per-market rooms
    // ----------------------------------------------------------------
    socket.on("unsubscribe:market", (marketId: string) => {
      if (typeof marketId !== "string" || !marketId) return;
      void socket.leave(WS_CHANNELS.marketPrices(marketId));
      void socket.leave(WS_CHANNELS.marketActivity(marketId));
      console.log(`[ws] sid=${socket.id} unsubscribed market=${marketId}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[ws] disconnected sid=${socket.id} reason=${reason}`);
    });
  });

  if (setSingleton) {
    _io = io;
  }

  return io;
}

/**
 * Return the module-level Socket.io singleton.
 * Throws if called before createWebSocketServer().
 */
export function getIO(): SocketIOServer {
  if (!_io) {
    throw new Error(
      "WebSocket server not initialised — call createWebSocketServer() first."
    );
  }
  return _io;
}
