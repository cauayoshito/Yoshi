import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { wrap } from "../middleware/error.js";
import * as slot from "../services/slot.js";
import * as mines from "../services/mines.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "games.json"), "utf8"));

export const gamesRouter = Router();

/** Catálogo público de jogos. */
gamesRouter.get("/", (_req, res) => res.json({ games: catalog }));

gamesRouter.use(requireAuth);

/* ---- Fortune Yoshi (slot) ---- */
gamesRouter.post("/slot/spin", wrap((req, res) => {
  const betCents = Math.round(Number(req.body?.betCents));
  res.json(slot.spin(req.user.id, betCents));
}));

/* ---- Mines ---- */
gamesRouter.get("/mines/active", wrap((req, res) => {
  res.json({ round: mines.activeRound(req.user.id) });
}));

gamesRouter.post("/mines/start", wrap((req, res) => {
  const betCents = Math.round(Number(req.body?.betCents));
  res.status(201).json(mines.start(req.user.id, betCents));
}));

gamesRouter.post("/mines/reveal", wrap((req, res) => {
  res.json(mines.reveal(req.user.id, Math.round(Number(req.body?.cell))));
}));

gamesRouter.post("/mines/cashout", wrap((req, res) => {
  res.json(mines.cashout(req.user.id));
}));

/* ---- Histórico de rodadas ---- */
gamesRouter.get("/history", wrap((req, res) => {
  const rounds = db
    .prepare(
      `SELECT id, game, bet_cents, win_cents, status, created_at
       FROM rounds WHERE user_id = ? AND status = 'settled'
       ORDER BY id DESC LIMIT 30`
    )
    .all(req.user.id);
  res.json({ rounds });
}));
