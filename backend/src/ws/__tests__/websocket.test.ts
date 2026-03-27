/**
 * WebSocket infrastructure tests — PRD §6.6 / Task 1.4
 *
 * Uses an in-memory Socket.io server (no Redis) so tests run without any
 * external services.  Each test creates its own HTTP + Socket.io server on a
 * random OS-assigned port and cleans up in afterEach.
 */
import http from "http";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server as SocketIOServer } from "socket.io";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import jwt from "jsonwebtoken";

import { createWebSocketServer } from "../index.js";
import { WS_CHANNELS } from "../channels.js";
import {
  broadcastPriceUpdate,
  broadcastBalanceUpdate,
  resetThrottle,
  type PriceUpdate,
} from "../broadcaster.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-jwt-secret-for-websocket-tests";

function makeToken(userId: string, role: "guest" | "admin" = "guest"): string {
  return jwt.sign({ userId, role }, TEST_SECRET, { expiresIn: "1h" });
}

/** Starts an HTTP server on a random port, returns port number. */
function startHttpServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind to port"));
        return;
      }
      resolve({ server, port: addr.port });
    });
    server.on("error", reject);
  });
}

/** Returns a promise that resolves once the client is connected. */
function connectClient(
  port: number,
  token?: string
): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioc(`http://127.0.0.1:${port}`, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });

    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

/** Waits for a single named event on a client socket. */
function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 3000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${event}"`));
    }, timeoutMs);

    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/** Cleanly disconnect a client socket. */
function disconnectClient(socket: ClientSocket): Promise<void> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve();
      return;
    }
    socket.once("disconnect", () => resolve());
    socket.disconnect();
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("WebSocket infrastructure", () => {
  let httpServer: http.Server;
  let io: SocketIOServer;
  let port: number;

  beforeEach(async () => {
    resetThrottle(); // prevent cross-test throttle leakage

    const setup = await startHttpServer();
    httpServer = setup.server;
    port = setup.port;

    // Pass setSingleton=false so tests don't stomp on the global singleton.
    io = await createWebSocketServer(httpServer, TEST_SECRET, false);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      io.close(() => {
        httpServer.close(() => resolve());
      });
    });
  });

  // -------------------------------------------------------------------------
  // Test 1: Two clients subscribe to the same market; a price update reaches both
  // -------------------------------------------------------------------------
  it("broadcasts price updates to all subscribers of the same market", async () => {
    const marketId = "market-abc-123";
    const token1 = makeToken("user-1");
    const token2 = makeToken("user-2");

    const [client1, client2] = await Promise.all([
      connectClient(port, token1),
      connectClient(port, token2),
    ]);

    // Both subscribe to the same market
    const sub1Done = new Promise<void>((resolve) => {
      client1.emit("subscribe:market", marketId);
      // Short pause to let the server process the join before we broadcast
      setTimeout(resolve, 50);
    });
    const sub2Done = new Promise<void>((resolve) => {
      client2.emit("subscribe:market", marketId);
      setTimeout(resolve, 50);
    });
    await Promise.all([sub1Done, sub2Done]);

    // Set up listeners before broadcasting
    const recv1 = waitForEvent<{ marketId: string; prices: PriceUpdate[] }>(
      client1,
      "priceUpdate"
    );
    const recv2 = waitForEvent<{ marketId: string; prices: PriceUpdate[] }>(
      client2,
      "priceUpdate"
    );

    const prices: PriceUpdate[] = [
      { outcomeId: "outcome-yes", priceCents: 62 },
      { outcomeId: "outcome-no", priceCents: 38 },
    ];
    broadcastPriceUpdate(io, marketId, prices);

    const [data1, data2] = await Promise.all([recv1, recv2]);

    expect(data1.marketId).toBe(marketId);
    expect(data1.prices).toEqual(prices);
    expect(data2.marketId).toBe(marketId);
    expect(data2.prices).toEqual(prices);

    await Promise.all([disconnectClient(client1), disconnectClient(client2)]);
  });

  // -------------------------------------------------------------------------
  // Test 2: Balance update only reaches the specific user
  // -------------------------------------------------------------------------
  it("sends balance updates only to the targeted user", async () => {
    const userId1 = "user-balance-1";
    const userId2 = "user-balance-2";

    const [client1, client2] = await Promise.all([
      connectClient(port, makeToken(userId1)),
      connectClient(port, makeToken(userId2)),
    ]);

    // client1 waits for a balance update
    const balancePromise = waitForEvent<{ balanceCents: number }>(
      client1,
      "balanceUpdate"
    );

    // Set up a rejection guard: client2 must NOT receive a balance update
    let client2ReceivedBalance = false;
    client2.on("balanceUpdate", () => {
      client2ReceivedBalance = true;
    });

    // Broadcast balance to userId1 only
    broadcastBalanceUpdate(io, userId1, { balanceCents: 5000 });

    const data = await balancePromise;
    expect(data.balanceCents).toBe(5000);

    // Give client2 a moment to (not) receive anything
    await new Promise((r) => setTimeout(r, 100));
    expect(client2ReceivedBalance).toBe(false);

    await Promise.all([disconnectClient(client1), disconnectClient(client2)]);
  });

  // -------------------------------------------------------------------------
  // Test 3: Unauthenticated connection is rejected
  // -------------------------------------------------------------------------
  it("rejects connections without a valid JWT", async () => {
    // No token provided
    await expect(connectClient(port, undefined)).rejects.toThrow();

    // Invalid / tampered token
    await expect(connectClient(port, "not.a.valid.jwt")).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Test 4: subscribe:market / unsubscribe:market controls channel membership
  // -------------------------------------------------------------------------
  it("respects subscribe and unsubscribe:market events", async () => {
    const marketId = "market-sub-unsub";
    const client = await connectClient(port, makeToken("user-sub-test"));

    // Subscribe then immediately unsubscribe
    await new Promise<void>((resolve) => {
      client.emit("subscribe:market", marketId);
      setTimeout(resolve, 50);
    });
    await new Promise<void>((resolve) => {
      client.emit("unsubscribe:market", marketId);
      setTimeout(resolve, 50);
    });

    // After unsubscribe the client should NOT receive price updates
    let received = false;
    client.on("priceUpdate", () => {
      received = true;
    });

    broadcastPriceUpdate(io, marketId, [
      { outcomeId: "outcome-yes", priceCents: 55 },
    ]);

    // Wait briefly to confirm silence
    await new Promise((r) => setTimeout(r, 150));
    expect(received).toBe(false);

    // Re-subscribe — now updates should arrive again
    await new Promise<void>((resolve) => {
      client.emit("subscribe:market", marketId);
      setTimeout(resolve, 50);
    });

    resetThrottle(); // clear throttle so the second broadcast goes through
    const recv = waitForEvent<{ marketId: string }>(client, "priceUpdate");

    broadcastPriceUpdate(io, marketId, [
      { outcomeId: "outcome-yes", priceCents: 60 },
    ]);

    const data = await recv;
    expect(data.marketId).toBe(marketId);

    await disconnectClient(client);
  });
});
