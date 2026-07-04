import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db.js";

export function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Faça login para continuar" });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.prepare("SELECT id, name, email, balance_cents, role FROM users WHERE id = ?").get(payload.sub);
    if (!user) return res.status(401).json({ error: "Sessão inválida" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Sessão expirada, entre novamente" });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Acesso restrito à administração" });
  }
  next();
}
