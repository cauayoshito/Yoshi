/**
 * Jogo responsável — exigência PAGCOR e de qualquer regulador sério.
 *
 * - Limites de depósito (diário/semanal): checados ANTES de gerar a cobrança PIX.
 * - Limites de perda (diário/semanal): checados ANTES de cada aposta; perda
 *   líquida = apostas − prêmios no período.
 * - Autoexclusão: temporária (excluded_until) ou permanente. Enquanto ativa,
 *   login e qualquer aposta/depósito são bloqueados.
 * - Reality-check (session_minutes): o front avisa o jogador a cada N minutos.
 *
 * Regra de segurança: reduzir/endurecer um limite vale na hora; afrouxar um
 * limite ou reverter autoexclusão exigiria período de reflexão em produção —
 * aqui deixamos o hook documentado.
 */
import { pool } from "../db.js";
import { ApiError } from "../middleware/error.js";

const EMPTY = {
  depositDailyCents: null,
  depositWeeklyCents: null,
  lossDailyCents: null,
  lossWeeklyCents: null,
  sessionMinutes: null,
  excludedUntil: null,
  excludedPermanent: false,
};

function toPublic(row) {
  if (!row) return { ...EMPTY };
  return {
    depositDailyCents: row.deposit_daily_cents,
    depositWeeklyCents: row.deposit_weekly_cents,
    lossDailyCents: row.loss_daily_cents,
    lossWeeklyCents: row.loss_weekly_cents,
    sessionMinutes: row.session_minutes,
    excludedUntil: row.excluded_until,
    excludedPermanent: row.excluded_permanent,
  };
}

export async function getLimits(userId, client = pool) {
  const { rows } = await client.query("SELECT * FROM responsible_limits WHERE user_id = $1", [userId]);
  return toPublic(rows[0]);
}

/** Status de exclusão (usado no login e antes de apostar/depositar). */
export async function checkNotExcluded(userId, client = pool) {
  const { rows } = await client.query(
    "SELECT excluded_permanent, excluded_until FROM responsible_limits WHERE user_id = $1",
    [userId]
  );
  const r = rows[0];
  if (!r) return;
  if (r.excluded_permanent) throw new ApiError(423, "Conta em autoexclusão permanente. Contate o suporte.");
  if (r.excluded_until && new Date(r.excluded_until) > new Date()) {
    const until = new Date(r.excluded_until).toLocaleString("pt-BR");
    throw new ApiError(423, `Conta autoexcluída até ${until}.`);
  }
}

const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, "Valor de limite inválido");
  return n;
};

export async function setLimits(userId, input) {
  const fields = {
    deposit_daily_cents: numOrNull(input.depositDailyCents),
    deposit_weekly_cents: numOrNull(input.depositWeeklyCents),
    loss_daily_cents: numOrNull(input.lossDailyCents),
    loss_weekly_cents: numOrNull(input.lossWeeklyCents),
    session_minutes: input.sessionMinutes == null ? null : Math.max(0, Math.round(Number(input.sessionMinutes))),
  };
  await pool.query(
    `INSERT INTO responsible_limits
       (user_id, deposit_daily_cents, deposit_weekly_cents, loss_daily_cents, loss_weekly_cents, session_minutes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id) DO UPDATE SET
       deposit_daily_cents = $2, deposit_weekly_cents = $3,
       loss_daily_cents = $4, loss_weekly_cents = $5,
       session_minutes = $6, updated_at = now()`,
    [userId, fields.deposit_daily_cents, fields.deposit_weekly_cents,
     fields.loss_daily_cents, fields.loss_weekly_cents, fields.session_minutes]
  );
  return getLimits(userId);
}

/** Autoexclusão: 'permanent' ou nº de dias (temporária). */
export async function selfExclude(userId, { permanent = false, days = null } = {}) {
  let untilExpr = "NULL";
  const params = [userId];
  if (permanent) {
    await pool.query(
      `INSERT INTO responsible_limits (user_id, excluded_permanent, updated_at)
       VALUES ($1, true, now())
       ON CONFLICT (user_id) DO UPDATE SET excluded_permanent = true, updated_at = now()`,
      [userId]
    );
    return getLimits(userId);
  }
  const d = Math.max(1, Math.round(Number(days) || 1));
  await pool.query(
    `INSERT INTO responsible_limits (user_id, excluded_until, updated_at)
     VALUES ($1, now() + ($2 || ' days')::interval, now())
     ON CONFLICT (user_id) DO UPDATE SET excluded_until = now() + ($2 || ' days')::interval, updated_at = now()`,
    [userId, String(d)]
  );
  return getLimits(userId);
}

/** Bloqueia o depósito se estourar limite diário/semanal. Chamado antes do PIX. */
export async function assertDepositAllowed(userId, amountCents, client = pool) {
  await checkNotExcluded(userId, client);
  const lim = await getLimits(userId, client);
  if (lim.depositDailyCents == null && lim.depositWeeklyCents == null) return;

  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= date_trunc('day', now())), 0)  AS today,
       COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= now() - interval '7 days'), 0) AS week
     FROM transactions WHERE user_id = $1 AND type = 'deposit'`,
    [userId]
  );
  const { today, week } = rows[0];
  if (lim.depositDailyCents != null && today + amountCents > lim.depositDailyCents) {
    throw new ApiError(403, `Limite diário de depósito atingido (R$ ${(lim.depositDailyCents / 100).toFixed(2)}).`);
  }
  if (lim.depositWeeklyCents != null && week + amountCents > lim.depositWeeklyCents) {
    throw new ApiError(403, `Limite semanal de depósito atingido (R$ ${(lim.depositWeeklyCents / 100).toFixed(2)}).`);
  }
}

/** Bloqueia a aposta se a perda líquida no período já atingiu o limite. */
export async function assertBetAllowed(userId, client = pool) {
  await checkNotExcluded(userId, client);
  const lim = await getLimits(userId, client);
  if (lim.lossDailyCents == null && lim.lossWeeklyCents == null) return;

  // perda líquida = (apostas) − (prêmios). type 'bet' é negativo; 'win' positivo.
  const { rows } = await client.query(
    `SELECT
       COALESCE(-SUM(amount_cents) FILTER (WHERE created_at >= date_trunc('day', now())), 0)  AS loss_today,
       COALESCE(-SUM(amount_cents) FILTER (WHERE created_at >= now() - interval '7 days'), 0) AS loss_week
     FROM transactions WHERE user_id = $1 AND type IN ('bet','win')`,
    [userId]
  );
  const { loss_today, loss_week } = rows[0];
  if (lim.lossDailyCents != null && loss_today >= lim.lossDailyCents) {
    throw new ApiError(403, `Limite diário de perda atingido (R$ ${(lim.lossDailyCents / 100).toFixed(2)}). Volte amanhã.`);
  }
  if (lim.lossWeeklyCents != null && loss_week >= lim.lossWeeklyCents) {
    throw new ApiError(403, `Limite semanal de perda atingido (R$ ${(lim.lossWeeklyCents / 100).toFixed(2)}).`);
  }
}
