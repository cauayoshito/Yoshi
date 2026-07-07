import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { wrap } from "../middleware/error.js";
import * as sports from "../services/sports.js";
import * as slots from "../services/slots.js";

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

/* ============ SLOTS ENGINE (Bloco 4 — backoffice) ============ */

/** RTP real acumulado vs configurado, volume, GGR e sessões ativas por jogo. */
adminRouter.get("/slots/overview", wrap(async (_req, res) => {
  res.json({ games: await slots.gamesOverview() });
}));

/** Publica nova versão da GameConfig sem deploy (validada pela engine). */
adminRouter.put("/slots/games/:id/config", wrap(async (req, res) => {
  res.json(await slots.updateGameConfig(req.params.id, req.body?.config, req.user.email));
}));

/** Histórico de versões: quem alterou o quê e quando. */
adminRouter.get("/slots/games/:id/versions", wrap(async (req, res) => {
  res.json({ versions: await slots.listGameVersions(req.params.id) });
}));

/** Ativa/desativa o jogo. */
adminRouter.post("/slots/games/:id/toggle", wrap(async (req, res) => {
  res.json(await slots.toggleGame(req.params.id, req.body?.active, req.user.email));
}));

/** Log de auditoria de rodadas (todas as contas). */
adminRouter.get("/slots/rounds", wrap(async (req, res) => {
  res.json({
    rounds: await slots.auditRounds({
      gameId: req.query.gameId || null,
      limit: Number(req.query.limit) || 50,
    }),
  });
}));

/** Snapshots históricos de RTP + snapshot sob demanda. */
adminRouter.get("/slots/rtp-log", wrap(async (_req, res) => {
  res.json({ log: await slots.listRtpLog() });
}));
adminRouter.post("/slots/rtp-snapshot", wrap(async (_req, res) => {
  res.json({ snapshots: await slots.snapshotRtp("admin") });
}));

/* ============ EXPORTAÇÃO CSV (relatórios regulatórios) ============ */

/** Escapa um campo para CSV (RFC 4180). */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(columns, rows) {
  const head = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows
    .map((r) => columns.map((c) => csvCell(r[c.key])).join(","))
    .join("\r\n");
  // BOM p/ Excel abrir acentuação corretamente
  return "﻿" + head + "\r\n" + body + "\r\n";
}

/** Faixa de datas opcional ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive). */
function dateRange(req) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : null;
  return { from, to };
}

/**
 * Relatórios regulatórios em CSV (PAGCOR/auditoria).
 * GET /api/admin/export/:report.csv?from=&to=
 * report ∈ transactions | rounds | sport-bets | users | ggr-daily
 */
adminRouter.get("/export/:report.csv", wrap(async (req, res) => {
  const { from, to } = dateRange(req);
  const clause = [];
  const params = [];
  if (from) { params.push(from); clause.push(`created_at::date >= $${params.length}`); }
  if (to) { params.push(to); clause.push(`created_at::date <= $${params.length}`); }
  const where = clause.length ? "WHERE " + clause.join(" AND ") : "";

  let columns, rows, file;

  switch (req.params.report) {
    case "transactions": {
      const q = await pool.query(
        `SELECT t.id, t.created_at, u.id AS user_id, u.name, u.email,
                t.type, t.amount_cents, t.meta
         FROM transactions t JOIN users u ON u.id = t.user_id
         ${where ? where.replace(/created_at/g, "t.created_at") : ""}
         ORDER BY t.id`, params);
      columns = [
        { key: "id", label: "tx_id" }, { key: "created_at", label: "timestamp_utc" },
        { key: "user_id", label: "user_id" }, { key: "name", label: "user_name" },
        { key: "email", label: "user_email" }, { key: "type", label: "type" },
        { key: "amount_cents", label: "amount_cents" }, { key: "meta", label: "meta" },
      ];
      rows = q.rows.map((r) => ({ ...r, meta: r.meta ? JSON.stringify(r.meta) : "" }));
      file = "transactions";
      break;
    }
    case "rounds": {
      // Trilha provably-fair completa (engine): join com fair_seeds p/ hash e seeds.
      const q = await pool.query(
        `SELECT sr.id, sr.created_at, sr.user_id, sr.game_id, sr.game_version,
                sr.bet_cents, sr.payout_cents, sr.is_free_spin, sr.nonce,
                fs.server_seed_hash, fs.client_seed
         FROM slot_rounds sr JOIN fair_seeds fs ON fs.id = sr.fair_seed_id
         ${where ? where.replace(/created_at/g, "sr.created_at") : ""}
         ORDER BY sr.id`, params);
      columns = [
        { key: "id", label: "round_id" }, { key: "created_at", label: "timestamp_utc" },
        { key: "user_id", label: "user_id" }, { key: "game_id", label: "game_id" },
        { key: "game_version", label: "game_version" },
        { key: "bet_cents", label: "bet_cents" }, { key: "payout_cents", label: "payout_cents" },
        { key: "is_free_spin", label: "is_free_spin" }, { key: "nonce", label: "nonce" },
        { key: "server_seed_hash", label: "server_seed_hash" },
        { key: "client_seed", label: "client_seed" },
      ];
      rows = q.rows;
      file = "rounds";
      break;
    }
    case "sport-bets": {
      const q = await pool.query(
        `SELECT s.id, s.created_at, s.user_id, s.match_id, s.pick, s.odds,
                s.stake_cents, s.potential_win_cents, s.status
         FROM sport_bets s
         ${where ? where.replace(/created_at/g, "s.created_at") : ""}
         ORDER BY s.id`, params);
      columns = [
        { key: "id", label: "bet_id" }, { key: "created_at", label: "timestamp_utc" },
        { key: "user_id", label: "user_id" }, { key: "match_id", label: "match_id" },
        { key: "pick", label: "pick" }, { key: "odds", label: "odds" },
        { key: "stake_cents", label: "stake_cents" },
        { key: "potential_win_cents", label: "potential_win_cents" },
        { key: "status", label: "status" },
      ];
      rows = q.rows;
      file = "sport-bets";
      break;
    }
    case "users": {
      const q = await pool.query(
        `SELECT u.id, u.created_at, u.name, u.email, u.role, u.balance_cents,
                (SELECT COALESCE(SUM(amount_cents),0) FROM transactions t
                   WHERE t.user_id = u.id AND t.type='deposit') AS deposited_cents,
                EXISTS (SELECT 1 FROM responsible_limits rl
                   WHERE rl.user_id = u.id
                     AND (rl.excluded_permanent OR rl.excluded_until IS NOT NULL)) AS self_excluded
         FROM users u
         ${where ? where.replace(/created_at/g, "u.created_at") : ""}
         ORDER BY u.id`, params);
      columns = [
        { key: "id", label: "user_id" }, { key: "created_at", label: "registered_utc" },
        { key: "name", label: "name" }, { key: "email", label: "email" },
        { key: "role", label: "role" }, { key: "balance_cents", label: "balance_cents" },
        { key: "deposited_cents", label: "deposited_cents" },
        { key: "self_excluded", label: "self_excluded" },
      ];
      rows = q.rows;
      file = "users";
      break;
    }
    case "ggr-daily": {
      const q = await pool.query(
        `WITH casino AS (
           SELECT created_at::date AS d, SUM(bet_cents) AS stake, SUM(win_cents) AS payout
           FROM rounds WHERE status='settled' ${from ? "AND created_at::date >= $1" : ""} ${to ? `AND created_at::date <= $${from ? 2 : 1}` : ""}
           GROUP BY 1),
         sport AS (
           SELECT created_at::date AS d, SUM(stake_cents) AS stake,
                  SUM(CASE WHEN status='won' THEN potential_win_cents ELSE 0 END) AS payout
           FROM sport_bets ${from ? "WHERE created_at::date >= $1" : ""} ${to ? `${from ? "AND" : "WHERE"} created_at::date <= $${from ? 2 : 1}` : ""}
           GROUP BY 1)
         SELECT COALESCE(casino.d, sport.d) AS d,
                COALESCE(casino.stake,0) AS casino_stake, COALESCE(casino.payout,0) AS casino_payout,
                COALESCE(sport.stake,0) AS sport_stake, COALESCE(sport.payout,0) AS sport_payout
         FROM casino FULL OUTER JOIN sport ON casino.d = sport.d
         ORDER BY d`, params);
      columns = [
        { key: "d", label: "date" },
        { key: "casino_stake", label: "casino_stake_cents" },
        { key: "casino_payout", label: "casino_payout_cents" },
        { key: "sport_stake", label: "sport_stake_cents" },
        { key: "sport_payout", label: "sport_payout_cents" },
        { key: "ggr_cents", label: "ggr_cents" },
      ];
      rows = q.rows.map((r) => ({
        ...r,
        d: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : r.d,
        ggr_cents: Number(r.casino_stake) - Number(r.casino_payout)
          + Number(r.sport_stake) - Number(r.sport_payout),
      }));
      file = "ggr-daily";
      break;
    }
    default:
      return res.status(404).json({ error: "Relatório desconhecido" });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="yoshibet-${file}-${stamp}.csv"`);
  res.send(toCsv(columns, rows));
}));
