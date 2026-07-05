import pg from "pg";
import { config } from "./config.js";

// int8/numeric chegam como string por padrão — nossos valores cabem em Number
pg.types.setTypeParser(20, (v) => Number(v));      // BIGINT
pg.types.setTypeParser(1700, (v) => Number(v));    // NUMERIC

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.isServerless ? 3 : 10,
  // Supabase exige TLS; localhost não usa
  ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl) ? false : { rejectUnauthorized: false },
});

export const query = (text, params) => pool.query(text, params);

/** Executa fn dentro de uma transação (BEGIN/COMMIT/ROLLBACK). */
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Migração idempotente — roda no boot (local, Railway e Vercel). */
let migrated = false;
export async function migrate() {
  if (migrated) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            BIGSERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
      role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Livro-razão: toda movimentação de saldo passa por aqui
    CREATE TABLE IF NOT EXISTS transactions (
      id           BIGSERIAL PRIMARY KEY,
      user_id      BIGINT NOT NULL REFERENCES users(id),
      type         TEXT NOT NULL CHECK (type IN ('deposit','bonus','withdraw','bet','win')),
      amount_cents BIGINT NOT NULL,
      meta         JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);

    CREATE TABLE IF NOT EXISTS pix_charges (
      txid         TEXT PRIMARY KEY,
      user_id      BIGINT NOT NULL REFERENCES users(id),
      amount_cents BIGINT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired')),
      brcode       TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at      TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id           BIGSERIAL PRIMARY KEY,
      user_id      BIGINT NOT NULL REFERENCES users(id),
      amount_cents BIGINT NOT NULL,
      pix_key      TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at      TIMESTAMPTZ
    );

    -- Rodadas de cassino; estado do Mines fica aqui, no servidor
    CREATE TABLE IF NOT EXISTS rounds (
      id           BIGSERIAL PRIMARY KEY,
      user_id      BIGINT NOT NULL REFERENCES users(id),
      game         TEXT NOT NULL CHECK (game IN ('slot','mines')),
      bet_cents    BIGINT NOT NULL,
      win_cents    BIGINT NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','settled')),
      detail       JSONB,
      server_seed  TEXT,
      seed_hash    TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      settled_at   TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_rounds_user ON rounds(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS sport_bets (
      id                  BIGSERIAL PRIMARY KEY,
      user_id             BIGINT NOT NULL REFERENCES users(id),
      match_id            TEXT NOT NULL,
      pick                TEXT NOT NULL CHECK (pick IN ('home','draw','away')),
      odds                NUMERIC(8,2) NOT NULL,
      stake_cents         BIGINT NOT NULL,
      potential_win_cents BIGINT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','won','lost','void')),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      settled_at          TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_sport_bets_user ON sport_bets(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS match_results (
      match_id   TEXT PRIMARY KEY,
      home_score INT NOT NULL,
      away_score INT NOT NULL,
      outcome    TEXT NOT NULL CHECK (outcome IN ('home','draw','away')),
      source     TEXT NOT NULL DEFAULT 'auto',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  migrated = true;
}
