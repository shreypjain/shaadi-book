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

app.use(helmet());
app.use(morgan(process.env["NODE_ENV"] === "production" ? "combined" : "dev"));

// JWT auth middleware — populates req.userId / req.userRole / req.userPhone
app.use(authMiddleware);

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
