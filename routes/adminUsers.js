// src/routes/adminUsers.js
import express from "express";
import bcrypt from "bcryptjs";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import User from "../models/User.js";

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// POST /admin/users  (create employee or another admin)
router.post("/", async (req, res) => {
  const { username, name, email, password, role = "employee" } = req.body || {};
  const passwordHash = await bcrypt.hash(password, 12);
  const doc = await User.create({
    username: String(username).toLowerCase(),
    name,
    email: email?.toLowerCase(),
    passwordHash,
    role,
    isActive: true,
  });
  res.status(201).json({ id: doc._id });
});

// PATCH /admin/users/:id/status  (enable/disable)
router.patch("/:id/status", async (req, res) => {
  const { isActive } = req.body || {};
  await User.findByIdAndUpdate(req.params.id, { isActive });
  res.json({ ok: true });
});

// POST /admin/users/:id/reset-password
router.post("/:id/reset-password", async (req, res) => {
  const { newPassword } = req.body || {};
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await User.findByIdAndUpdate(req.params.id, { passwordHash });
  res.json({ ok: true });
});
router.get("/users", async (_req, res) => {
  const users = await User.find({})
    .select("_id username name email role isActive createdAt")
    .sort({ createdAt: -1 })
    .lean();
  res.json(users);
});

/**
 * GET /api/admin/users/check?username=&email=
 * quick availability checks for form UX
 */
router.get("/users/check", async (req, res) => {
  const { username, email } = req.query || {};
  const out = { usernameAvailable: true, emailAvailable: true };

  if (username) {
    const u = await User.exists({ username: String(username).toLowerCase() });
    out.usernameAvailable = !u;
  }
  if (email) {
    const e = await User.exists({ email: String(email).toLowerCase() });
    out.emailAvailable = !e;
  }
  res.json(out);
});

/**
 * POST /api/admin/users
 * body: { username, name, email, password, role? }
 */
router.post("/users", async (req, res) => {
  try {
    const {
      username,
      name,
      email,
      password,
      role = "employee",
    } = req.body || {};

    if (!username || !name || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const doc = await User.create({
      username: String(username).toLowerCase().trim(),
      name: name.trim(),
      email: String(email).toLowerCase().trim(),
      passwordHash,
      role,
      isActive: true,
    });

    res.status(201).json({ id: doc._id });
  } catch (err) {
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(409).json({ error: `Duplicate ${key}` });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

/**
 * PATCH /api/admin/users/:id/status
 * body: { isActive: boolean }
 */
router.patch("/users/:id/status", async (req, res) => {
  const { isActive } = req.body || {};
  await User.findByIdAndUpdate(req.params.id, { isActive: !!isActive });
  res.json({ ok: true });
});

/**
 * POST /api/admin/users/:id/reset-password
 * body: { newPassword }
 */
router.post("/users/:id/reset-password", async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res
      .status(400)
      .json({ error: "New password must be at least 8 characters" });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await User.findByIdAndUpdate(req.params.id, { passwordHash });
  res.json({ ok: true });
});

export default router;
