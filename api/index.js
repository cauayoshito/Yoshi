/**
 * Função serverless da Vercel: toda rota /api/* cai aqui (vercel.json).
 * O Express roda dentro da função; os estáticos ficam com a Vercel.
 */
import { createApp } from "../server/src/app.js";
import { migrate } from "../server/src/db.js";

const ready = migrate().then(() => createApp());

export default async function handler(req, res) {
  const app = await ready;
  return app(req, res);
}
