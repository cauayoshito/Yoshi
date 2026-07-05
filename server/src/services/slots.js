/**
 * Integração da @yoshibet/slots-engine com a plataforma.
 *
 * - Config dos jogos vive em slot_games (JSONB versionado) — a engine só
 *   executa o que está no banco.
 * - Provably fair modelo Stake: cada usuário tem um par de seeds ativo;
 *   o hash do server seed é público desde o início e o seed em si só é
 *   revelado quando o usuário rotaciona o par. O nonce incrementa a cada
 *   spin, então toda rodada é verificável de forma independente.
 * - RNG roda SEMPRE aqui no servidor, dentro de uma transação que trava o
 *   par de seeds (FOR UPDATE) — spins concorrentes do mesmo usuário são
 *   serializados e o nonce nunca repete.
 */
import crypto from "node:crypto";
import {
  playSpin,
  validateConfig,
  ProvablyFairRNG,
  generateServerSeed,
  hashServerSeed,
} from "../../../packages/slots-engine/dist/src/index.js";
import { yoshiFortune } from "../../../packages/slots-engine/dist/games/yoshi-fortune.js";
import { pool, withTx } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../middleware/error.js";
import { applyEntries } from "./wallet.js";

/** Publica os jogos da engine no catálogo (idempotente; roda no boot). */
export async function ensureGames() {
  validateConfig(yoshiFortune);
  await pool.query(
    `INSERT INTO slot_games (id, name, config, updated_by)
     VALUES ($1, $2, $3, 'boot')
     ON CONFLICT (id) DO NOTHING`,
    [yoshiFortune.id, yoshiFortune.name, yoshiFortune]
  );
}

export async function listGames() {
  const { rows } = await pool.query(
    "SELECT id, name, config, version FROM slot_games WHERE active ORDER BY id"
  );
  return rows;
}

async function getActiveGame(gameId, client = pool) {
  const { rows } = await client.query(
    "SELECT * FROM slot_games WHERE id = $1 AND active",
    [gameId]
  );
  if (!rows[0]) throw new ApiError(404, "Jogo não encontrado ou inativo");
  return rows[0];
}

/* ============ Seeds provably fair ============ */

async function createSeedPair(client, userId, clientSeed) {
  const serverSeed = generateServerSeed();
  const { rows } = await client.query(
    `INSERT INTO fair_seeds (user_id, server_seed, server_seed_hash, client_seed)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, serverSeed, hashServerSeed(serverSeed), clientSeed]
  );
  return rows[0];
}

async function getActiveSeedPair(client, userId, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM fair_seeds WHERE user_id = $1 AND active${lock ? " FOR UPDATE" : ""}`,
    [userId]
  );
  if (rows[0]) return rows[0];
  return createSeedPair(client, userId, crypto.randomBytes(8).toString("hex"));
}

const publicSeed = (pair) => ({
  serverSeedHash: pair.server_seed_hash,
  clientSeed: pair.client_seed,
  nonce: pair.nonce,
});

export async function getSeeds(userId) {
  return withTx(async (c) => publicSeed(await getActiveSeedPair(c, userId)));
}

/**
 * Rotaciona o par: revela o server seed antigo (todas as rodadas feitas com
 * ele ficam verificáveis) e cria um novo compromisso.
 */
export async function rotateSeeds(userId, newClientSeed) {
  const clientSeed = String(newClientSeed || crypto.randomBytes(8).toString("hex")).slice(0, 64);
  return withTx(async (c) => {
    const old = await getActiveSeedPair(c, userId, { lock: true });
    await c.query(
      "UPDATE fair_seeds SET active = false, revealed_at = now() WHERE id = $1",
      [old.id]
    );
    const fresh = await createSeedPair(c, userId, clientSeed);
    return {
      revealed: {
        serverSeed: old.server_seed,
        serverSeedHash: old.server_seed_hash,
        clientSeed: old.client_seed,
        lastNonce: old.nonce,
      },
      current: publicSeed(fresh),
    };
  });
}

/* ============ Spin ============ */

export async function spin(userId, gameId, betCentsRaw) {
  return withTx(async (client) => {
    const game = await getActiveGame(gameId, client);
    const pair = await getActiveSeedPair(client, userId, { lock: true });

    // sessão (free spins pendentes)
    const { rows: sess } = await client.query(
      "SELECT * FROM slot_sessions WHERE user_id = $1 AND game_id = $2 FOR UPDATE",
      [userId, gameId]
    );
    const session = sess[0] || null;
    const isFreeSpin = (session?.free_spins_left ?? 0) > 0;

    let betCents;
    if (isFreeSpin) {
      betCents = session.free_spin_bet_cents;
    } else {
      betCents = Math.round(Number(betCentsRaw));
      if (
        !Number.isInteger(betCents) ||
        betCents < config.limits.minBetCents ||
        betCents > config.limits.maxBetCents
      ) {
        throw new ApiError(
          400,
          `Aposta deve ser entre R$ ${(config.limits.minBetCents / 100).toFixed(2)} e R$ ${(config.limits.maxBetCents / 100).toFixed(2)}`
        );
      }
    }

    // RNG determinístico: (serverSeed, clientSeed, nonce) → resultado
    const rng = new ProvablyFairRNG(pair.server_seed, pair.client_seed, Number(pair.nonce));
    const result = playSpin(game.config, rng);
    const payoutCents = Math.round(betCents * result.totalMultiplier);

    // carteira: débito só em spin pago; crédito quando há prêmio
    const entries = [];
    if (!isFreeSpin && betCents > 0) {
      entries.push({ type: "bet", amountCents: -betCents, meta: { game: gameId, engine: true } });
    }
    if (payoutCents > 0) {
      entries.push({ type: "win", amountCents: payoutCents, meta: { game: gameId, engine: true } });
    }
    const balanceCents = entries.length
      ? await applyEntries(userId, entries, client)
      : (await client.query("SELECT balance_cents FROM users WHERE id = $1", [userId])).rows[0].balance_cents;

    // nonce consumido
    await client.query("UPDATE fair_seeds SET nonce = nonce + 1 WHERE id = $1", [pair.id]);

    // rodada gravada (trilha de auditoria)
    const { rows: roundRows } = await client.query(
      `INSERT INTO slot_rounds
         (user_id, game_id, game_version, fair_seed_id, nonce, bet_cents, payout_cents, is_free_spin, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`,
      [userId, gameId, game.version, pair.id, pair.nonce, betCents, payoutCents, isFreeSpin, result]
    );

    // sessão: consome/premia free spins e acumula agregados
    const fsConsumed = isFreeSpin ? 1 : 0;
    const fsAwarded = result.freeSpinsAwarded;
    await client.query(
      `INSERT INTO slot_sessions
         (user_id, game_id, free_spins_left, free_spin_bet_cents, total_bet_cents, total_payout_cents, rounds, last_played_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, now())
       ON CONFLICT (user_id, game_id) DO UPDATE SET
         free_spins_left = slot_sessions.free_spins_left - $7 + $3,
         free_spin_bet_cents = CASE WHEN $3 > 0 THEN $4 ELSE slot_sessions.free_spin_bet_cents END,
         total_bet_cents = slot_sessions.total_bet_cents + $5,
         total_payout_cents = slot_sessions.total_payout_cents + $6,
         rounds = slot_sessions.rounds + 1,
         last_played_at = now()`,
      [userId, gameId, fsAwarded, betCents, isFreeSpin ? 0 : betCents, payoutCents, fsConsumed]
    );

    const { rows: after } = await client.query(
      "SELECT free_spins_left FROM slot_sessions WHERE user_id = $1 AND game_id = $2",
      [userId, gameId]
    );

    return {
      roundId: roundRows[0].id,
      gameId,
      gameVersion: game.version,
      result,
      betCents,
      payoutCents,
      isFreeSpin,
      freeSpinsLeft: after[0].free_spins_left,
      balanceCents,
      fair: {
        serverSeedHash: pair.server_seed_hash,
        clientSeed: pair.client_seed,
        nonce: Number(pair.nonce),
      },
    };
  });
}

export async function listRounds(userId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT id, game_id, game_version, nonce, bet_cents, payout_cents, is_free_spin, result, created_at
     FROM slot_rounds WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

/**
 * Verificação PÚBLICA de uma rodada (item 4 do Bloco 2).
 * Sempre expõe hash + client seed + nonce + resultado; o server seed em si
 * aparece depois que o par foi rotacionado (revealed_at). Com ele, qualquer
 * pessoa reproduz a rodada com a engine open-source.
 */
export async function verifyRound(roundId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.game_id, r.game_version, r.nonce, r.bet_cents, r.payout_cents,
            r.is_free_spin, r.result, r.created_at,
            s.server_seed_hash, s.client_seed, s.revealed_at,
            CASE WHEN s.revealed_at IS NOT NULL THEN s.server_seed END AS server_seed,
            g.config
     FROM slot_rounds r
     JOIN fair_seeds s ON s.id = r.fair_seed_id
     JOIN slot_games g ON g.id = r.game_id
     WHERE r.id = $1`,
    [roundId]
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, "Rodada não encontrada");
  return {
    roundId: row.id,
    gameId: row.game_id,
    gameVersion: row.game_version,
    createdAt: row.created_at,
    betCents: row.bet_cents,
    payoutCents: row.payout_cents,
    isFreeSpin: row.is_free_spin,
    result: row.result,
    gameConfig: row.config,
    fair: {
      serverSeedHash: row.server_seed_hash,
      clientSeed: row.client_seed,
      nonce: Number(row.nonce),
      serverSeed: row.server_seed || null,
      revealedAt: row.revealed_at,
      howToVerify:
        "1) sha256(serverSeed) deve bater com serverSeedHash; 2) rode playSpin(gameConfig, new ProvablyFairRNG(serverSeed, clientSeed, nonce)) na @yoshibet/slots-engine e compare com result. Server seed é revelado após a rotação do par de seeds.",
    },
  };
}

/** Snapshot de RTP por jogo → rtp_audit_log (chamado pelo cron/admin). */
export async function snapshotRtp(source = "cron") {
  const { rows } = await pool.query(
    `SELECT r.game_id, g.version, g.config->>'targetRtp' AS target,
            COUNT(*) AS rounds, SUM(r.bet_cents) AS bets, SUM(r.payout_cents) AS payouts
     FROM slot_rounds r JOIN slot_games g ON g.id = r.game_id
     GROUP BY r.game_id, g.version, g.config->>'targetRtp'`
  );
  const snapshots = [];
  for (const r of rows) {
    if (!Number(r.bets)) continue;
    const rtp = Number(r.payouts) / Number(r.bets);
    await pool.query(
      `INSERT INTO rtp_audit_log (game_id, game_version, rounds, total_bet_cents, total_payout_cents, rtp, target_rtp, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [r.game_id, r.version, r.rounds, r.bets, r.payouts, rtp.toFixed(5), r.target, source]
    );
    snapshots.push({ gameId: r.game_id, rounds: Number(r.rounds), rtp });
  }
  return snapshots;
}
