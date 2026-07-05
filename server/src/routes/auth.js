import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { config } from "../config.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { ApiError, wrap } from "../middleware/error.js";

export const authRouter = Router();

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  balanceCents: u.balance_cents,
  role: u.role,
});

authRouter.post("/register", wrap(async (req, res) => {
  const { name, password } = req.body || {};
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!name || String(name).trim().length < 3) throw new ApiError(400, "Nome deve ter ao menos 3 caracteres");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, "E-mail inválido");
  if (!password || String(password).length < 4) throw new ApiError(400, "Senha deve ter ao menos 4 caracteres");

  const hash = await bcrypt.hash(String(password), 10);
  const role = email === config.adminEmail ? "admin" : "user";

  let user;
  try {
    const { rows } = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *",
      [String(name).trim(), email, hash, role]
    );
    user = rows[0];
  } catch (err) {
    if (err.code === "23505") throw new ApiError(409, "Este e-mail já está cadastrado");
    throw err;
  }

  res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
}));

authRouter.post("/login", wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(req.body?.password || ""), user.password_hash))) {
    throw new ApiError(401, "E-mail ou senha incorretos");
  }
  res.json({ token: signToken(user.id), user: publicUser(user) });
}));

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});
