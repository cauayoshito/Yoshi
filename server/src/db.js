import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Livro-razão: toda movimentação de saldo passa por aqui
  CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    type         TEXT NOT NULL CHECK (type IN ('deposit','bonus','withdraw','bet','win')),
    amount_cents INTEGER NOT NULL,           -- positivo = crédito, negativo = débito
    meta         TEXT,                       -- JSON livre (txid, jogo, round etc.)
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id DESC);

  CREATE TABLE IF NOT EXISTS pix_charges (
    txid         TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired')),
    brcode       TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL,
    pix_key      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at      TEXT
  );

  -- Rodadas de jogo (slot e mines); estado do mines fica aqui, no servidor
  CREATE TABLE IF NOT EXISTS rounds (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    game         TEXT NOT NULL CHECK (game IN ('slot','mines')),
    bet_cents    INTEGER NOT NULL,
    win_cents    INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','settled')),
    detail       TEXT,                       -- JSON: grid, bombas, células reveladas…
    server_seed  TEXT,                       -- provably fair
    seed_hash    TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    settled_at   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_rounds_user ON rounds(user_id, id DESC);
`);
