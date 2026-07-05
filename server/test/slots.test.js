import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/yoshibet_slots_test";
process.env.PIX_DEMO_AUTOCONFIRM_MS = "0";
process.env.JWT_SECRET = "segredo-de-teste";
process.env.ADMIN_EMAIL = "chefe@yoshibet.com";

const { createApp } = await import("../src/app.js");
const { pool, migrate } = await import("../src/db.js");
const { ensureGames } = await import("../src/services/slots.js");
const { playSpin, ProvablyFairRNG, hashServerSeed } = await import(
  "../../packages/slots-engine/dist/src/index.js"
);

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

test("setup: cadastro + saldo via webhook PIX", async () => {
  const r = await api("POST", "/api/auth/register", {
    name: "Spinner",
    email: "spinner@yoshibet.com",
    password: "1234",
  });
  token = r.body.token;
  const dep = await api("POST", "/api/wallet/deposit", { amountCents: 10000 });
  await api("POST", `/api/wallet/deposit/${dep.body.txid}/webhook`);
  const w = await api("GET", "/api/wallet");
  assert.equal(w.body.balanceCents, 20000); // 100 + bônus 100
});

test("catálogo público expõe o Yoshi Fortune com config completa", async () => {
  const saved = token;
  token = null;
  const r = await api("GET", "/api/slots/games");
  token = saved;
  assert.equal(r.status, 200);
  const game = r.body.games.find((g) => g.id === "yoshi-fortune");
  assert.ok(game, "yoshi-fortune publicado");
  assert.equal(game.config.targetRtp, 0.965);
  assert.equal(game.config.rows * game.config.cols, 9);
});

test("seeds: hash publicado antes de qualquer spin; nonce começa em 0", async () => {
  const r = await api("GET", "/api/fair/seeds");
  assert.equal(r.status, 200);
  assert.equal(r.body.serverSeedHash.length, 64);
  assert.equal(r.body.nonce, 0);
});

let firstSpin;

test("spin: debita carteira, grava rodada e consome o nonce", async () => {
  const before_ = (await api("GET", "/api/wallet")).body.balanceCents;
  const r = await api("POST", "/api/slots/yoshi-fortune/spin", { betCents: 500 });
  assert.equal(r.status, 200);
  firstSpin = r.body;

  assert.equal(r.body.fair.nonce, 0, "primeiro spin usa nonce 0");
  assert.equal(r.body.result.grid.length, 9);
  assert.equal(r.body.balanceCents, before_ - 500 + r.body.payoutCents);

  const seeds = await api("GET", "/api/fair/seeds");
  assert.equal(seeds.body.nonce, 1, "nonce incrementado após o spin");

  const rounds = await api("GET", "/api/slots/rounds");
  assert.equal(rounds.body.rounds.length, 1);
});

test("verificação pública: antes da rotação NÃO expõe o server seed", async () => {
  const saved = token;
  token = null; // endpoint é público
  const r = await api("GET", `/api/slots/verify/${firstSpin.roundId}`);
  token = saved;
  assert.equal(r.status, 200);
  assert.equal(r.body.fair.serverSeed, null, "seed só aparece após rotação");
  assert.equal(r.body.fair.serverSeedHash, firstSpin.fair.serverSeedHash);
  assert.deepEqual(r.body.result, firstSpin.result);
});

test("PROVABLY FAIR fim-a-fim: rotaciona, revela e REPRODUZ a rodada com a engine", async () => {
  const rot = await api("POST", "/api/fair/rotate", { clientSeed: "meu-novo-seed" });
  assert.equal(rot.status, 200);
  const revealed = rot.body.revealed;

  // 1. o seed revelado bate com o compromisso publicado antes das rodadas
  assert.equal(hashServerSeed(revealed.serverSeed), revealed.serverSeedHash);
  assert.equal(revealed.serverSeedHash, firstSpin.fair.serverSeedHash);

  // 2. o endpoint público agora expõe o seed
  const saved = token;
  token = null;
  const v = await api("GET", `/api/slots/verify/${firstSpin.roundId}`);
  token = saved;
  assert.equal(v.body.fair.serverSeed, revealed.serverSeed);

  // 3. auditoria independente: recomputa o spin fora do servidor e compara
  const rng = new ProvablyFairRNG(
    v.body.fair.serverSeed,
    v.body.fair.clientSeed,
    v.body.fair.nonce
  );
  const recomputed = playSpin(v.body.gameConfig, rng);
  assert.deepEqual(recomputed, v.body.result, "resultado reproduzido de forma independente");

  // 4. novo par ativo, nonce zerado
  assert.equal(rot.body.current.nonce, 0);
  assert.notEqual(rot.body.current.serverSeedHash, revealed.serverSeedHash);
});

test("free spins: prêmio de scatter cria spins grátis que não debitam a carteira", async () => {
  // injeta free spins na sessão (o gatilho natural é raro demais para teste)
  const { rows } = await pool.query("SELECT id FROM users WHERE email = 'spinner@yoshibet.com'");
  await pool.query(
    `INSERT INTO slot_sessions (user_id, game_id, free_spins_left, free_spin_bet_cents)
     VALUES ($1, 'yoshi-fortune', 2, 300)
     ON CONFLICT (user_id, game_id) DO UPDATE SET free_spins_left = 2, free_spin_bet_cents = 300`,
    [rows[0].id]
  );

  const before_ = (await api("GET", "/api/wallet")).body.balanceCents;
  const r = await api("POST", "/api/slots/yoshi-fortune/spin", { betCents: 9999 });
  assert.equal(r.status, 200);
  assert.equal(r.body.isFreeSpin, true);
  assert.equal(r.body.betCents, 300, "free spin usa a aposta que o disparou");
  assert.ok(r.body.freeSpinsLeft >= 1);
  assert.equal(
    r.body.balanceCents,
    before_ + r.body.payoutCents,
    "free spin não debita a carteira"
  );
});

test("aposta fora dos limites é recusada", async () => {
  // zera os free spins para validar o caminho pago
  const { rows } = await pool.query("SELECT id FROM users WHERE email = 'spinner@yoshibet.com'");
  await pool.query(
    "UPDATE slot_sessions SET free_spins_left = 0 WHERE user_id = $1",
    [rows[0].id]
  );
  const r = await api("POST", "/api/slots/yoshi-fortune/spin", { betCents: 999999 });
  assert.equal(r.status, 400);
});

test("spin exige autenticação; jogo inexistente dá 404", async () => {
  const saved = token;
  token = null;
  const anon = await api("POST", "/api/slots/yoshi-fortune/spin", { betCents: 100 });
  assert.equal(anon.status, 401);
  token = saved;
  const missing = await api("POST", "/api/slots/nao-existe/spin", { betCents: 100 });
  assert.equal(missing.status, 404);
});

test("RLS habilitado em todas as tabelas (defesa em profundidade)", async () => {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables t
     WHERE schemaname = 'public'
       AND NOT EXISTS (
         SELECT 1 FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = t.tablename AND c.relrowsecurity
       )`
  );
  assert.deepEqual(rows, [], `tabelas sem RLS: ${rows.map((r) => r.tablename).join(", ")}`);
});

test("nonce nunca repete sob spins concorrentes (lock no par de seeds)", async () => {
  const spins = await Promise.all(
    Array.from({ length: 6 }, () =>
      api("POST", "/api/slots/yoshi-fortune/spin", { betCents: 50 })
    )
  );
  const ok = spins.filter((s) => s.status === 200);
  assert.equal(ok.length, 6);
  const nonces = ok.map((s) => s.body.fair.nonce);
  assert.equal(new Set(nonces).size, nonces.length, `nonces duplicados: ${nonces}`);
});

test("snapshot de RTP grava no rtp_audit_log", async () => {
  const { snapshotRtp } = await import("../src/services/slots.js");
  const snaps = await snapshotRtp("test");
  assert.ok(snaps.length >= 1);
  const { rows } = await pool.query("SELECT * FROM rtp_audit_log ORDER BY id DESC LIMIT 1");
  assert.equal(rows[0].game_id, "yoshi-fortune");
  assert.ok(Number(rows[0].rounds) >= 8);
});

/* ============ BLOCO 4: BACKOFFICE ============ */

let adminToken;

test("backoffice: overview de RTP por jogo (admin only)", async () => {
  const denied = await api("GET", "/api/admin/slots/overview");
  assert.equal(denied.status, 403);

  const reg = await api("POST", "/api/auth/register", {
    name: "Chefe", email: "chefe@yoshibet.com", password: "supersegura",
  });
  adminToken = reg.body.token;

  const saved = token;
  token = adminToken;
  const r = await api("GET", "/api/admin/slots/overview");
  token = saved;
  assert.equal(r.status, 200);
  const yf = r.body.games.find((g) => g.id === "yoshi-fortune");
  assert.ok(yf);
  assert.equal(Number(yf.target_rtp), 0.965);
  assert.ok(Number(yf.rounds) >= 8, "rodadas dos testes anteriores contabilizadas");
  assert.ok(yf.realizedRtp === null || typeof yf.realizedRtp === "number");
});

test("backoffice: config inválida é rejeitada pela engine na publicação", async () => {
  const saved = token;
  token = adminToken;
  const r = await api("PUT", "/api/admin/slots/games/yoshi-fortune/config", {
    config: { name: "Quebrado", rows: 3, cols: 3, symbols: [], reels: [], paylines: [], paytable: [], targetRtp: 0.9, volatility: "medium" },
  });
  token = saved;
  assert.equal(r.status, 400);
  assert.match(r.body.error, /GameConfig inválido/);
});

test("backoffice: publicar config vàlida gera v2 com autor no histórico", async () => {
  const saved = token;
  token = adminToken;
  const games = await api("GET", "/api/slots/games");
  const cfg = games.body.games.find((g) => g.id === "yoshi-fortune").config;
  cfg.paytable = cfg.paytable.map((p) => (p.symbol === "bell" ? { ...p, multiplier: 1.2 } : p));

  const pub = await api("PUT", "/api/admin/slots/games/yoshi-fortune/config", { config: cfg });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.version, 2);
  assert.equal(pub.body.changedBy, "chefe@yoshibet.com");

  const vers = await api("GET", "/api/admin/slots/games/yoshi-fortune/versions");
  token = saved;
  assert.ok(vers.body.versions.length >= 2, "v1 (boot) + v2 no histórico");
  assert.equal(vers.body.versions[0].version, 2);
  assert.equal(vers.body.versions[0].changed_by, "chefe@yoshibet.com");

  // spins novos usam a versão nova
  const spin = await api("POST", "/api/slots/yoshi-fortune/spin", { betCents: 100 });
  assert.equal(spin.body.gameVersion, 2);
});

test("backoffice: log de auditoria lista rodadas de todas as contas", async () => {
  const saved = token;
  token = adminToken;
  const r = await api("GET", "/api/admin/slots/rounds?limit=10");
  token = saved;
  assert.equal(r.status, 200);
  assert.ok(r.body.rounds.length >= 5);
  const round = r.body.rounds[0];
  assert.ok(round.user_name && round.server_seed_hash && round.nonce != null);
});

test("backoffice: desativar jogo bloqueia spins; reativar libera", async () => {
  const saved = token;
  token = adminToken;
  await api("POST", "/api/admin/slots/games/yoshi-fortune/toggle", { active: false });
  token = saved;

  const blocked = await api("POST", "/api/slots/yoshi-fortune/spin", { betCents: 100 });
  assert.equal(blocked.status, 404);

  token = adminToken;
  await api("POST", "/api/admin/slots/games/yoshi-fortune/toggle", { active: true });
  token = saved;
  const ok = await api("POST", "/api/slots/yoshi-fortune/spin", { betCents: 100 });
  assert.equal(ok.status, 200);
});

/* ============ JACKPOT / STATS PÚBLICOS ============ */

test("jackpot cresce 1% a cada aposta paga da engine", async () => {
  const before_ = (await api("GET", "/api/stats/jackpot")).body.amountCents;
  await api("POST", "/api/slots/yoshi-fortune/spin", { betCents: 1000 });
  const after_ = (await api("GET", "/api/stats/jackpot")).body.amountCents;
  assert.equal(after_, before_ + 10, "R$ 10,00 de aposta → +R$ 0,10 no pote");
});

test("stats públicos: ganhos reais mascarados e corrida diária", async () => {
  const saved = token;
  token = null;
  const wins = await api("GET", "/api/stats/live-wins");
  assert.equal(wins.status, 200);
  for (const w of wins.body.wins) {
    assert.match(w.player, /^.{2}\*\*\*$/, "nome mascarado");
  }
  const race = await api("GET", "/api/stats/race");
  token = saved;
  assert.equal(race.status, 200);
  assert.ok(race.body.ranking.length >= 1, "spinner apostou hoje");
  assert.match(race.body.ranking[0].player, /\*\*\*$/);
});
