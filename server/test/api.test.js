import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Banco isolado e webhook demo desligado (confirmamos manualmente no teste)
process.env.DB_PATH = "data/test.db";
process.env.PIX_DEMO_AUTOCONFIRM_MS = "0";
process.env.JWT_SECRET = "segredo-de-teste";

const { createApp } = await import("../src/app.js");
const { config } = await import("../src/config.js");

let server, base, token;

before(async () => {
  fs.rmSync(config.dbPath, { force: true });
  fs.rmSync(config.dbPath + "-wal", { force: true });
  fs.rmSync(config.dbPath + "-shm", { force: true });
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test("health responde ok", async () => {
  const r = await api("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test("cadastro cria usuário e retorna token", async () => {
  const r = await api("POST", "/api/auth/register", {
    name: "Tester",
    email: "tester@yoshibet.com",
    password: "1234",
  });
  assert.equal(r.status, 201);
  assert.ok(r.body.token);
  assert.equal(r.body.user.balanceCents, 0);
  token = r.body.token;
});

test("e-mail duplicado é recusado", async () => {
  const r = await api("POST", "/api/auth/register", {
    name: "Outro",
    email: "tester@yoshibet.com",
    password: "1234",
  });
  assert.equal(r.status, 409);
});

test("login com senha errada falha", async () => {
  const r = await api("POST", "/api/auth/login", {
    email: "tester@yoshibet.com",
    password: "errada",
  });
  assert.equal(r.status, 401);
});

test("apostar sem saldo é bloqueado", async () => {
  const r = await api("POST", "/api/games/slot/spin", { betCents: 100 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Saldo insuficiente/);
});

let txid;

test("depósito gera cobrança PIX com BR Code válido", async () => {
  const r = await api("POST", "/api/wallet/deposit", { amountCents: 5000 });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, "pending");
  assert.ok(r.body.brcode.startsWith("000201"), "payload EMV começa com 000201");
  assert.ok(r.body.brcode.toUpperCase().includes("BR.GOV.BCB.PIX"));
  txid = r.body.txid;
});

test("webhook confirma pagamento e credita depósito + bônus de 100%", async () => {
  const r = await api("POST", `/api/wallet/deposit/${txid}/webhook`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "paid");
  assert.equal(r.body.balanceCents, 10000); // 50 + 50 de bônus
});

test("webhook é idempotente (não credita duas vezes)", async () => {
  const r = await api("POST", `/api/wallet/deposit/${txid}/webhook`);
  assert.equal(r.body.balanceCents, 10000);
});

test("segundo depósito não ganha bônus", async () => {
  const c = await api("POST", "/api/wallet/deposit", { amountCents: 2000 });
  const r = await api("POST", `/api/wallet/deposit/${c.body.txid}/webhook`);
  assert.equal(r.body.balanceCents, 12000); // +20, sem bônus
});

test("slot debita aposta e liquida a rodada", async () => {
  const before = (await api("GET", "/api/wallet")).body.balanceCents;
  const r = await api("POST", "/api/games/slot/spin", { betCents: 100 });
  assert.equal(r.status, 200);
  assert.equal(r.body.grid.length, 9);
  assert.equal(r.body.balanceCents, before - 100 + r.body.winCents);
  assert.ok(r.body.fair.seedHash.length === 64);
});

test("mines: fluxo completo start → reveal → cashout", async () => {
  const start = await api("POST", "/api/games/mines/start", { betCents: 100 });
  assert.equal(start.status, 201);
  assert.ok(start.body.seedHash);

  // rodada duplicada é bloqueada
  const dup = await api("POST", "/api/games/mines/start", { betCents: 100 });
  assert.equal(dup.status, 409);

  // revela células até achar uma gema ou estourar bomba
  let outcome;
  for (let cell = 0; cell < 25; cell++) {
    const r = await api("POST", "/api/games/mines/reveal", { cell });
    outcome = r.body;
    if (outcome.outcome === "bomb") break;      // perdeu: rodada encerrada
    if (outcome.outcome === "gem") {
      assert.ok(outcome.multiplier > 1);
      const cash = await api("POST", "/api/games/mines/cashout");
      assert.equal(cash.status, 200);
      assert.equal(cash.body.outcome, "cashout");
      assert.ok(cash.body.winCents > 0);
      assert.ok(cash.body.serverSeed, "server seed revelado no fim");
      outcome = cash.body;
      break;
    }
    if (outcome.outcome === "cashout") break;   // limpou o campo
  }
  assert.ok(["bomb", "cashout"].includes(outcome.outcome));

  // sem rodada ativa depois de encerrar
  const active = await api("GET", "/api/games/mines/active");
  assert.equal(active.body.round, null);
});

test("saque debita saldo e registra pedido", async () => {
  const before = (await api("GET", "/api/wallet")).body.balanceCents;
  const r = await api("POST", "/api/wallet/withdraw", {
    amountCents: 2000,
    pixKey: "tester@yoshibet.com",
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.balanceCents, before - 2000);
  assert.equal(r.body.withdrawal.status, "paid");
});

test("saque acima do saldo é recusado", async () => {
  const r = await api("POST", "/api/wallet/withdraw", {
    amountCents: 99999999,
    pixKey: "tester@yoshibet.com",
  });
  assert.equal(r.status, 400);
});

test("histórico registra as rodadas liquidadas", async () => {
  const r = await api("GET", "/api/games/history");
  assert.ok(r.body.rounds.length >= 2); // slot + mines
});

test("rotas protegidas exigem token", async () => {
  const saved = token;
  token = null;
  const r = await api("GET", "/api/wallet");
  assert.equal(r.status, 401);
  token = saved;
});
