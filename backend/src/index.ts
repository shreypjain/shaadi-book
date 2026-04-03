import http from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import * as trpcExpress from "@trpc/server/adapters/express";

import { createContext, router, publicProcedure } from "./trpc.js";
import { createWebSocketServer } from "./ws/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { authRouter } from "./routers/auth.js";
import { marketRouter } from "./routers/market.js";
import { adminRouter } from "./routers/admin.js";
import { withdrawalRouter } from "./routers/withdrawal.js";
import { paymentRouter } from "./routers/payment.js";
import { betsRouter } from "./routers/bets.js";
import { leaderboardRouter } from "./routers/leaderboard.js";
import { walletRouter } from "./routers/wallet.js";
import { suggestRouter } from "./routers/suggest.js";
import { pushRouter } from "./routers/push.js";
import webhookRouter from "./routes/webhooks.js";
import smsRouter from "./routes/sms.js";
import { startIntegrityMonitor } from "./services/hashChainVerifier.js";
import { startPeriodicNotifications } from "./services/smsNotifier.js";
import { startPeriodicPushUpdates } from "./services/pushNotifier.js";
import { startPriceSnapshotJob } from "./services/priceSnapshot.js";
import { reschedulePendingMarkets } from "./services/notificationService.js";
import { openMarket } from "./services/marketService.js";
import { prisma } from "./db.js";

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(
  cors({
    origin: process.env["CORS_ORIGIN"] ?? "http://localhost:3000",
    credentials: true,
  })
);

// Raw body needed for Stripe webhook signature verification (Task 3.1)
// Must be before express.json()
app.use(
  express.json({
    verify: (req, _res, buf) => {
      // Attach rawBody for Stripe webhook verification
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

// URL-encoded body parser for Twilio webhook payloads (Task 5.1)
app.use(express.urlencoded({ extended: false }));

app.use(helmet());
app.use(morgan(process.env["NODE_ENV"] === "production" ? "combined" : "dev"));

// JWT auth middleware — populates req.userId / req.userRole / req.userPhone
app.use(authMiddleware);

// ---------------------------------------------------------------------------
// Stripe Webhook (Express route — NOT tRPC)
// Mounted BEFORE tRPC so it receives the raw body that express.json() saves
// ---------------------------------------------------------------------------

app.use("/api/webhooks", webhookRouter);

// ---------------------------------------------------------------------------
// Twilio SMS Webhook (Express route — NOT tRPC)
// Mounted here; express.urlencoded() above parses Twilio's form-encoded body
// ---------------------------------------------------------------------------

app.use("/api/sms", smsRouter);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// tRPC router (root — routers added in Phase 1–3 tasks)
// ---------------------------------------------------------------------------

const appRouter = router({
  health: publicProcedure.query(() => ({
    status: "ok" as const,
    timestamp: new Date().toISOString(),
  })),
  auth: authRouter,
  market: marketRouter,
  admin: adminRouter,
  withdrawal: withdrawalRouter,
  payment: paymentRouter,
  bets: betsRouter,
  leaderboard: leaderboardRouter,
  wallet: walletRouter,
  suggest: suggestRouter,
  push: pushRouter,
});

export type AppRouter = typeof appRouter;

app.use(
  "/trpc",
  trpcExpress.createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);
const httpServer = http.createServer(app);

// createWebSocketServer is async (Redis adapter setup)
createWebSocketServer(httpServer)
  .then((io) => {
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`[server] Backend running on http://localhost:${PORT}`);
      console.log(`[server] Health: http://localhost:${PORT}/health`);
      console.log(`[server] tRPC: http://localhost:${PORT}/trpc`);
    });

    // Start ledger hash-chain integrity monitor (checks every 60 s).
    startIntegrityMonitor(60_000);

    // Start periodic price snapshots for chart history (every 60 s).
    startPriceSnapshotJob(60_000);

    // Start periodic SMS market updates (every 5 hours).
    // Controlled by ENABLE_SMS_NOTIFICATIONS env var — off by default in dev/test.
    if (process.env["ENABLE_SMS_NOTIFICATIONS"] === "true") {
      startPeriodicNotifications(5 * 60 * 60 * 1000); // every 5 hours
    }

    // Start periodic push notification updates (every 5 hours, same cadence as SMS).
    // Always enabled when VAPID keys are set — no separate env flag needed.
    startPeriodicPushUpdates(5 * 60 * 60 * 1000);

    // Reschedule pending markets that have a scheduledOpenAt (survives restarts).
    reschedulePendingMarkets(prisma, openMarket, io).catch((err: unknown) => {
      console.error("[server] Failed to reschedule pending markets:", err);
    });
  })
  .catch((err: unknown) => {
    console.error("[server] Failed to start WebSocket server:", err);
    process.exit(1);
  });
