// src/routes/contacts.js
import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import HrContact from "../models/HrContact.js";
import { toE164 } from "../utils/phone.js";

const router = express.Router();

/**
 * GET /contacts/check?phone=...
 * -> { valid: boolean, exists: boolean }
 * Use this for the ✅ / ❌ UI while typing the phone number
 */
router.get("/check", requireAuth, async (req, res) => {
  const e164 = toE164(req.query.phone || "", "IN");
  if (!e164) return res.json({ valid: false, exists: false });
  const exists = await HrContact.exists({ phoneE164: e164 });
  res.json({ valid: true, exists: !!exists });
});

/**
 * POST /contacts
 * body: { date, companyName, hrName, email?, phone, resource?, remarks? }
 */
router.post("/", requireAuth, async (req, res) => {
  const { date, companyName, hrName, email, phone, resource, remarks } =
    req.body || {};

  const phoneE164 = toE164(phone, "IN");
  if (!phoneE164)
    return res.status(400).json({ error: "Invalid phone number" });

  try {
    const doc = await HrContact.create({
      date,
      companyName,
      hrName,
      email: email?.toLowerCase(),
      phoneRaw: phone,
      phoneE164,
      resource,
      remarks,
      createdBy: req.userId,
    });
    res.status(201).json(doc);
  } catch (err) {
    // Handle unique index duplicate (phoneE164)
    if (err?.code === 11000)
      return res.status(409).json({ error: "This contact already exists." });
    console.error(err);
    res.status(500).json({ error: "Failed to save contact" });
  }
});

/**
 * GET /contacts/mine  -> list my entries
 */
router.get("/mine", requireAuth, async (req, res) => {
  const data = await HrContact.find({ createdBy: req.userId })
    .sort({ createdAt: -1 })
    .lean();
  res.json(data);
});

/**
 * GET /contacts/admin/all  -> admin: list everything (with creator’s name)
 */
router.get("/admin/all", requireAuth, async (req, res) => {
  if (req.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const data = await HrContact.find({})
    .populate("createdBy", "name username")
    .sort({ createdAt: -1 })
    .lean();
  res.json(data);
});

export default router;
