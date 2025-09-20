// src/routes/auth.js
import express from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { requireAuth } from "../middlewares/auth.js";
const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /auth/login
router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const user = await User.findOne({ username: username?.toLowerCase() });

  if (!user || !user.isActive)
    return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { sub: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("auth", token, {
    httpOnly: true,
    secure: isProd, // 🔑 false on localhost (HTTP), true in prod (HTTPS)
    sameSite: "lax",
    domain: isProd ? ".itjobsfactory.com" : undefined, // 🔑 DO NOT set domain on localhost
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({
    ok: true,
    user: { id: user._id, name: user.name, role: user.role },
  });
});

// POST /auth/logout
router.post("/logout", (_req, res) => {
  res.clearCookie("auth", { httpOnly: true, secure: true, sameSite: "lax" });
  res.json({ ok: true });
});
// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).select("_id name role").lean();
  if (!user) return res.status(401).json({ error: "Unauthenticated" });
  res.json({
    ok: true,
    user: { id: String(user._id), name: user.name, role: user.role },
  });
});
export default router;
