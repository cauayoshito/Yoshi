import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { wrap } from "../middleware/error.js";
import * as rg from "../services/responsible.js";

export const responsibleRouter = Router();
responsibleRouter.use(requireAuth);

/** Limites atuais do jogador (jogo responsável). */
responsibleRouter.get("/", wrap(async (req, res) => {
  res.json(await rg.getLimits(req.user.id));
}));

/** Define limites de depósito/perda e reality-check. */
responsibleRouter.put("/limits", wrap(async (req, res) => {
  res.json(await rg.setLimits(req.user.id, req.body || {}));
}));

/** Autoexclusão: { permanent:true } ou { days:N }. */
responsibleRouter.post("/self-exclude", wrap(async (req, res) => {
  const permanent = req.body?.permanent === true;
  const days = req.body?.days;
  res.json(await rg.selfExclude(req.user.id, { permanent, days }));
}));
