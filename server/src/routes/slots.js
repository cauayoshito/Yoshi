import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { wrap } from "../middleware/error.js";
import * as slots from "../services/slots.js";

export const slotsRouter = Router();

/** Catálogo público dos jogos da engine (config completa = transparência). */
slotsRouter.get("/games", wrap(async (_req, res) => {
  res.json({ games: await slots.listGames() });
}));

/**
 * Verificação pública de rodada — não exige login (Bloco 2, item 4).
 * Auditoria independente: hash + seeds + nonce + config + resultado.
 */
slotsRouter.get("/verify/:roundId", wrap(async (req, res) => {
  res.json(await slots.verifyRound(Math.round(Number(req.params.roundId))));
}));

slotsRouter.use(requireAuth);

/** Spin server-side: RNG e resolução acontecem aqui, nunca no cliente. */
slotsRouter.post("/:gameId/spin", wrap(async (req, res) => {
  res.json(await slots.spin(req.user.id, req.params.gameId, req.body?.betCents));
}));

/** Histórico das minhas rodadas na engine. */
slotsRouter.get("/rounds", wrap(async (req, res) => {
  res.json({ rounds: await slots.listRounds(req.user.id) });
}));

/* ============ Provably fair: gestão de seeds ============ */

export const fairRouter = Router();
fairRouter.use(requireAuth);

/** Par ativo: hash do server seed (compromisso), client seed e nonce atual. */
fairRouter.get("/seeds", wrap(async (req, res) => {
  res.json(await slots.getSeeds(req.user.id));
}));

/** Rotaciona: revela o server seed antigo e cria novo compromisso. */
fairRouter.post("/rotate", wrap(async (req, res) => {
  res.json(await slots.rotateSeeds(req.user.id, req.body?.clientSeed));
}));
