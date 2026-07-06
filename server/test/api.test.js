import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// Banco isolado (Postgres local) e webhook demo desligado
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/yoshibet_test";
process.env.ADMIN_EMAIL = "chefe@yoshibet.com";
process.env.PIX_DEMO_AUTOCONFIRM_MS = "0";
process.env.JWT_SECRET = "segredo-de-teste";

const { createApp } = await import("../src/app.js");
const { pool, migrate } = await import("../src/db.js");

let server, base, token;

before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate();
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

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

test("depósito gera cobrança PIX com BR Code válido e QR escaneável", async () => {
  const r = await api("POST", "/api/wallet/deposit", { amountCents: 5000 });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, "pending");
  assert.ok(r.body.brcode.startsWith("000201"), "payload EMV começa com 000201");
  assert.ok(r.body.brcode.toUpperCase().includes("BR.GOV.BCB.PIX"));
  assert.ok(r.body.qrDataUrl.startsWith("data:image/png;base64,"), "QR code real em data URL");
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

test("esportes: lista partidas com status calculado", async () => {
  const r = await api("GET", "/api/sports/matches");
  assert.equal(r.status, 200);
  assert.equal(r.body.matches.length, 8);
  assert.ok(r.body.matches.every((m) => ["upcoming", "live", "finished"].includes(m.status)));
});

let openMatch; // partida ainda aberta, escolhida dinamicamente (robusto ao relógio)

test("esportes: aposta debita carteira e usa odds do servidor", async () => {
  const matches = (await api("GET", "/api/sports/matches")).body.matches;
  openMatch = matches.find((m) => m.status === "upcoming" && !m.result);
  assert.ok(openMatch, "precisa existir ao menos uma partida futura no calendário");

  const before = (await api("GET", "/api/wallet")).body.balanceCents;
  const r = await api("POST", "/api/sports/bet", {
    matchId: openMatch.id,
    pick: "home",
    stakeCents: 1000,
    odds: 999, // odds do cliente devem ser ignoradas
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.balanceCents, before - 1000);
  assert.equal(r.body.bet.odds, openMatch.odds.home);
  assert.equal(r.body.bet.potential_win_cents, Math.floor(1000 * openMatch.odds.home));
  assert.equal(r.body.bet.status, "pending");
  assert.equal(r.body.bet.pickLabel, openMatch.home.name);
});

test("esportes: pick inválido e partida inexistente são recusados", async () => {
  const bad = await api("POST", "/api/sports/bet", { matchId: openMatch.id, pick: "banana", stakeCents: 1000 });
  assert.equal(bad.status, 400);
  const missing = await api("POST", "/api/sports/bet", { matchId: "nope", pick: "home", stakeCents: 1000 });
  assert.equal(missing.status, 404);
});

test("esportes: lista minhas apostas", async () => {
  const r = await api("GET", "/api/sports/bets");
  assert.ok(r.body.bets.length >= 1);
  assert.equal(r.body.bets[0].match.home.name, openMatch.home.name);
});

test("rotas protegidas exigem token", async () => {
  const saved = token;
  token = null;
  const r = await api("GET", "/api/wallet");
  assert.equal(r.status, 401);
  token = saved;
});

test("admin: usuário comum recebe 403", async () => {
  const r = await api("GET", "/api/admin/stats");
  assert.equal(r.status, 403);
});

let adminToken;

test("admin: cadastro com ADMIN_EMAIL vira administrador", async () => {
  const r = await api("POST", "/api/auth/register", {
    name: "Chefe",
    email: "chefe@yoshibet.com",
    password: "supersegura",
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, "admin");
  adminToken = r.body.token;
});

test("admin: stats retornam métricas coerentes", async () => {
  const saved = token;
  token = adminToken;
  const r = await api("GET", "/api/admin/stats");
  assert.equal(r.status, 200);
  assert.ok(r.body.users >= 2);
  assert.ok(r.body.depositsCents >= 7000); // 50 + 20 depositados nos testes
  assert.ok(typeof r.body.ggrCents === "number");
  token = saved;
});

test("liquidação: resultado paga vencedores e marca perdedores", async () => {
  // aposta no empate da partida aberta escolhida dinamicamente
  const expectedPaid = Math.floor(1000 * openMatch.odds.draw);
  const bet = await api("POST", "/api/sports/bet", {
    matchId: openMatch.id,
    pick: "draw",
    stakeCents: 1000,
  });
  assert.equal(bet.status, 201);
  const balanceBefore = bet.body.balanceCents;

  // admin registra 1x1 → aposta no empate ganha (a aposta em casa perde)
  const saved = token;
  token = adminToken;
  const result = await api("POST", `/api/admin/matches/${openMatch.id}/result`, {
    homeScore: 1,
    awayScore: 1,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.outcome, "draw");
  assert.equal(result.body.won, 1);
  assert.equal(result.body.lost, 1);
  assert.equal(result.body.paidCents, expectedPaid);

  // resultado duplicado é recusado (idempotência)
  const dup = await api("POST", `/api/admin/matches/${openMatch.id}/result`, {
    homeScore: 2,
    awayScore: 0,
  });
  assert.equal(dup.status, 409);
  token = saved;

  // saldo do apostador foi creditado e a aposta marcada como ganha
  const wallet = await api("GET", "/api/wallet");
  assert.equal(wallet.body.balanceCents, balanceBefore + expectedPaid);
  const bets = await api("GET", "/api/sports/bets");
  const settled = bets.body.bets.find((b) => b.match_id === openMatch.id && b.pick === "draw");
  assert.equal(settled.status, "won");
});

test("liquidação: apostar em partida com resultado é bloqueado", async () => {
  const r = await api("POST", "/api/sports/bet", {
    matchId: openMatch.id,
    pick: "home",
    stakeCents: 1000,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /encerrado/i);
});
