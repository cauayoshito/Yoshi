import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { wrap } from "../middleware/error.js";
import * as sports from "../services/sports.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const one = async (sql, params = []) => {
  const { rows } = await pool.query(sql, params);
  return Number(Object.values(rows[0])[0]) || 0;
};

/** Visão geral: usuários, fluxo de caixa e GGR (receita bruta de jogo). */
adminRouter.get("/stats", wrap(async (_req, res) => {
  const [
    users, depositsCents, bonusCents, withdrawalsCents,
    casinoStakesCents, casinoPayoutsCents, sportStakesCents, sportPayoutsCents,
    pendingSportBets, balancesCents,
  ] = await Promise.all([
    one("SELECT COUNT(*) FROM users"),
    one("SELECT COALESCE(SUM(amount_cents),0) FROM transactions WHERE type='deposit'"),
    one("SELECT COALESCE(SUM(amount_cents),0) FROM transactions WHERE type='bonus'"),
    one("SELECT COALESCE(ABS(SUM(amount_cents)),0) FROM transactions WHERE type='withdraw'"),
    one("SELECT COALESCE(SUM(bet_cents),0) FROM rounds WHERE status='settled'"),
    one("SELECT COALESCE(SUM(win_cents),0) FROM rounds WHERE status='settled'"),
    one("SELECT COALESCE(SUM(stake_cents),0) FROM sport_bets WHERE status IN ('won','lost')"),
    one("SELECT COALESCE(SUM(potential_win_cents),0) FROM sport_bets WHERE status='won'"),
    one("SELECT COUNT(*) FROM sport_bets WHERE status='pending'"),
    one("SELECT COALESCE(SUM(balance_cents),0) FROM users"),
  ]);

  res.json({
    users, depositsCents, bonusCents, withdrawalsCents, balancesCents, pendingSportBets,
    ggrCents: casinoStakesCents - casinoPayoutsCents + sportStakesCents - sportPayoutsCents,
    casino: { stakesCents: casinoStakesCents, payoutsCents: casinoPayoutsCents },
    sports: { stakesCents: sportStakesCents, payoutsCents: sportPayoutsCents },
  });
}));

adminRouter.get("/users", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.balance_cents, u.created_at,
            (SELECT COALESCE(SUM(amount_cents),0) FROM transactions t WHERE t.user_id = u.id AND t.type='deposit') AS deposited_cents,
            (SELECT COUNT(*) FROM rounds r WHERE r.user_id = u.id) AS rounds_count,
            (SELECT COUNT(*) FROM sport_bets s WHERE s.user_id = u.id) AS sport_bets_count
     FROM users u ORDER BY u.id DESC LIMIT 100`
  );
  res.json({ users: rows });
}));

adminRouter.get("/activity", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.type, t.amount_cents, t.meta, t.created_at, u.name AS user_name
     FROM transactions t JOIN users u ON u.id = t.user_id
     ORDER BY t.id DESC LIMIT 40`
  );
  res.json({ transactions: rows });
}));

adminRouter.get("/matches", wrap(async (_req, res) => {
  const { rows: bets } = await pool.query(
    "SELECT match_id, COUNT(*) AS bets, COALESCE(SUM(stake_cents),0) AS staked_cents FROM sport_bets GROUP BY match_id"
  );
  const byMatch = Object.fromEntries(bets.map((b) => [b.match_id, b]));
  const matches = await sports.listMatches();
  res.json({
    matches: matches.map((m) => ({
      ...m,
      bets: Number(byMatch[m.id]?.bets || 0),
      stakedCents: Number(byMatch[m.id]?.staked_cents || 0),
    })),
  });
}));

/** Registra o placar manualmente e liquida as apostas da partida. */
adminRouter.post("/matches/:id/result", wrap(async (req, res) => {
  const homeScore = Math.round(Number(req.body?.homeScore));
  const awayScore = Math.round(Number(req.body?.awayScore));
  res.json(await sports.setResult(req.params.id, homeScore, awayScore, "admin"));
}));

/** Dispara a liquidação automática das partidas encerradas. */
adminRouter.post("/settle", wrap(async (_req, res) => {
  res.json({ settled: await sports.settleFinishedMatches() });
}));

/**
 * Série diária para os gráficos do dashboard.
 * ?days=7|14|30 (padrão 14) — sempre devolve todos os dias, zerando os vazios.
 */
adminRouter.get("/timeseries", wrap(async (req, res) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 14));

  const { rows } = await pool.query(
    `WITH dates AS (
       SELECT generate_series(current_date - ($1::int - 1), current_date, interval '1 day')::date AS d
     ),
     tx AS (
       SELECT created_at::date AS d,
              SUM(CASE WHEN type='deposit' THEN amount_cents ELSE 0 END) AS deposits,
              SUM(CASE WHEN type='withdraw' THEN -amount_cents ELSE 0 END) AS withdrawals
       FROM transactions WHERE created_at::date >= current_date - ($1::int - 1)
       GROUP BY 1
     ),
     casino AS (
       SELECT created_at::date AS d, SUM(bet_cents) AS stake, SUM(win_cents) AS payout, COUNT(*) AS n
       FROM rounds WHERE status='settled' AND created_at::date >= current_date - ($1::int - 1)
       GROUP BY 1
     ),
     sport AS (
       SELECT created_at::date AS d,
              SUM(stake_cents) AS stake,
              SUM(CASE WHEN status='won' THEN potential_win_cents ELSE 0 END) AS payout,
              COUNT(*) AS n
       FROM sport_bets WHERE created_at::date >= current_date - ($1::int - 1)
       GROUP BY 1
     ),
     newu AS (
       SELECT created_at::date AS d, COUNT(*) AS n
       FROM users WHERE created_at::date >= current_date - ($1::int - 1)
       GROUP BY 1
     )
     SELECT to_char(dates.d, 'YYYY-MM-DD') AS date,
            COALESCE(tx.deposits, 0)      AS deposits_cents,
            COALESCE(tx.withdrawals, 0)   AS withdrawals_cents,
            COALESCE(casino.stake, 0)     AS casino_stake_cents,
            COALESCE(casino.payout, 0)    AS casino_payout_cents,
            COALESCE(casino.n, 0)         AS casino_rounds,
            COALESCE(sport.stake, 0)      AS sport_stake_cents,
            COALESCE(sport.payout, 0)     AS sport_payout_cents,
            COALESCE(sport.n, 0)          AS sport_bets,
            COALESCE(newu.n, 0)           AS new_users
     FROM dates
     LEFT JOIN tx ON tx.d = dates.d
     LEFT JOIN casino ON casino.d = dates.d
     LEFT JOIN sport ON sport.d = dates.d
     LEFT JOIN newu ON newu.d = dates.d
     ORDER BY dates.d`,
    [days]
  );

  const series = rows.map((r) => ({
    date: r.date,
    depositsCents: r.deposits_cents,
    withdrawalsCents: r.withdrawals_cents,
    casinoStakeCents: r.casino_stake_cents,
    casinoPayoutCents: r.casino_payout_cents,
    casinoRounds: r.casino_rounds,
    sportStakeCents: r.sport_stake_cents,
    sportPayoutCents: r.sport_payout_cents,
    sportBets: r.sport_bets,
    newUsers: r.new_users,
    ggrCents: r.casino_stake_cents - r.casino_payout_cents + r.sport_stake_cents - r.sport_payout_cents,
  }));
  res.json({ days, series });
}));

/** Volume e GGR por produto (Fortune Yoshi, Mines, Esportes). */
adminRouter.get("/products", wrap(async (_req, res) => {
  const { rows: casino } = await pool.query(
    `SELECT game, COALESCE(SUM(bet_cents),0) AS stake, COALESCE(SUM(win_cents),0) AS payout, COUNT(*) AS n
     FROM rounds WHERE status='settled' GROUP BY game`
  );
  const { rows: sportRows } = await pool.query(
    `SELECT COALESCE(SUM(stake_cents),0) AS stake,
            COALESCE(SUM(CASE WHEN status='won' THEN potential_win_cents ELSE 0 END),0) AS payout,
            COUNT(*) AS n
     FROM sport_bets`
  );

  const products = {};
  for (const c of casino) {
    products[c.game] = { stakeCents: c.stake, payoutCents: c.payout, count: Number(c.n) };
  }
  const sport = sportRows[0];
  products.sports = { stakeCents: sport.stake, payoutCents: sport.payout, count: Number(sport.n) };
  res.json({ products });
}));

/** Top jogadores por depósito e por resultado para a casa. */
adminRouter.get("/top-players", wrap(async (_req, res) => {
  const { rows: byDeposits } = await pool.query(
    `SELECT u.id, u.name, SUM(t.amount_cents) AS total_cents
     FROM transactions t JOIN users u ON u.id = t.user_id
     WHERE t.type='deposit' GROUP BY u.id, u.name ORDER BY total_cents DESC LIMIT 5`
  );
  const { rows: byHouseProfit } = await pool.query(
    `SELECT u.id, u.name, COALESCE(-SUM(t.amount_cents), 0) AS profit_cents
     FROM transactions t JOIN users u ON u.id = t.user_id
     WHERE t.type IN ('bet','win') GROUP BY u.id, u.name ORDER BY profit_cents DESC LIMIT 5`
  );
  res.json({ byDeposits, byHouseProfit });
}));
