/**
 * Seed de dados demo para o dashboard: usuários, depósitos, saques,
 * rodadas de cassino e apostas esportivas espalhados pelos últimos 14 dias.
 *
 *   node scripts/seed.js
 *
 * Cria também a conta admin (ADMIN_EMAIL, senha admin123) se não existir.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool, withTx, migrate } from "../src/db.js";
import { config } from "../src/config.js";

const rnd = (n) => crypto.randomInt(n);
const pick = (arr) => arr[rnd(arr.length)];

const FIRST = ["Lucas", "Maria", "João", "Ana", "Pedro", "Julia", "Carlos", "Fernanda", "Rafael", "Beatriz", "Gustavo", "Camila", "Diego", "Larissa", "Bruno", "Patrícia", "Thiago", "Amanda", "Felipe", "Vanessa"];
const LAST = ["Silva", "Santos", "Oliveira", "Souza", "Costa", "Pereira", "Almeida", "Ferreira", "Rodrigues", "Gomes"];

const DAYS = 14;
const MATCH_IDS = ["wc-r16-1", "wc-r16-2", "wc-r16-3", "wc-r16-4", "wc-r16-5", "wc-r16-6", "wc-r16-7", "wc-r16-8"];
const PICKS = ["home", "draw", "away"];

await migrate();
const passwordHash = bcrypt.hashSync("demo1234", 10);

const daysAgoTs = (d) => `now() - interval '${d} days'`;

const result = await withTx(async (c) => {
  // Conta admin
  const { rows: adm } = await c.query("SELECT 1 FROM users WHERE email = $1", [config.adminEmail]);
  if (!adm.length) {
    await c.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')",
      ["Administrador", config.adminEmail, bcrypt.hashSync("admin123", 10)]
    );
  }

  let users = 0, deposits = 0, rounds = 0, bets = 0;

  for (let i = 0; i < 42; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const email = `demo${Date.now().toString(36)}${i}@yoshibet.demo`;
    const signupDaysAgo = rnd(DAYS);
    const { rows } = await c.query(
      `INSERT INTO users (name, email, password_hash, created_at) VALUES ($1, $2, $3, ${daysAgoTs(signupDaysAgo)}) RETURNING id`,
      [name, email, passwordHash]
    );
    const userId = rows[0].id;
    users++;

    const insertTx = (type, amount, meta, d) =>
      c.query(
        `INSERT INTO transactions (user_id, type, amount_cents, meta, created_at) VALUES ($1, $2, $3, $4, ${daysAgoTs(d)})`,
        [userId, type, amount, meta]
      );

    let balance = 0;
    const nDeposits = 1 + rnd(3);
    for (let d = 0; d < nDeposits; d++) {
      const daysAgo = Math.min(signupDaysAgo, rnd(DAYS));
      const amount = pick([2000, 3000, 5000, 5000, 10000, 10000, 20000, 50000]);
      await insertTx("deposit", amount, null, daysAgo);
      balance += amount;
      deposits++;
      if (d === 0) {
        const bonus = Math.min(amount, config.bonus.firstDepositCapCents);
        await insertTx("bonus", bonus, { reason: "first_deposit" }, daysAgo);
        balance += bonus;
      }
    }

    // Rodadas de cassino com RTP ~94%
    const nRounds = 6 + rnd(30);
    for (let r = 0; r < nRounds; r++) {
      const daysAgo = rnd(DAYS);
      const game = pick(["slot", "slot", "mines"]);
      const bet = pick([100, 100, 200, 500, 500, 1000, 2500]);
      const winRoll = rnd(100);
      let win = 0;
      if (winRoll < 8) win = bet * (2 + rnd(18));
      else if (winRoll < 40) win = Math.floor(bet * (0.4 + rnd(16) / 10));
      const seed = crypto.randomBytes(8).toString("hex");
      await c.query(
        `INSERT INTO rounds (user_id, game, bet_cents, win_cents, status, detail, server_seed, seed_hash, created_at, settled_at)
         VALUES ($1, $2, $3, $4, 'settled', '{}', $5, $6, ${daysAgoTs(daysAgo)}, ${daysAgoTs(daysAgo)})`,
        [userId, game, bet, win, seed, crypto.createHash("sha256").update(seed).digest("hex")]
      );
      await insertTx("bet", -bet, { game }, daysAgo);
      balance -= bet;
      if (win > 0) {
        await insertTx("win", win, { game }, daysAgo);
        balance += win;
      }
      rounds++;
      if (balance < 2500) break;
    }

    // Apostas na Copa
    if (rnd(10) < 7 && balance > 2000) {
      const nBets = 1 + rnd(3);
      for (let b = 0; b < nBets && balance > 1500; b++) {
        const daysAgo = rnd(4);
        const matchId = pick(MATCH_IDS);
        const pickSide = pick(PICKS);
        const odds = 1.4 + rnd(45) / 10;
        const stake = pick([500, 1000, 1000, 2000, 5000]);
        await c.query(
          `INSERT INTO sport_bets (user_id, match_id, pick, odds, stake_cents, potential_win_cents, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, ${daysAgoTs(daysAgo)})`,
          [userId, matchId, pickSide, Number(odds.toFixed(2)), stake, Math.floor(stake * odds)]
        );
        await insertTx("bet", -stake, { sport: true, matchId }, daysAgo);
        balance -= stake;
        bets++;
      }
    }

    // Alguns sacam parte do saldo
    if (balance > 10000 && rnd(10) < 4) {
      const amount = Math.floor((balance * 0.4) / 100) * 100;
      await insertTx("withdraw", -amount, { pixKey: email }, rnd(5));
      await c.query(
        "INSERT INTO withdrawals (user_id, amount_cents, pix_key, status, paid_at) VALUES ($1, $2, $3, 'paid', now())",
        [userId, amount, email]
      );
      balance -= amount;
    }

    await c.query("UPDATE users SET balance_cents = $1 WHERE id = $2", [Math.max(0, balance), userId]);
  }

  return { users, deposits, rounds, bets };
});

console.log(`✅ Seed concluído: ${result.users} usuários, ${result.deposits} depósitos, ${result.rounds} rodadas, ${result.bets} apostas esportivas`);
console.log(`   Admin: ${config.adminEmail} / senha: admin123`);
await pool.end();
