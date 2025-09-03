// routes/demoUsers.js
import express from "express";
import DemoUser from "../models/DemoUser.js";

const router = express.Router();

/**
 * GET /api/demo-users
 * Optional query: search (by name/email), limit, page
 */
router.get("/", async (req, res) => {
  try {
    const { search = "", page = 1, limit = 20 } = req.query;
    const q = search
      ? {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      DemoUser.find(q).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      DemoUser.countDocuments(q),
    ]);

    res.json({ total, page: Number(page), limit: Number(limit), items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/demo-users/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const doc = await DemoUser.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/demo-users
 * body: { name, email, role?, active? }
 */
router.post("/", async (req, res) => {
  try {
    const doc = new DemoUser(req.body);
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /api/demo-users/:id
 * Replace full document (except _id, timestamps)
 */
router.put("/:id", async (req, res) => {
  try {
    const { name, email, role, active } = req.body;
    if (!name || !email) {
      return res
        .status(400)
        .json({ error: "name and email are required for PUT" });
    }
    const doc = await DemoUser.findByIdAndUpdate(
      req.params.id,
      { name, email, role, active },
      { new: true, runValidators: true, overwrite: true }
    );
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PATCH /api/demo-users/:id
 * Partial update — perfect to demo “change the name”
 */
router.patch("/:id", async (req, res) => {
  try {
    // Whitelist patchable fields
    const allowed = ["name", "email", "role", "active"];
    const update = {};
    for (const k of allowed) {
      if (k in req.body) update[k] = req.body[k];
    }
    const doc = await DemoUser.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/demo-users/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const doc = await DemoUser.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, deletedId: doc._id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
