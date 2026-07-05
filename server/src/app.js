import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { errorHandler, wrap } from "./middleware/error.js";
import { authRouter } from "./routes/auth.js";
import { walletRouter } from "./routes/wallet.js";
import { gamesRouter } from "./routes/games.js";
import { sportsRouter } from "./routes/sports.js";
import { adminRouter } from "./routes/admin.js";
import { slotsRouter, fairRouter } from "./routes/slots.js";
import { statsRouter } from "./routes/stats.js";
import { settleFinishedMatches } from "./services/sports.js";
import { snapshotRtp } from "./services/slots.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    helmet({
      // O front usa estilos inline (gradientes por jogo) e fontes do Google
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(compression());
  if (process.env.NODE_ENV !== "test" && !config.isServerless) {
    app.use(morgan("tiny"));
  }
  app.use(cors());
  app.use(express.json({ limit: "64kb" }));

  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false }, // atrás do proxy da Vercel/Railway
    })
  );
  app.set("trust proxy", 1);

  app.get("/api/health", (_req, res) => res.json({ ok: true, name: "yoshibet-api" }));
  app.use("/api/auth", authRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/games", gamesRouter);
  app.use("/api/sports", sportsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/slots", slotsRouter);
  app.use("/api/fair", fairRouter);
  app.use("/api/stats", statsRouter);

  // Vercel Cron chama esta rota (Authorization: Bearer CRON_SECRET)
  app.get("/api/cron/settle", wrap(async (req, res) => {
    const auth = req.headers.authorization || "";
    if (config.cronSecret && auth !== `Bearer ${config.cronSecret}`) {
      return res.status(401).json({ error: "Não autorizado" });
    }
    res.json({
      settled: await settleFinishedMatches(),
      rtpSnapshots: await snapshotRtp("cron"),
    });
  }));

  // Serve o front-end estático (raiz do repositório) — em servidor persistente.
  // Na Vercel os estáticos são servidos pela própria plataforma.
  if (!config.isServerless) {
    app.use(express.static(config.staticRoot));
  }

  app.use("/api", (_req, res) => res.status(404).json({ error: "Rota não encontrada" }));
  app.use(errorHandler);

  return app;
}
