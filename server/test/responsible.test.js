import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/yoshibet_rg_test";
process.env.PIX_DEMO_AUTOCONFIRM_MS = "0";
process.env.JWT_SECRET = "segredo-de-teste";

const { createApp } = await import("../src/app.js");
const { pool, migrate } = await import("../src/db.js");
const { ensureGames } = await import("../src/services/slots.js");

let server, base, token;

before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate();
  await ensureGames();
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

async function api(method, path, body, tk = token) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(tk ? { authorization: `Bearer ${tk}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function fund(email, cents = 50000) {
  const reg = await api("POST", "/api/auth/register", { name: email.split("@")[0], email, password: "1234" });
  const tk = reg.body.token;
  const dep = await api("POST", "/api/wallet/deposit", { amountCents: cents }, tk);
  await api("POST", `/api/wallet/deposit/${dep.body.txid}/webhook`, null, tk);
  return tk;
}

test("limites começam vazios (sem restrição)", async () => {
  token = await fund("rg1@yoshibet.com");
  const r = await api("GET", "/api/responsible");
  assert.equal(r.status, 200);
  assert.equal(r.body.depositDailyCents, null);
  assert.equal(r.body.excludedPermanent, false);
});

test("limite diário de depósito bloqueia novo PIX acima do teto", async () => {
  await api("PUT", "/api/responsible/limits", { depositDailyCents: 60000 });
  // já depositou 50.000 no fund; +20.000 estoura os 60.000
  const r = await api("POST", "/api/wallet/deposit", { amountCents: 20000 });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /Limite diário de depósito/);
  // um valor dentro do teto passa
  const ok = await api("POST", "/api/wallet/deposit", { amountCents: 5000 });
  assert.equal(ok.status, 201);
});

test("limite de perda diário bloqueia apostas quando atingido", async () => {
  const tk = await fund("rg2@yoshibet.com", 100000);
  token = tk;
  await api("PUT", "/api/responsible/limits", { lossDailyCents: 500 }); // R$ 5 de perda máxima
  // gira o slot da engine até a perda líquida bater no limite
  let blocked = false;
  for (let i = 0; i < 40; i++) {
    const r = await api("POST", "/api/slots/yoshi-fortune/spin", { betCents: 500 });
    if (r.status === 403) { blocked = true; assert.match(r.body.error, /Limite diário de perda/); break; }
    assert.equal(r.status, 200);
  }
  assert.ok(blocked, "o limite de perda deveria bloquear em algum momento");
});

test("autoexclusão temporária bloqueia login, aposta e depósito", async () => {
  const tk = await fund("rg3@yoshibet.com");
  token = tk;
  const ex = await api("POST", "/api/responsible/self-exclude", { days: 7 });
  assert.equal(ex.status, 200);
  assert.ok(ex.body.excludedUntil);

  // aposta bloqueada
  const bet = await api("POST", "/api/slots/yoshi-fortune/spin", { betCents: 100 });
  assert.equal(bet.status, 423);
  // depósito bloqueado
  const dep = await api("POST", "/api/wallet/deposit", { amountCents: 5000 });
  assert.equal(dep.status, 423);
  // login bloqueado
  const login = await api("POST", "/api/auth/login", { email: "rg3@yoshibet.com", password: "1234" }, null);
  assert.equal(login.status, 423);
  assert.match(login.body.error, /autoexcluída/i);
});

test("autoexclusão permanente é persistente e bloqueia login", async () => {
  const tk = await fund("rg4@yoshibet.com");
  token = tk;
  await api("POST", "/api/responsible/self-exclude", { permanent: true });
  const login = await api("POST", "/api/auth/login", { email: "rg4@yoshibet.com", password: "1234" }, null);
  assert.equal(login.status, 423);
  assert.match(login.body.error, /permanente/i);
});

test("limites não vazam entre usuários", async () => {
  const tkA = await fund("rg5@yoshibet.com");
  token = tkA;
  await api("PUT", "/api/responsible/limits", { depositDailyCents: 1 });
  const tkB = await fund("rg6@yoshibet.com"); // usuário B sem limite
  token = tkB;
  const r = await api("GET", "/api/responsible");
  assert.equal(r.body.depositDailyCents, null);
});
