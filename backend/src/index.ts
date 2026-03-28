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
import webhookRouter from "./routes/webhooks.js";
import smsRouter from "./routes/sms.js";
import { startIntegrityMonitor } from "./services/hashChainVerifier.js";

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(
  cors({
    origin: process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3000",
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
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`[server] Backend running on http://localhost:${PORT}`);
      console.log(`[server] Health: http://localhost:${PORT}/health`);
      console.log(`[server] tRPC: http://localhost:${PORT}/trpc`);
    });

    // Start ledger hash-chain integrity monitor (checks every 60 s).
    startIntegrityMonitor(60_000);
  })
  .catch((err: unknown) => {
    console.error("[server] Failed to start WebSocket server:", err);
    process.exit(1);
  });
