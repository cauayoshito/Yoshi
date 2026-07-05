import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { pool, withTx } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../middleware/error.js";
import { applyEntries } from "./wallet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATCHES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "matches.json"), "utf8")
);

const PICKS = ["home", "draw", "away"];
const MATCH_DURATION_MS = 2 * 60 * 60 * 1000;

/** Status calculado pelo relógio do servidor: upcoming | live | finished */
function matchStatus(m, now = Date.now()) {
  const ko = Date.parse(m.kickoff);
  if (now < ko) return "upcoming";
  if (now < ko + MATCH_DURATION_MS) return "live";
  return "finished";
}

async function getResult(matchId, client = pool) {
  const { rows } = await client.query("SELECT * FROM match_results WHERE match_id = $1", [matchId]);
  return rows[0] || null;
}

export async function listMatches() {
  const now = Date.now();
  const { rows: results } = await pool.query("SELECT * FROM match_results");
  const byId = Object.fromEntries(results.map((r) => [r.match_id, r]));
  return MATCHES.map((m) => ({
    ...m,
    status: matchStatus(m, now),
    result: byId[m.id] || null,
  }));
}

export function getMatch(matchId) {
  return MATCHES.find((m) => m.id === matchId) || null;
}

export async function placeBet(userId, matchId, pick, stakeCents) {
  const match = getMatch(matchId);
  if (!match) throw new ApiError(404, "Partida não encontrada");
  if (!PICKS.includes(pick)) throw new ApiError(400, "Escolha inválida (home, draw ou away)");
  if (matchStatus(match) === "finished" || (await getResult(matchId))) {
    throw new ApiError(400, "Mercado encerrado para esta partida");
  }
  if (
    !Number.isInteger(stakeCents) ||
    stakeCents < config.limits.minBetCents ||
    stakeCents > config.limits.maxBetCents * 10
  ) {
    throw new ApiError(
      400,
      `Aposta deve ser entre R$ ${(config.limits.minBetCents / 100).toFixed(2)} e R$ ${((config.limits.maxBetCents * 10) / 100).toFixed(2)}`
    );
  }

  // As odds valem as do servidor no momento da aposta — nunca as do cliente
  const odds = match.odds[pick];
  const potentialWinCents = Math.floor(stakeCents * odds);

  return withTx(async (client) => {
    const balanceCents = await applyEntries(
      userId,
      [{ type: "bet", amountCents: -stakeCents, meta: { sport: true, matchId, pick } }],
      client
    );
    const { rows } = await client.query(
      `INSERT INTO sport_bets (user_id, match_id, pick, odds, stake_cents, potential_win_cents)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, matchId, pick, odds, stakeCents, potentialWinCents]
    );
    return { bet: decorate(rows[0]), balanceCents };
  });
}

export async function listBets(userId, limit = 20) {
  const { rows } = await pool.query(
    "SELECT * FROM sport_bets WHERE user_id = $1 ORDER BY id DESC LIMIT $2",
    [userId, limit]
  );
  return rows.map(decorate);
}

function decorate(bet) {
  if (!bet) return bet;
  const match = getMatch(bet.match_id);
  const pickLabel =
    bet.pick === "draw" ? "Empate" : match ? match[bet.pick].name : bet.pick;
  return { ...bet, match, pickLabel };
}

/* ============ RESULTADOS E LIQUIDAÇÃO ============ */

/**
 * Registra o resultado e liquida TODAS as apostas pendentes da partida
 * em uma única transação: vencedores recebem o retorno potencial no
 * livro-razão; perdedores são marcados como 'lost'. Idempotente.
 */
export async function setResult(matchId, homeScore, awayScore, source = "admin") {
  const match = getMatch(matchId);
  if (!match) throw new ApiError(404, "Partida não encontrada");
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    throw new ApiError(400, "Placar inválido");
  }

  const outcome = homeScore > awayScore ? "home" : homeScore < awayScore ? "away" : "draw";

  return withTx(async (client) => {
    // INSERT com PK garante idempotência mesmo em corrida
    try {
      await client.query(
        "INSERT INTO match_results (match_id, home_score, away_score, outcome, source) VALUES ($1, $2, $3, $4, $5)",
        [matchId, homeScore, awayScore, outcome, source]
      );
    } catch (err) {
      if (err.code === "23505") throw new ApiError(409, "Resultado já registrado para esta partida");
      throw err;
    }

    const { rows: pending } = await client.query(
      "SELECT * FROM sport_bets WHERE match_id = $1 AND status = 'pending' FOR UPDATE",
      [matchId]
    );

    const settled = { won: 0, lost: 0, paidCents: 0 };
    for (const bet of pending) {
      const won = bet.pick === outcome;
      await client.query("UPDATE sport_bets SET status = $1, settled_at = now() WHERE id = $2", [
        won ? "won" : "lost",
        bet.id,
      ]);
      if (won) {
        await applyEntries(
          bet.user_id,
          [{ type: "win", amountCents: bet.potential_win_cents, meta: { sport: true, matchId, betId: bet.id } }],
          client
        );
        settled.won++;
        settled.paidCents += bet.potential_win_cents;
      } else {
        settled.lost++;
      }
    }

    return { matchId, homeScore, awayScore, outcome, ...settled };
  });
}

/**
 * Cron de liquidação: partidas encerradas sem resultado ganham um placar
 * demo determinístico (seed = id da partida) e são liquidadas.
 * Em produção, substitua por um feed esportivo (ex.: API-Football).
 */
export async function settleFinishedMatches() {
  const settledNow = [];
  for (const m of MATCHES) {
    if (matchStatus(m) !== "finished") continue;
    if (await getResult(m.id)) continue;
    const seed = crypto.createHash("sha256").update(m.id).digest();
    const homeScore = seed[0] % 4;
    const awayScore = seed[1] % 4;
    try {
      settledNow.push(await setResult(m.id, homeScore, awayScore, "auto"));
    } catch (err) {
      if (err.status !== 409) throw err; // 409 = outro processo liquidou antes
    }
  }
  return settledNow;
}
