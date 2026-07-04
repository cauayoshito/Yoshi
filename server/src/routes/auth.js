import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { config } from "../config.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { ApiError, wrap } from "../middleware/error.js";

export const authRouter = Router();

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, balanceCents: u.balance_cents, role: u.role });

authRouter.post("/register", wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || String(name).trim().length < 3) throw new ApiError(400, "Nome deve ter ao menos 3 caracteres");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, "E-mail inválido");
  if (!password || String(password).length < 4) throw new ApiError(400, "Senha deve ter ao menos 4 caracteres");

  const exists = db.prepare("SELECT 1 FROM users WHERE email = ?").get(email);
  if (exists) throw new ApiError(409, "Este e-mail já está cadastrado");

  const hash = await bcrypt.hash(String(password), 10);
  const role = String(email).trim().toLowerCase() === config.adminEmail ? "admin" : "user";
  const info = db
    .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)")
    .run(String(name).trim(), String(email).trim(), hash, role);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
}));

authRouter.post("/login", wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || ""));
  if (!user || !(await bcrypt.compare(String(password || ""), user.password_hash))) {
    throw new ApiError(401, "E-mail ou senha incorretos");
  }
  res.json({ token: signToken(user.id), user: publicUser(user) });
}));

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});
