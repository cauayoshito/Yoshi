import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { wrap } from "../middleware/error.js";
import * as sports from "../services/sports.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

/** Visão geral: usuários, fluxo de caixa e GGR (receita bruta de jogo). */
adminRouter.get("/stats", wrap((_req, res) => {
  const one = (sql) => Object.values(db.prepare(sql).get())[0] || 0;

  const users = one("SELECT COUNT(*) FROM users");
  const depositsCents = one("SELECT COALESCE(SUM(amount_cents),0) FROM transactions WHERE type='deposit'");
  const bonusCents = one("SELECT COALESCE(SUM(amount_cents),0) FROM transactions WHERE type='bonus'");
  const withdrawalsCents = one("SELECT COALESCE(ABS(SUM(amount_cents)),0) FROM transactions WHERE type='withdraw'");
  const casinoStakesCents = one("SELECT COALESCE(SUM(bet_cents),0) FROM rounds WHERE status='settled'");
  const casinoPayoutsCents = one("SELECT COALESCE(SUM(win_cents),0) FROM rounds WHERE status='settled'");
  const sportStakesCents = one("SELECT COALESCE(SUM(stake_cents),0) FROM sport_bets WHERE status IN ('won','lost')");
  const sportPayoutsCents = one("SELECT COALESCE(SUM(potential_win_cents),0) FROM sport_bets WHERE status='won'");
  const pendingSportBets = one("SELECT COUNT(*) FROM sport_bets WHERE status='pending'");
  const balancesCents = one("SELECT COALESCE(SUM(balance_cents),0) FROM users");

  res.json({
    users,
    depositsCents,
    bonusCents,
    withdrawalsCents,
    balancesCents,
    pendingSportBets,
    ggrCents:
      casinoStakesCents - casinoPayoutsCents + sportStakesCents - sportPayoutsCents,
    casino: { stakesCents: casinoStakesCents, payoutsCents: casinoPayoutsCents },
    sports: { stakesCents: sportStakesCents, payoutsCents: sportPayoutsCents },
  });
}));

adminRouter.get("/users", wrap((_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.balance_cents, u.created_at,
              (SELECT COALESCE(SUM(amount_cents),0) FROM transactions t WHERE t.user_id = u.id AND t.type='deposit') AS deposited_cents,
              (SELECT COUNT(*) FROM rounds r WHERE r.user_id = u.id) AS rounds_count,
              (SELECT COUNT(*) FROM sport_bets s WHERE s.user_id = u.id) AS sport_bets_count
       FROM users u ORDER BY u.id DESC LIMIT 100`
    )
    .all();
  res.json({ users });
}));

adminRouter.get("/activity", wrap((_req, res) => {
  const transactions = db
    .prepare(
      `SELECT t.id, t.type, t.amount_cents, t.meta, t.created_at, u.name AS user_name
       FROM transactions t JOIN users u ON u.id = t.user_id
       ORDER BY t.id DESC LIMIT 40`
    )
    .all()
    .map((t) => ({ ...t, meta: t.meta ? JSON.parse(t.meta) : null }));
  res.json({ transactions });
}));

adminRouter.get("/matches", wrap((_req, res) => {
  const bets = db
    .prepare(
      "SELECT match_id, COUNT(*) AS bets, COALESCE(SUM(stake_cents),0) AS staked_cents FROM sport_bets GROUP BY match_id"
    )
    .all();
  const byMatch = Object.fromEntries(bets.map((b) => [b.match_id, b]));
  res.json({
    matches: sports.listMatches().map((m) => ({
      ...m,
      bets: byMatch[m.id]?.bets || 0,
      stakedCents: byMatch[m.id]?.staked_cents || 0,
    })),
  });
}));

/** Registra o placar manualmente e liquida as apostas da partida. */
adminRouter.post("/matches/:id/result", wrap((req, res) => {
  const homeScore = Math.round(Number(req.body?.homeScore));
  const awayScore = Math.round(Number(req.body?.awayScore));
  res.json(sports.setResult(req.params.id, homeScore, awayScore, "admin"));
}));

/** Dispara a liquidação automática das partidas encerradas. */
adminRouter.post("/settle", wrap((_req, res) => {
  res.json({ settled: sports.settleFinishedMatches() });
}));
