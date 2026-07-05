import crypto from "node:crypto";
import QRCode from "qrcode";
import { createStaticPix, hasError } from "pix-utils";
import { pool, withTx } from "../db.js";
import { config } from "./../config.js";
import { ApiError } from "../middleware/error.js";
import { applyEntries } from "./wallet.js";

/**
 * Payload EMV "copia e cola" via pix-utils (github.com/thalesog/pix-utils).
 * Em produção, a cobrança viria de um PSP autorizado pelo BACEN.
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

export async function createCharge(userId, amountCents) {
  if (!Number.isInteger(amountCents) || amountCents < config.limits.minDepositCents) {
    throw new ApiError(400, `Depósito mínimo: R$ ${(config.limits.minDepositCents / 100).toFixed(2)}`);
  }
  if (amountCents > config.limits.maxDepositCents) {
    throw new ApiError(400, `Depósito máximo: R$ ${(config.limits.maxDepositCents / 100).toFixed(2)}`);
  }

  const txid = crypto.randomBytes(16).toString("hex");
  const brcode = buildBrCode(amountCents, txid);
  await pool.query(
    "INSERT INTO pix_charges (txid, user_id, amount_cents, brcode) VALUES ($1, $2, $3, $4)",
    [txid, userId, amountCents, brcode]
  );

  // DEMO em servidor persistente: confirma sozinho após alguns segundos.
  // No serverless (Vercel) o processo morre — a confirmação acontece de
  // forma preguiçosa no polling do getCharge (abaixo).
  if (config.pix.demoAutoconfirmMs > 0 && !config.isServerless) {
    setTimeout(() => {
      confirmCharge(txid).catch(() => {});
    }, config.pix.demoAutoconfirmMs).unref?.();
  }

  const qrDataUrl = await QRCode.toDataURL(brcode, {
    margin: 1,
    width: 340,
    color: { dark: "#0d0f14", light: "#ffffff" },
  });

  return { txid, brcode, qrDataUrl, amountCents, status: "pending" };
}

/** Confirma a cobrança e credita saldo + bônus de primeiro depósito. Idempotente. */
export async function confirmCharge(txid) {
  return withTx(async (client) => {
    // Trava a cobrança para evitar crédito duplo em chamadas concorrentes
    const { rows } = await client.query("SELECT * FROM pix_charges WHERE txid = $1 FOR UPDATE", [txid]);
    const charge = rows[0];
    if (!charge) throw new ApiError(404, "Cobrança não encontrada");
    if (charge.status === "paid") return charge;

    const { rows: dep } = await client.query(
      "SELECT 1 FROM transactions WHERE user_id = $1 AND type = 'deposit' LIMIT 1",
      [charge.user_id]
    );
    const isFirstDeposit = dep.length === 0;

    const entries = [{ type: "deposit", amountCents: charge.amount_cents, meta: { txid } }];
    if (isFirstDeposit && config.bonus.firstDepositPct > 0) {
      const bonus = Math.min(
        Math.floor((charge.amount_cents * config.bonus.firstDepositPct) / 100),
        config.bonus.firstDepositCapCents
      );
      if (bonus > 0) entries.push({ type: "bonus", amountCents: bonus, meta: { txid, reason: "first_deposit" } });
    }

    await client.query("UPDATE pix_charges SET status = 'paid', paid_at = now() WHERE txid = $1", [txid]);
    await applyEntries(charge.user_id, entries, client);

    return { ...charge, status: "paid" };
  });
}

export async function getCharge(userId, txid) {
  const { rows } = await pool.query(
    `SELECT txid, amount_cents, status, brcode, created_at, paid_at,
            EXTRACT(EPOCH FROM (now() - created_at)) * 1000 AS age_ms
     FROM pix_charges WHERE txid = $1 AND user_id = $2`,
    [txid, userId]
  );
  const charge = rows[0];
  if (!charge) throw new ApiError(404, "Cobrança não encontrada");

  // DEMO serverless: confirma quando o polling encontra a cobrança "madura"
  if (
    charge.status === "pending" &&
    config.pix.demoAutoconfirmMs > 0 &&
    charge.age_ms >= config.pix.demoAutoconfirmMs
  ) {
    await confirmCharge(txid);
    charge.status = "paid";
  }
  delete charge.age_ms;
  return charge;
}

export async function requestWithdrawal(userId, amountCents, pixKey) {
  if (!Number.isInteger(amountCents) || amountCents < config.limits.minWithdrawCents) {
    throw new ApiError(400, `Saque mínimo: R$ ${(config.limits.minWithdrawCents / 100).toFixed(2)}`);
  }
  if (!pixKey || String(pixKey).trim().length < 5) {
    throw new ApiError(400, "Informe uma chave PIX válida");
  }

  return withTx(async (client) => {
    await applyEntries(userId, [{ type: "withdraw", amountCents: -amountCents, meta: { pixKey } }], client);
    // DEMO: pago na hora. Em produção ficaria 'pending' até o PSP transferir.
    const { rows } = await client.query(
      `INSERT INTO withdrawals (user_id, amount_cents, pix_key, status, paid_at)
       VALUES ($1, $2, $3, 'paid', now()) RETURNING *`,
      [userId, amountCents, String(pixKey).trim()]
    );
    return rows[0];
  });
}
