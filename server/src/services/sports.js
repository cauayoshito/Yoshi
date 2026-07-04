import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { db } from "../db.js";
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

export function listMatches() {
  const now = Date.now();
  return MATCHES.map((m) => ({
    ...m,
    status: matchStatus(m, now),
    result: getResult(m.id) || null,
  }));
}

function getResult(matchId) {
  return db.prepare("SELECT * FROM match_results WHERE match_id = ?").get(matchId);
}

export function getMatch(matchId) {
  return MATCHES.find((m) => m.id === matchId) || null;
}

export function placeBet(userId, matchId, pick, stakeCents) {
  const match = getMatch(matchId);
  if (!match) throw new ApiError(404, "Partida não encontrada");
  if (!PICKS.includes(pick)) throw new ApiError(400, "Escolha inválida (home, draw ou away)");
  if (matchStatus(match) === "finished" || getResult(matchId)) {
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

  let betId, balanceCents;
  db.transaction(() => {
    balanceCents = applyEntries(userId, [
      { type: "bet", amountCents: -stakeCents, meta: { sport: true, matchId, pick } },
    ]);
    const info = db
      .prepare(
        `INSERT INTO sport_bets (user_id, match_id, pick, odds, stake_cents, potential_win_cents)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(userId, matchId, pick, odds, stakeCents, potentialWinCents);
    betId = info.lastInsertRowid;
  })();

  return {
    bet: getBet(userId, betId),
    balanceCents,
  };
}

function getBet(userId, betId) {
  return decorate(
    db.prepare("SELECT * FROM sport_bets WHERE id = ? AND user_id = ?").get(betId, userId)
  );
}

export function listBets(userId, limit = 20) {
  return db
    .prepare("SELECT * FROM sport_bets WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, limit)
    .map(decorate);
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
export function setResult(matchId, homeScore, awayScore, source = "admin") {
  const match = getMatch(matchId);
  if (!match) throw new ApiError(404, "Partida não encontrada");
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    throw new ApiError(400, "Placar inválido");
  }
  if (getResult(matchId)) throw new ApiError(409, "Resultado já registrado para esta partida");

  const outcome = homeScore > awayScore ? "home" : homeScore < awayScore ? "away" : "draw";

  let settled = { won: 0, lost: 0, paidCents: 0 };
  db.transaction(() => {
    db.prepare(
      "INSERT INTO match_results (match_id, home_score, away_score, outcome, source) VALUES (?, ?, ?, ?, ?)"
    ).run(matchId, homeScore, awayScore, outcome, source);

    const pending = db
      .prepare("SELECT * FROM sport_bets WHERE match_id = ? AND status = 'pending'")
      .all(matchId);

    for (const bet of pending) {
      const won = bet.pick === outcome;
      db.prepare(
        "UPDATE sport_bets SET status = ?, settled_at = datetime('now') WHERE id = ?"
      ).run(won ? "won" : "lost", bet.id);
      if (won) {
        applyEntries(bet.user_id, [
          {
            type: "win",
            amountCents: bet.potential_win_cents,
            meta: { sport: true, matchId, betId: bet.id },
          },
        ]);
        settled.won++;
        settled.paidCents += bet.potential_win_cents;
      } else {
        settled.lost++;
      }
    }
  })();

  return { matchId, homeScore, awayScore, outcome, ...settled };
}

/**
 * Cron de liquidação: partidas encerradas sem resultado ganham um placar
 * demo determinístico (seed = id da partida) e são liquidadas.
 * Em produção, substitua por um feed esportivo (ex.: API-Football).
 */
export function settleFinishedMatches() {
  const settledNow = [];
  for (const m of MATCHES) {
    if (matchStatus(m) !== "finished") continue;
    if (getResult(m.id)) continue;
    const seed = crypto.createHash("sha256").update(m.id).digest();
    const homeScore = seed[0] % 4;
    const awayScore = seed[1] % 4;
    settledNow.push(setResult(m.id, homeScore, awayScore, "auto"));
  }
  return settledNow;
}
