/**
 * Seed de dados demo para o dashboard: usuários, depósitos, saques,
 * rodadas de cassino e apostas esportivas espalhados pelos últimos 14 dias.
 *
 *   node scripts/seed.js          # adiciona dados demo
 *   node scripts/seed.js --fresh  # apaga o banco antes
 *
 * Cria também a conta admin (ADMIN_EMAIL, senha admin123) se não existir.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

if (process.argv.includes("--fresh")) {
  const { config } = await import("../src/config.js");
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(config.dbPath + suffix, { force: true });
  }
}

const { db } = await import("../src/db.js");
const { config } = await import("../src/config.js");

const rnd = (n) => crypto.randomInt(n);
const pick = (arr) => arr[rnd(arr.length)];

const FIRST = ["Lucas", "Maria", "João", "Ana", "Pedro", "Julia", "Carlos", "Fernanda", "Rafael", "Beatriz", "Gustavo", "Camila", "Diego", "Larissa", "Bruno", "Patrícia", "Thiago", "Amanda", "Felipe", "Vanessa"];
const LAST = ["Silva", "Santos", "Oliveira", "Souza", "Costa", "Pereira", "Almeida", "Ferreira", "Rodrigues", "Gomes"];

const DAYS = 14;
const passwordHash = bcrypt.hashSync("demo1234", 10);

const insertUser = db.prepare(
  "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))"
);
const insertTx = db.prepare(
  "INSERT INTO transactions (user_id, type, amount_cents, meta, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))"
);
const insertRound = db.prepare(
  `INSERT INTO rounds (user_id, game, bet_cents, win_cents, status, detail, server_seed, seed_hash, created_at, settled_at)
   VALUES (?, ?, ?, ?, 'settled', '{}', ?, ?, datetime('now', ?), datetime('now', ?))`
);
const insertSportBet = db.prepare(
  `INSERT INTO sport_bets (user_id, match_id, pick, odds, stake_cents, potential_win_cents, status, created_at)
   VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now', ?))`
);
const addBalance = db.prepare("UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?");

const MATCH_IDS = ["wc-r16-1", "wc-r16-2", "wc-r16-3", "wc-r16-4", "wc-r16-5", "wc-r16-6", "wc-r16-7", "wc-r16-8"];
const PICKS = ["home", "draw", "away"];

const seedAll = db.transaction(() => {
  // Conta admin
  const adminExists = db.prepare("SELECT 1 FROM users WHERE email = ?").get(config.adminEmail);
  if (!adminExists) {
    insertUser.run("Administrador", config.adminEmail, bcrypt.hashSync("admin123", 10), "admin", "-0 days");
  }

  let users = 0, deposits = 0, rounds = 0, bets = 0;

  for (let i = 0; i < 42; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const email = `demo${Date.now().toString(36)}${i}@yoshibet.demo`;
    const signupDaysAgo = rnd(DAYS);
    const info = insertUser.run(name, email, passwordHash, "user", `-${signupDaysAgo} days`);
    const userId = info.lastInsertRowid;
    users++;

    let balance = 0;
    const nDeposits = 1 + rnd(3);
    for (let d = 0; d < nDeposits; d++) {
      const daysAgo = Math.min(signupDaysAgo, rnd(DAYS));
      const amount = pick([2000, 3000, 5000, 5000, 10000, 10000, 20000, 50000]);
      const off = `-${daysAgo} days`;
      insertTx.run(userId, "deposit", amount, null, off);
      balance += amount;
      deposits++;
      if (d === 0) {
        const bonus = Math.min(amount, config.bonus.firstDepositCapCents);
        insertTx.run(userId, "bonus", bonus, JSON.stringify({ reason: "first_deposit" }), off);
        balance += bonus;
      }
    }

    // Rodadas de cassino com RTP ~94%
    const nRounds = 6 + rnd(30);
    for (let r = 0; r < nRounds; r++) {
      const daysAgo = rnd(DAYS);
      const off = `-${daysAgo} days`;
      const game = pick(["slot", "slot", "mines"]);
      const bet = pick([100, 100, 200, 500, 500, 1000, 2500]);
      const winRoll = rnd(100);
      let win = 0;
      if (winRoll < 8) win = bet * (2 + rnd(18));       // prêmio grande
      else if (winRoll < 40) win = Math.floor(bet * (0.4 + rnd(16) / 10)); // prêmio pequeno
      const seed = crypto.randomBytes(8).toString("hex");
      insertRound.run(userId, game, bet, win, seed, crypto.createHash("sha256").update(seed).digest("hex"), off, off);
      insertTx.run(userId, "bet", -bet, JSON.stringify({ game }), off);
      balance -= bet;
      if (win > 0) {
        insertTx.run(userId, "win", win, JSON.stringify({ game }), off);
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
        const off = `-${daysAgo} days`;
        const matchId = pick(MATCH_IDS);
        const pickSide = pick(PICKS);
        const odds = 1.4 + rnd(45) / 10;
        const stake = pick([500, 1000, 1000, 2000, 5000]);
        insertSportBet.run(userId, matchId, pickSide, Number(odds.toFixed(2)), stake, Math.floor(stake * odds), off);
        insertTx.run(userId, "bet", -stake, JSON.stringify({ sport: true, matchId }), off);
        balance -= stake;
        bets++;
      }
    }

    // Alguns sacam parte do saldo
    if (balance > 10000 && rnd(10) < 4) {
      const amount = Math.floor(balance * 0.4 / 100) * 100;
      insertTx.run(userId, "withdraw", -amount, JSON.stringify({ pixKey: email }), `-${rnd(5)} days`);
      db.prepare(
        "INSERT INTO withdrawals (user_id, amount_cents, pix_key, status, paid_at) VALUES (?, ?, ?, 'paid', datetime('now'))"
      ).run(userId, amount, email);
      balance -= amount;
    }

    addBalance.run(Math.max(0, balance), userId);
  }

  return { users, deposits, rounds, bets };
});

const r = seedAll();
console.log(`✅ Seed concluído: ${r.users} usuários, ${r.deposits} depósitos, ${r.rounds} rodadas, ${r.bets} apostas esportivas`);
console.log(`   Admin: ${config.adminEmail} / senha: admin123`);
