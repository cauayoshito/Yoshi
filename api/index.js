/**
 * Função serverless da Vercel: toda rota /api/* cai aqui (vercel.json).
 * O Express roda dentro da função; os estáticos ficam com a Vercel.
 */
import { createApp } from "../server/src/app.js";
import { migrate } from "../server/src/db.js";
import { ensureGames } from "../server/src/services/slots.js";

const ready = migrate()
  .then(() => ensureGames())
  .then(() => createApp());

export default async function handler(req, res) {
  const app = await ready;
  return app(req, res);
}
