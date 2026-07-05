import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || "dev-secret-nao-use-em-producao",
  jwtExpiresIn: "7d",
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5432/yoshibet",
  isServerless: !!process.env.VERCEL,
  cronSecret: process.env.CRON_SECRET || "",

  pix: {
    key: process.env.PIX_KEY || "pagamentos@yoshibet.com.br",
    merchantName: process.env.PIX_MERCHANT_NAME || "YOSHI BET",
    merchantCity: process.env.PIX_MERCHANT_CITY || "SAO PAULO",
    demoAutoconfirmMs: Number(process.env.PIX_DEMO_AUTOCONFIRM_MS ?? 4000),
  },

  bonus: {
    firstDepositPct: Number(process.env.FIRST_DEPOSIT_BONUS_PCT ?? 100),
    firstDepositCapCents: Number(process.env.FIRST_DEPOSIT_BONUS_CAP_CENTS ?? 50000),
  },

  limits: {
    minDepositCents: 2000,      // R$ 20
    maxDepositCents: 1000000,   // R$ 10.000
    minBetCents: 50,            // R$ 0,50
    maxBetCents: 5000,          // R$ 50
    minWithdrawCents: 2000,     // R$ 20
  },

  adminEmail: (process.env.ADMIN_EMAIL || "admin@yoshibet.com").toLowerCase(),

  staticRoot: path.resolve(__dirname, "..", ".."),
};
