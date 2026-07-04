import crypto from "node:crypto";
import { db } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../middleware/error.js";
import { applyEntries, getBalance } from "./wallet.js";

/**
 * Mines 5x5 com 4 bombas. As posições das bombas SÓ existem no servidor —
 * o cliente nunca as recebe antes do fim da rodada (provably fair:
 * o hash do server seed é entregue no início e o seed no fim).
 */
const SIZE = 25;
const BOMBS = 4;
const HOUSE_EDGE = 0.97;

function multiplierFor(gems) {
  let m = 1;
  for (let i = 0; i < gems; i++) {
    m *= ((SIZE - i) / (SIZE - BOMBS - i)) * HOUSE_EDGE;
  }
  return m;
}

function getActiveRound(userId) {
  return db
    .prepare("SELECT * FROM rounds WHERE user_id = ? AND game = 'mines' AND status = 'active'")
    .get(userId);
}

function parseDetail(round) {
  return JSON.parse(round.detail);
}

export function start(userId, betCents) {
  if (!Number.isInteger(betCents) || betCents < config.limits.minBetCents || betCents > config.limits.maxBetCents) {
    throw new ApiError(
      400,
      `Aposta deve ser entre R$ ${(config.limits.minBetCents / 100).toFixed(2)} e R$ ${(config.limits.maxBetCents / 100).toFixed(2)}`
    );
  }
  if (getActiveRound(userId)) {
    throw new ApiError(409, "Você já tem uma rodada de Mines em andamento");
  }

  const serverSeed = crypto.randomBytes(16).toString("hex");
  const seedHash = crypto.createHash("sha256").update(serverSeed).digest("hex");

  const bombs = new Set();
  while (bombs.size < BOMBS) bombs.add(crypto.randomInt(SIZE));

  let roundId, balanceCents;
  db.transaction(() => {
    balanceCents = applyEntries(userId, [
      { type: "bet", amountCents: -betCents, meta: { game: "mines" } },
    ]);
    const info = db
      .prepare(
        `INSERT INTO rounds (user_id, game, bet_cents, status, detail, server_seed, seed_hash)
         VALUES (?, 'mines', ?, 'active', ?, ?, ?)`
      )
      .run(userId, betCents, JSON.stringify({ bombs: [...bombs], revealed: [] }), serverSeed, seedHash);
    roundId = info.lastInsertRowid;
  })();

  return { roundId, seedHash, size: SIZE, bombsCount: BOMBS, balanceCents };
}

export function reveal(userId, cell) {
  const round = getActiveRound(userId);
  if (!round) throw new ApiError(404, "Nenhuma rodada ativa — comece uma nova");
  if (!Number.isInteger(cell) || cell < 0 || cell >= SIZE) throw new ApiError(400, "Célula inválida");

  const detail = parseDetail(round);
  if (detail.revealed.includes(cell)) throw new ApiError(400, "Célula já revelada");

  detail.revealed.push(cell);
  const isBomb = detail.bombs.includes(cell);
  const gems = detail.revealed.filter((c) => !detail.bombs.includes(c)).length;

  if (isBomb) {
    db.prepare(
      "UPDATE rounds SET status = 'settled', win_cents = 0, detail = ?, settled_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(detail), round.id);
    return {
      outcome: "bomb",
      bombs: detail.bombs,
      serverSeed: round.server_seed,
      balanceCents: getBalance(userId),
    };
  }

  const allCleared = gems === SIZE - BOMBS;
  if (allCleared) {
    return settle(userId, round, detail, gems);
  }

  db.prepare("UPDATE rounds SET detail = ? WHERE id = ?").run(JSON.stringify(detail), round.id);
  const mult = multiplierFor(gems);
  return {
    outcome: "gem",
    gems,
    multiplier: Number(mult.toFixed(4)),
    cashoutCents: Math.floor(round.bet_cents * mult),
  };
}

export function cashout(userId) {
  const round = getActiveRound(userId);
  if (!round) throw new ApiError(404, "Nenhuma rodada ativa");
  const detail = parseDetail(round);
  const gems = detail.revealed.filter((c) => !detail.bombs.includes(c)).length;
  if (gems === 0) throw new ApiError(400, "Revele ao menos uma célula antes de retirar");
  return settle(userId, round, detail, gems);
}

function settle(userId, round, detail, gems) {
  const mult = multiplierFor(gems);
  const winCents = Math.floor(round.bet_cents * mult);

  let balanceCents;
  db.transaction(() => {
    balanceCents = applyEntries(userId, [
      { type: "win", amountCents: winCents, meta: { game: "mines", roundId: round.id } },
    ]);
    db.prepare(
      "UPDATE rounds SET status = 'settled', win_cents = ?, detail = ?, settled_at = datetime('now') WHERE id = ?"
    ).run(winCents, JSON.stringify(detail), round.id);
  })();

  return {
    outcome: "cashout",
    gems,
    multiplier: Number(mult.toFixed(4)),
    winCents,
    bombs: detail.bombs,
    serverSeed: round.server_seed,
    balanceCents,
  };
}

/** Rodada ativa (para retomar após recarregar a página) — nunca expõe as bombas. */
export function activeRound(userId) {
  const round = getActiveRound(userId);
  if (!round) return null;
  const detail = parseDetail(round);
  const gems = detail.revealed.filter((c) => !detail.bombs.includes(c)).length;
  return {
    roundId: round.id,
    betCents: round.bet_cents,
    seedHash: round.seed_hash,
    revealed: detail.revealed,
    gems,
    multiplier: Number(multiplierFor(gems).toFixed(4)),
    cashoutCents: Math.floor(round.bet_cents * multiplierFor(gems)),
  };
}
