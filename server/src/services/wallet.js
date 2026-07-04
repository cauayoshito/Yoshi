import { db } from "../db.js";
import { ApiError } from "../middleware/error.js";

const insertTx = db.prepare(
  "INSERT INTO transactions (user_id, type, amount_cents, meta) VALUES (?, ?, ?, ?)"
);
const updateBalance = db.prepare(
  "UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?"
);
const getBalanceStmt = db.prepare("SELECT balance_cents FROM users WHERE id = ?");

export function getBalance(userId) {
  return getBalanceStmt.get(userId).balance_cents;
}

/**
 * Aplica um conjunto de movimentações de forma atômica.
 * entries: [{ type, amountCents, meta? }] — débito é negativo.
 * Lança 400 se o saldo ficaria negativo (CHECK do SQLite garante no banco).
 */
export const applyEntries = db.transaction((userId, entries) => {
  let delta = 0;
  for (const e of entries) {
    insertTx.run(userId, e.type, e.amountCents, e.meta ? JSON.stringify(e.meta) : null);
    delta += e.amountCents;
  }
  try {
    updateBalance.run(delta, userId);
  } catch (err) {
    if (String(err.message).includes("CHECK")) {
      throw new ApiError(400, "Saldo insuficiente");
    }
    throw err;
  }
  return getBalance(userId);
});

export function listTransactions(userId, limit = 30) {
  return db
    .prepare(
      "SELECT id, type, amount_cents, meta, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?"
    )
    .all(userId, limit)
    .map((t) => ({ ...t, meta: t.meta ? JSON.parse(t.meta) : null }));
}
