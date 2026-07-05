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

    /* ============ Slots Engine (Bloco 2) ============ */

    -- Catálogo de jogos da engine: config declarativa versionada
    CREATE TABLE IF NOT EXISTS slot_games (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      config     JSONB NOT NULL,
      version    INT NOT NULL DEFAULT 1,
      active     BOOLEAN NOT NULL DEFAULT true,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Par de seeds provably fair por usuário (modelo Stake):
    -- hash publicado antes; server_seed revelado só ao rotacionar.
    CREATE TABLE IF NOT EXISTS fair_seeds (
      id               BIGSERIAL PRIMARY KEY,
      user_id          BIGINT NOT NULL REFERENCES users(id),
      server_seed      TEXT NOT NULL,
      server_seed_hash TEXT NOT NULL,
      client_seed      TEXT NOT NULL,
      nonce            BIGINT NOT NULL DEFAULT 0,
      active           BOOLEAN NOT NULL DEFAULT true,
      revealed_at      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fair_seeds_active
      ON fair_seeds(user_id) WHERE active;

    -- Rodadas da engine: trilha de auditoria completa e verificável
    CREATE TABLE IF NOT EXISTS slot_rounds (
      id            BIGSERIAL PRIMARY KEY,
      user_id       BIGINT NOT NULL REFERENCES users(id),
      game_id       TEXT NOT NULL REFERENCES slot_games(id),
      game_version  INT NOT NULL,
      fair_seed_id  BIGINT NOT NULL REFERENCES fair_seeds(id),
      nonce         BIGINT NOT NULL,
      bet_cents     BIGINT NOT NULL,
      payout_cents  BIGINT NOT NULL,
      is_free_spin  BOOLEAN NOT NULL DEFAULT false,
      result        JSONB NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_slot_rounds_user ON slot_rounds(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_slot_rounds_game ON slot_rounds(game_id, id DESC);

    -- Sessão por usuário+jogo: free spins pendentes e agregados
    CREATE TABLE IF NOT EXISTS slot_sessions (
      user_id           BIGINT NOT NULL REFERENCES users(id),
      game_id           TEXT NOT NULL REFERENCES slot_games(id),
      free_spins_left   INT NOT NULL DEFAULT 0,
      free_spin_bet_cents BIGINT NOT NULL DEFAULT 0,
      total_bet_cents   BIGINT NOT NULL DEFAULT 0,
      total_payout_cents BIGINT NOT NULL DEFAULT 0,
      rounds            BIGINT NOT NULL DEFAULT 0,
      last_played_at    TIMESTAMPTZ,
      PRIMARY KEY (user_id, game_id)
    );

    -- Histórico de versões de config (quem alterou, o quê, quando)
    CREATE TABLE IF NOT EXISTS slot_game_versions (
      id         BIGSERIAL PRIMARY KEY,
      game_id    TEXT NOT NULL REFERENCES slot_games(id),
      version    INT NOT NULL,
      config     JSONB NOT NULL,
      changed_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sgv_game ON slot_game_versions(game_id, version DESC);

    -- Snapshots de RTP para due diligence de operador/regulador
    CREATE TABLE IF NOT EXISTS rtp_audit_log (
      id                 BIGSERIAL PRIMARY KEY,
      game_id            TEXT NOT NULL,
      game_version       INT NOT NULL,
      rounds             BIGINT NOT NULL,
      total_bet_cents    BIGINT NOT NULL,
      total_payout_cents BIGINT NOT NULL,
      rtp                NUMERIC(8,5),
      target_rtp         NUMERIC(8,5),
      source             TEXT NOT NULL DEFAULT 'cron',
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Defesa em profundidade: RLS ligado em tudo, sem policies para os
  // papéis do PostgREST (anon/authenticated ficam com negação total).
  // Nossa API conecta como owner e não é afetada — a autorização real
  // acontece na camada Express (JWT + requireAdmin).
  await pool.query(`
    DO $$
    DECLARE t TEXT;
    BEGIN
      FOR t IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      END LOOP;
    END $$;
  `);

  migrated = true;
}
