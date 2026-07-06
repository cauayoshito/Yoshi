import crypto from "node:crypto";
import { withTx } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../middleware/error.js";
import { applyEntries } from "./wallet.js";
import { assertBetAllowed } from "./responsible.js";

/**
 * Fortune Yoshi — slot 3x3, 5 linhas de pagamento.
 * O sorteio acontece AQUI, no servidor, com crypto.randomInt.
 * Os pesos dos símbolos definem o RTP (retorno ao jogador).
 */
const REEL = [
  ...Array(28).fill("🍒"),
  ...Array(22).fill("🍀"),
  ...Array(18).fill("🔔"),
  ...Array(14).fill("⭐"),
  ...Array(9).fill("💎"),
  ...Array(6).fill("7️⃣"),
  ...Array(3).fill("🐲"),
];

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // linhas horizontais
  [0, 4, 8], [2, 4, 6],            // diagonais
];

const PAYTABLE = { "🐲": 60, "7️⃣": 30, "💎": 18, "⭐": 10, "🔔": 6, "🍀": 4, "🍒": 2 };

function validateBet(betCents) {
  if (!Number.isInteger(betCents) || betCents < config.limits.minBetCents || betCents > config.limits.maxBetCents) {
    throw new ApiError(
      400,
      `Aposta deve ser entre R$ ${(config.limits.minBetCents / 100).toFixed(2)} e R$ ${(config.limits.maxBetCents / 100).toFixed(2)}`
    );
  }
}

export async function spin(userId, betCents) {
  validateBet(betCents);

  const serverSeed = crypto.randomBytes(16).toString("hex");
  const seedHash = crypto.createHash("sha256").update(serverSeed).digest("hex");

  const grid = Array.from({ length: 9 }, () => REEL[crypto.randomInt(REEL.length)]);

  const winCells = new Set();
  let totalMult = 0;
  const winningLines = [];
  for (const line of LINES) {
    const [a, b, c] = line.map((i) => grid[i]);
    if (a === b && b === c) {
      totalMult += PAYTABLE[a];
      line.forEach((i) => winCells.add(i));
      winningLines.push({ line, symbol: a, mult: PAYTABLE[a] });
    }
  }
  const winCents = betCents * totalMult;

  const balanceCents = await withTx(async (client) => {
    await assertBetAllowed(userId, client);
    const balance = await applyEntries(
      userId,
      [
        { type: "bet", amountCents: -betCents, meta: { game: "slot" } },
        ...(winCents > 0 ? [{ type: "win", amountCents: winCents, meta: { game: "slot" } }] : []),
      ],
      client
    );
    await client.query(
      `INSERT INTO rounds (user_id, game, bet_cents, win_cents, status, detail, server_seed, seed_hash, settled_at)
       VALUES ($1, 'slot', $2, $3, 'settled', $4, $5, $6, now())`,
      [userId, betCents, winCents, { grid, winningLines }, serverSeed, seedHash]
    );
    return balance;
  });

  return {
    grid,
    winCells: [...winCells],
    winningLines,
    winCents,
    balanceCents,
    fair: { serverSeed, seedHash },
  };
}
