import { Router } from "express";
import { pool } from "../db.js";
import { wrap } from "../middleware/error.js";

export const statsRouter = Router();

/** Mascarar nome: "Lucas Silva" → "Lu***" */
const maskSQL = `LEFT(u.name, 2) || '***'`;

/** Jackpot progressivo (público). */
statsRouter.get("/jackpot", wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT amount_cents, updated_at FROM jackpot WHERE id = 1");
  res.json({ amountCents: rows[0]?.amount_cents ?? 0 });
}));

/** Últimos ganhos REAIS (engine + cassino legado + esportes), mascarados. */
statsRouter.get("/live-wins", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `(
      SELECT ${maskSQL} AS player, 'Yoshi Fortune' AS game, '🐲' AS emoji,
             r.bet_cents, r.payout_cents,
             (r.result->>'totalMultiplier')::numeric AS multiplier, r.created_at
      FROM slot_rounds r JOIN users u ON u.id = r.user_id
      WHERE r.payout_cents > 0
      ORDER BY r.id DESC LIMIT 15
    )
    UNION ALL
    (
      SELECT ${maskSQL}, CASE r.game WHEN 'mines' THEN 'Mines' ELSE 'Slot' END, '💣',
             r.bet_cents, r.win_cents,
             CASE WHEN r.bet_cents > 0 THEN ROUND(r.win_cents::numeric / r.bet_cents, 2) ELSE 0 END,
             r.created_at
      FROM rounds r JOIN users u ON u.id = r.user_id
      WHERE r.status = 'settled' AND r.win_cents > 0
      ORDER BY r.id DESC LIMIT 10
    )
    UNION ALL
    (
      SELECT ${maskSQL}, 'Copa 2026', '⚽',
             b.stake_cents, b.potential_win_cents, b.odds, b.settled_at
      FROM sport_bets b JOIN users u ON u.id = b.user_id
      WHERE b.status = 'won'
      ORDER BY b.id DESC LIMIT 10
    )
    ORDER BY created_at DESC LIMIT 20`
  );
  res.json({ wins: rows });
}));

/** Corrida diária: top 10 por volume apostado hoje (todas as verticais). */
statsRouter.get("/race", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ${maskSQL} AS player, SUM(-t.amount_cents) AS wagered_cents
     FROM transactions t JOIN users u ON u.id = t.user_id
     WHERE t.type = 'bet' AND t.created_at::date = current_date
     GROUP BY u.id, u.name
     ORDER BY wagered_cents DESC LIMIT 10`
  );
  res.json({
    prizePoolCents: 100000, // R$ 1.000 (demo)
    prizes: [50000, 25000, 10000, 5000, 5000, 2500, 2500, 0, 0, 0],
    ranking: rows,
  });
}));
