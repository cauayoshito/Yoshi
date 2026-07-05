import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { wrap } from "../middleware/error.js";
import * as sports from "../services/sports.js";

export const sportsRouter = Router();

/** Partidas com odds e status calculado pelo servidor. Público. */
sportsRouter.get("/matches", wrap(async (_req, res) => {
  res.json({ matches: await sports.listMatches() });
}));

sportsRouter.use(requireAuth);

/** Registra a aposta debitando a carteira. Odds sempre do servidor. */
sportsRouter.post("/bet", wrap(async (req, res) => {
  const { matchId, pick } = req.body || {};
  const stakeCents = Math.round(Number(req.body?.stakeCents));
  res.status(201).json(
    await sports.placeBet(req.user.id, String(matchId || ""), String(pick || ""), stakeCents)
  );
}));

sportsRouter.get("/bets", wrap(async (req, res) => {
  res.json({ bets: await sports.listBets(req.user.id) });
}));
