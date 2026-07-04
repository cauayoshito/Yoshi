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

/**
 * Série diária para os gráficos do dashboard.
 * ?days=7|14|30 (padrão 14) — sempre devolve todos os dias, zerando os vazios.
 */
adminRouter.get("/timeseries", wrap((req, res) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 14));
  const since = `-${days - 1} days`;

  const txRows = db.prepare(
    `SELECT date(created_at) AS d, type, SUM(amount_cents) AS total
     FROM transactions WHERE date(created_at) >= date('now', ?)
     GROUP BY d, type`
  ).all(since);

  const roundRows = db.prepare(
    `SELECT date(created_at) AS d, SUM(bet_cents) AS stake, SUM(win_cents) AS payout, COUNT(*) AS n
     FROM rounds WHERE status='settled' AND date(created_at) >= date('now', ?)
     GROUP BY d`
  ).all(since);

  const sportRows = db.prepare(
    `SELECT date(created_at) AS d,
            SUM(stake_cents) AS stake,
            SUM(CASE WHEN status='won' THEN potential_win_cents ELSE 0 END) AS payout,
            COUNT(*) AS n
     FROM sport_bets WHERE date(created_at) >= date('now', ?)
     GROUP BY d`
  ).all(since);

  const userRows = db.prepare(
    `SELECT date(created_at) AS d, COUNT(*) AS n
     FROM users WHERE date(created_at) >= date('now', ?)
     GROUP BY d`
  ).all(since);

  const map = {};
  const dayList = db.prepare(
    `WITH RECURSIVE dates(d) AS (
       SELECT date('now', ?) UNION ALL SELECT date(d, '+1 day') FROM dates WHERE d < date('now')
     ) SELECT d FROM dates`
  ).all(since);
  for (const { d } of dayList) {
    map[d] = {
      date: d, depositsCents: 0, withdrawalsCents: 0,
      casinoStakeCents: 0, casinoPayoutCents: 0, casinoRounds: 0,
      sportStakeCents: 0, sportPayoutCents: 0, sportBets: 0, newUsers: 0,
    };
  }
  for (const r of txRows) {
    if (!map[r.d]) continue;
    if (r.type === "deposit") map[r.d].depositsCents = r.total;
    if (r.type === "withdraw") map[r.d].withdrawalsCents = Math.abs(r.total);
  }
  for (const r of roundRows) {
    if (!map[r.d]) continue;
    Object.assign(map[r.d], { casinoStakeCents: r.stake, casinoPayoutCents: r.payout, casinoRounds: r.n });
  }
  for (const r of sportRows) {
    if (!map[r.d]) continue;
    Object.assign(map[r.d], { sportStakeCents: r.stake, sportPayoutCents: r.payout, sportBets: r.n });
  }
  for (const r of userRows) {
    if (map[r.d]) map[r.d].newUsers = r.n;
  }

  const series = Object.values(map).map((row) => ({
    ...row,
    ggrCents: row.casinoStakeCents - row.casinoPayoutCents + row.sportStakeCents - row.sportPayoutCents,
  }));
  res.json({ days, series });
}));

/** Volume e GGR por produto (Fortune Yoshi, Mines, Esportes). */
adminRouter.get("/products", wrap((_req, res) => {
  const casino = db.prepare(
    `SELECT game, SUM(bet_cents) AS stake, SUM(win_cents) AS payout, COUNT(*) AS n
     FROM rounds WHERE status='settled' GROUP BY game`
  ).all();
  const sport = db.prepare(
    `SELECT SUM(stake_cents) AS stake,
            SUM(CASE WHEN status='won' THEN potential_win_cents ELSE 0 END) AS payout,
            COUNT(*) AS n
     FROM sport_bets`
  ).get();

  const products = {};
  for (const c of casino) {
    products[c.game] = { stakeCents: c.stake || 0, payoutCents: c.payout || 0, count: c.n };
  }
  products.sports = { stakeCents: sport.stake || 0, payoutCents: sport.payout || 0, count: sport.n || 0 };
  res.json({ products });
}));

/** Top jogadores por depósito e por resultado para a casa. */
adminRouter.get("/top-players", wrap((_req, res) => {
  const byDeposits = db.prepare(
    `SELECT u.id, u.name, SUM(t.amount_cents) AS total_cents
     FROM transactions t JOIN users u ON u.id = t.user_id
     WHERE t.type='deposit' GROUP BY u.id ORDER BY total_cents DESC LIMIT 5`
  ).all();
  const byHouseProfit = db.prepare(
    `SELECT u.id, u.name,
            COALESCE(SUM(CASE WHEN t.type='bet' THEN -t.amount_cents WHEN t.type='win' THEN -t.amount_cents ELSE 0 END), 0) AS profit_cents
     FROM transactions t JOIN users u ON u.id = t.user_id
     WHERE t.type IN ('bet','win') GROUP BY u.id ORDER BY profit_cents DESC LIMIT 5`
  ).all();
  res.json({ byDeposits, byHouseProfit });
}));
