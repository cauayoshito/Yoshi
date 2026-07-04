import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  return MATCHES.map((m) => ({ ...m, status: matchStatus(m, now) }));
}

export function getMatch(matchId) {
  return MATCHES.find((m) => m.id === matchId) || null;
}

export function placeBet(userId, matchId, pick, stakeCents) {
  const match = getMatch(matchId);
  if (!match) throw new ApiError(404, "Partida não encontrada");
  if (!PICKS.includes(pick)) throw new ApiError(400, "Escolha inválida (home, draw ou away)");
  if (matchStatus(match) === "finished") throw new ApiError(400, "Mercado encerrado para esta partida");
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
