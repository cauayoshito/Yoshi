import { pool, withTx } from "../db.js";
import { ApiError } from "../middleware/error.js";

export async function getBalance(userId, client = pool) {
  const { rows } = await client.query("SELECT balance_cents FROM users WHERE id = $1", [userId]);
  return rows[0].balance_cents;
}

/**
 * Aplica um conjunto de movimentações de forma atômica.
 * entries: [{ type, amountCents, meta? }] — débito é negativo.
 * O CHECK (balance_cents >= 0) no banco garante que saldo nunca fica
 * negativo, mesmo com requisições concorrentes.
 * Passe um client de transação para compor com outras escritas.
 */
export async function applyEntries(userId, entries, client = null) {
  if (!client) return withTx((c) => applyEntries(userId, entries, c));

  let delta = 0;
  for (const e of entries) {
    await client.query(
      "INSERT INTO transactions (user_id, type, amount_cents, meta) VALUES ($1, $2, $3, $4)",
      [userId, e.type, e.amountCents, e.meta ?? null]
    );
    delta += e.amountCents;
  }
  try {
    await client.query("UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2", [delta, userId]);
  } catch (err) {
    if (err.code === "23514") throw new ApiError(400, "Saldo insuficiente"); // check_violation
    throw err;
  }
  return getBalance(userId, client);
}

export async function listTransactions(userId, limit = 30) {
  const { rows } = await pool.query(
    "SELECT id, type, amount_cents, meta, created_at FROM transactions WHERE user_id = $1 ORDER BY id DESC LIMIT $2",
    [userId, limit]
  );
  return rows;
}
