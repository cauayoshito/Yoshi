import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { errorHandler } from "./middleware/error.js";
import { authRouter } from "./routes/auth.js";
import { walletRouter } from "./routes/wallet.js";
import { gamesRouter } from "./routes/games.js";
import { sportsRouter } from "./routes/sports.js";

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
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan("tiny"));
  }
  app.use(cors());
  app.use(express.json({ limit: "64kb" }));

  app.use(
    "/api",
    rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false })
  );

  app.get("/api/health", (_req, res) => res.json({ ok: true, name: "yoshibet-api" }));
  app.use("/api/auth", authRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/games", gamesRouter);
  app.use("/api/sports", sportsRouter);

  // Serve o front-end estático (raiz do repositório)
  app.use(express.static(config.staticRoot));

  app.use("/api", (_req, res) => res.status(404).json({ error: "Rota não encontrada" }));
  app.use(errorHandler);

  return app;
}
