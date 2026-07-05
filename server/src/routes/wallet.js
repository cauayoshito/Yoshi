import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { wrap } from "../middleware/error.js";
import { getBalance, listTransactions } from "../services/wallet.js";
import { createCharge, confirmCharge, getCharge, requestWithdrawal } from "../services/pix.js";

export const walletRouter = Router();
walletRouter.use(requireAuth);

walletRouter.get("/", wrap(async (req, res) => {
  res.json({
    balanceCents: await getBalance(req.user.id),
    transactions: await listTransactions(req.user.id),
  });
}));

/** Cria uma cobrança PIX (QR real + copia-e-cola). */
walletRouter.post("/deposit", wrap(async (req, res) => {
  const amountCents = Math.round(Number(req.body?.amountCents));
  res.status(201).json(await createCharge(req.user.id, amountCents));
}));

/** Consulta o status da cobrança — o front faz polling até 'paid'. */
walletRouter.get("/deposit/:txid", wrap(async (req, res) => {
  const charge = await getCharge(req.user.id, req.params.txid);
  res.json({ ...charge, balanceCents: await getBalance(req.user.id) });
}));

/**
 * Webhook do PSP (demo). Em produção este endpoint seria chamado pelo
 * provedor de pagamento com assinatura verificada — nunca pelo cliente.
 */
walletRouter.post("/deposit/:txid/webhook", wrap(async (req, res) => {
  await getCharge(req.user.id, req.params.txid); // garante que a cobrança é do usuário
  const charge = await confirmCharge(req.params.txid);
  res.json({ ...charge, balanceCents: await getBalance(req.user.id) });
}));

walletRouter.post("/withdraw", wrap(async (req, res) => {
  const amountCents = Math.round(Number(req.body?.amountCents));
  const withdrawal = await requestWithdrawal(req.user.id, amountCents, req.body?.pixKey);
  res.status(201).json({ withdrawal, balanceCents: await getBalance(req.user.id) });
}));
