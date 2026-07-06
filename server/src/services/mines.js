import crypto from "node:crypto";
import { pool, withTx } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../middleware/error.js";
import { applyEntries, getBalance } from "./wallet.js";
import { assertBetAllowed } from "./responsible.js";

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

async function getActiveRound(userId, client = pool, lock = false) {
  const { rows } = await client.query(
    `SELECT * FROM rounds WHERE user_id = $1 AND game = 'mines' AND status = 'active'${lock ? " FOR UPDATE" : ""}`,
    [userId]
  );
  return rows[0] || null;
}

export async function start(userId, betCents) {
  if (!Number.isInteger(betCents) || betCents < config.limits.minBetCents || betCents > config.limits.maxBetCents) {
    throw new ApiError(
      400,
      `Aposta deve ser entre R$ ${(config.limits.minBetCents / 100).toFixed(2)} e R$ ${(config.limits.maxBetCents / 100).toFixed(2)}`
    );
  }

  const serverSeed = crypto.randomBytes(16).toString("hex");
  const seedHash = crypto.createHash("sha256").update(serverSeed).digest("hex");

  const bombs = new Set();
  while (bombs.size < BOMBS) bombs.add(crypto.randomInt(SIZE));

  return withTx(async (client) => {
    await assertBetAllowed(userId, client);
    if (await getActiveRound(userId, client, true)) {
      throw new ApiError(409, "Você já tem uma rodada de Mines em andamento");
    }
    const balanceCents = await applyEntries(
      userId,
      [{ type: "bet", amountCents: -betCents, meta: { game: "mines" } }],
      client
    );
    const { rows } = await client.query(
      `INSERT INTO rounds (user_id, game, bet_cents, status, detail, server_seed, seed_hash)
       VALUES ($1, 'mines', $2, 'active', $3, $4, $5) RETURNING id`,
      [userId, betCents, { bombs: [...bombs], revealed: [] }, serverSeed, seedHash]
    );
    return { roundId: rows[0].id, seedHash, size: SIZE, bombsCount: BOMBS, balanceCents };
  });
}

export async function reveal(userId, cell) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= SIZE) throw new ApiError(400, "Célula inválida");

  return withTx(async (client) => {
    const round = await getActiveRound(userId, client, true);
    if (!round) throw new ApiError(404, "Nenhuma rodada ativa — comece uma nova");

    const detail = round.detail;
    if (detail.revealed.includes(cell)) throw new ApiError(400, "Célula já revelada");

    detail.revealed.push(cell);
    const isBomb = detail.bombs.includes(cell);
    const gems = detail.revealed.filter((c) => !detail.bombs.includes(c)).length;

    if (isBomb) {
      await client.query(
        "UPDATE rounds SET status = 'settled', win_cents = 0, detail = $1, settled_at = now() WHERE id = $2",
        [detail, round.id]
      );
      return {
        outcome: "bomb",
        bombs: detail.bombs,
        serverSeed: round.server_seed,
        balanceCents: await getBalance(userId, client),
      };
    }

    if (gems === SIZE - BOMBS) {
      return settle(client, userId, round, detail, gems);
    }

    await client.query("UPDATE rounds SET detail = $1 WHERE id = $2", [detail, round.id]);
    const mult = multiplierFor(gems);
    return {
      outcome: "gem",
      gems,
      multiplier: Number(mult.toFixed(4)),
      cashoutCents: Math.floor(round.bet_cents * mult),
    };
  });
}

export async function cashout(userId) {
  return withTx(async (client) => {
    const round = await getActiveRound(userId, client, true);
    if (!round) throw new ApiError(404, "Nenhuma rodada ativa");
    const detail = round.detail;
    const gems = detail.revealed.filter((c) => !detail.bombs.includes(c)).length;
    if (gems === 0) throw new ApiError(400, "Revele ao menos uma célula antes de retirar");
    return settle(client, userId, round, detail, gems);
  });
}

async function settle(client, userId, round, detail, gems) {
  const mult = multiplierFor(gems);
  const winCents = Math.floor(round.bet_cents * mult);

  const balanceCents = await applyEntries(
    userId,
    [{ type: "win", amountCents: winCents, meta: { game: "mines", roundId: round.id } }],
    client
  );
  await client.query(
    "UPDATE rounds SET status = 'settled', win_cents = $1, detail = $2, settled_at = now() WHERE id = $3",
    [winCents, detail, round.id]
  );

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
export async function activeRound(userId) {
  const round = await getActiveRound(userId);
  if (!round) return null;
  const detail = round.detail;
  const gems = detail.revealed.filter((c) => !detail.bombs.includes(c)).length;
  const mult = multiplierFor(gems);
  return {
    roundId: round.id,
    betCents: round.bet_cents,
    seedHash: round.seed_hash,
    revealed: detail.revealed,
    gems,
    multiplier: Number(mult.toFixed(4)),
    cashoutCents: Math.floor(round.bet_cents * mult),
  };
}
