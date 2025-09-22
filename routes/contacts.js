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
  const {
    date,
    companyName,
    hrName,
    email,
    phone,
    resource,
    remarks,
    keySkills,
    experience, // free text like "1 year", "1.2 years"
    profileUrl,
  } = req.body || {};

  // --- Phone (optional) ---
  let phoneE164 = null;
  let phoneRaw = null;
  if (phone && String(phone).trim() !== "") {
    phoneE164 = toE164(phone, "IN");
    if (!phoneE164)
      return res.status(400).json({ error: "Invalid phone number" });
    phoneRaw = phone;
  }

  // --- keySkills (optional): support array or comma/pipe separated string ---
  let skills = [];
  if (Array.isArray(keySkills)) {
    skills = keySkills.map((s) => String(s).trim()).filter(Boolean);
  } else if (typeof keySkills === "string") {
    skills = keySkills
      .split(/[,|]/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // --- experience (optional): parse number of years & keep raw ---
  let experienceText = undefined;
  let experienceYears = undefined;
  if (typeof experience === "string" && experience.trim()) {
    experienceText = experience.trim();
    // extract first number (supports "1", "1.2", etc.)
    const m = experienceText.match(/(\d+(\.\d+)?)/);
    if (m) {
      const yrs = parseFloat(m[1]);
      if (!Number.isNaN(yrs) && yrs >= 0) experienceYears = yrs;
    }
  }

  // --- profileUrl (optional): basic validation if provided ---
  let cleanProfileUrl = undefined;
  if (profileUrl && String(profileUrl).trim() !== "") {
    try {
      const u = new URL(String(profileUrl).trim());
      cleanProfileUrl = u.toString();
    } catch {
      return res.status(400).json({ error: "Invalid profile URL" });
    }
  }

  try {
    const payload = {
      date,
      companyName,
      hrName,
      email: email?.toLowerCase(),
      resource,
      remarks,
      keySkills: skills,
      experienceText,
      experienceYears,
      profileUrl: cleanProfileUrl,
      createdBy: req.userId,
      ...(phoneE164 ? { phoneE164, phoneRaw } : {}),
    };

    const doc = await HrContact.create(payload);
    res.status(201).json(doc);
  } catch (err) {
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
