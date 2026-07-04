import crypto from "node:crypto";
import { createStaticPix, hasError } from "pix-utils";
import { db } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../middleware/error.js";
import { applyEntries } from "./wallet.js";

/**
 * Gera o payload EMV "copia e cola" do PIX usando a lib open-source
 * pix-utils (github.com/thalesog/pix-utils). Em produção, a cobrança
 * viria de um PSP autorizado pelo BACEN (PIX dinâmico com txid).
 */
function buildBrCode(amountCents, txid) {
  const pix = createStaticPix({
    merchantName: config.pix.merchantName,
    merchantCity: config.pix.merchantCity,
    pixKey: config.pix.key,
    transactionAmount: amountCents / 100,
    txid: txid.slice(0, 25),
  });
  if (hasError(pix)) throw new Error(`pix-utils: ${pix.error}`);
  return pix.toBRCode();
}

export function createCharge(userId, amountCents) {
  if (!Number.isInteger(amountCents) || amountCents < config.limits.minDepositCents) {
    throw new ApiError(400, `Depósito mínimo: R$ ${(config.limits.minDepositCents / 100).toFixed(2)}`);
  }
  if (amountCents > config.limits.maxDepositCents) {
    throw new ApiError(400, `Depósito máximo: R$ ${(config.limits.maxDepositCents / 100).toFixed(2)}`);
  }

  const txid = crypto.randomBytes(16).toString("hex");
  const brcode = buildBrCode(amountCents, txid);
  db.prepare(
    "INSERT INTO pix_charges (txid, user_id, amount_cents, brcode) VALUES (?, ?, ?, ?)"
  ).run(txid, userId, amountCents, brcode);

  // DEMO: simula o webhook do PSP confirmando o pagamento após alguns segundos.
  if (config.pix.demoAutoconfirmMs > 0) {
    setTimeout(() => {
      try { confirmCharge(txid); } catch { /* já confirmada/expirada */ }
    }, config.pix.demoAutoconfirmMs).unref();
  }

  return { txid, brcode, amountCents, status: "pending" };
}

/** Confirma a cobrança e credita saldo + bônus de primeiro depósito. Idempotente. */
export function confirmCharge(txid) {
  const charge = db.prepare("SELECT * FROM pix_charges WHERE txid = ?").get(txid);
  if (!charge) throw new ApiError(404, "Cobrança não encontrada");
  if (charge.status === "paid") return charge;

  const isFirstDeposit = !db
    .prepare("SELECT 1 FROM transactions WHERE user_id = ? AND type = 'deposit' LIMIT 1")
    .get(charge.user_id);

  const entries = [{ type: "deposit", amountCents: charge.amount_cents, meta: { txid } }];
  if (isFirstDeposit && config.bonus.firstDepositPct > 0) {
    const bonus = Math.min(
      Math.floor((charge.amount_cents * config.bonus.firstDepositPct) / 100),
      config.bonus.firstDepositCapCents
    );
    if (bonus > 0) entries.push({ type: "bonus", amountCents: bonus, meta: { txid, reason: "first_deposit" } });
  }

  db.transaction(() => {
    db.prepare("UPDATE pix_charges SET status = 'paid', paid_at = datetime('now') WHERE txid = ?").run(txid);
    applyEntries(charge.user_id, entries);
  })();

  return db.prepare("SELECT * FROM pix_charges WHERE txid = ?").get(txid);
}

export function getCharge(userId, txid) {
  const charge = db
    .prepare("SELECT txid, amount_cents, status, brcode, created_at, paid_at FROM pix_charges WHERE txid = ? AND user_id = ?")
    .get(txid, userId);
  if (!charge) throw new ApiError(404, "Cobrança não encontrada");
  return charge;
}

export function requestWithdrawal(userId, amountCents, pixKey) {
  if (!Number.isInteger(amountCents) || amountCents < config.limits.minWithdrawCents) {
    throw new ApiError(400, `Saque mínimo: R$ ${(config.limits.minWithdrawCents / 100).toFixed(2)}`);
  }
  if (!pixKey || String(pixKey).trim().length < 5) {
    throw new ApiError(400, "Informe uma chave PIX válida");
  }

  let withdrawalId;
  db.transaction(() => {
    applyEntries(userId, [{ type: "withdraw", amountCents: -amountCents, meta: { pixKey } }]);
    const info = db
      .prepare("INSERT INTO withdrawals (user_id, amount_cents, pix_key, status, paid_at) VALUES (?, ?, ?, 'paid', datetime('now'))")
      .run(userId, amountCents, String(pixKey).trim());
    withdrawalId = info.lastInsertRowid;
  })();

  // DEMO: saque marcado como pago na hora. Em produção ficaria 'pending'
  // até o PSP executar a transferência.
  return db.prepare("SELECT * FROM withdrawals WHERE id = ?").get(withdrawalId);
}
