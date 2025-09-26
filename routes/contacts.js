// src/routes/contacts.js
import express from "express";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import HrContact from "../models/HrContact.js";
import { toE164 } from "../utils/phone.js";
import mongoose from "mongoose"; // ⬅️ add this

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
router.get(
  "/verify/list",
  requireAuth,
  requireRole("verifier", "admin"),
  async (req, res) => {
    const q = String(req.query.q || "").trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit, 10) || 50)
    );

    const or = [];
    if (q) {
      or.push({ companyName: { $regex: q, $options: "i" } });
      or.push({ hrName: { $regex: q, $options: "i" } });
      or.push({ email: { $regex: q, $options: "i" } });
      or.push({ keySkills: { $elemMatch: { $regex: q, $options: "i" } } });
      const digits = q.replace(/\D/g, "");
      if (digits) {
        or.push({ phoneRaw: { $regex: `${digits}$` } });
        const e164 = toE164(q, "IN");
        if (e164) or.push({ phoneE164: e164 });
      }
    }

    const match = or.length ? { $or: or } : {};

    // ✅ date filter
    // in /verify/list, replace the date-filter block with:
    if (!q && req.query.date) {
      const tz = String(req.query.tz || "Asia/Kolkata");
      const dateStr = String(req.query.date); // YYYY-MM-DD
      // Build match by converting createdAt to a local-day string, then match it.
      match.$expr = {
        $eq: [
          {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: tz,
            },
          },
          dateStr,
        ],
      };
    }

    const [items, total] = await Promise.all([
      HrContact.find(match)
        .select(
          "_id date companyName hrName email phoneRaw phoneE164 status createdAt"
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      HrContact.countDocuments(match),
    ]);

    res.json({ page, limit, total, items });
  }
);

/**
 * PATCH /contacts/:id/status
 * body: { status: "red" | "yellow" | "green" | null }
 * roles: verifier, admin
 */
router.patch(
  "/:id/status",
  requireAuth,
  requireRole("verifier", "admin"),
  async (req, res) => {
    const raw = req.body?.status;
    const normalized =
      raw === null || raw === undefined ? null : String(raw).toLowerCase();
    const allowed = [null, "red", "yellow", "green"];
    if (!allowed.includes(normalized)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    await HrContact.findByIdAndUpdate(req.params.id, {
      status: normalized || undefined, // store null/undefined the same way
    });

    res.json({ ok: true });
  }
);
router.get(
  "/report/daily",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from) : null;
      const to = req.query.to ? new Date(req.query.to) : null;

      const match = {};
      if (from || to) {
        match.createdAt = {};
        if (from) match.createdAt.$gte = from;
        if (to) match.createdAt.$lte = to;
      }
      const tz = String(req.query.tz || "Asia/Kolkata");

      const pipeline = [
        { $match: match },
        {
          $group: {
            _id: {
              day: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$createdAt",
                  timezone: tz,
                },
              },
              user: "$createdBy",
            },
            countTotal: { $sum: 1 },
            countWithPhone: {
              $sum: { $cond: [{ $ifNull: ["$phoneE164", false] }, 1, 0] },
            },
            countWithEmail: {
              $sum: { $cond: [{ $ifNull: ["$email", false] }, 1, 0] },
            },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id.user",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },
        {
          $project: {
            date: "$_id.day",
            userId: "$_id.user",
            username: "$user.username",
            name: "$user.name",
            countTotal: 1,
            countWithPhone: 1,
            countWithEmail: 1,
            _id: 0,
          },
        },
        { $sort: { date: -1, username: 1 } },
      ];

      const results = await HrContact.aggregate(pipeline);
      res.json(results);
    } catch (err) {
      console.error("Daily report error:", err);
      res.status(500).json({ error: "Failed to generate report" });
    }
  }
);
// GET /contacts/report/mine/daily
// Query: ?from=ISO&to=ISO   (optional; defaults to "today" UTC)
router.get("/report/mine/daily", requireAuth, async (req, res) => {
  try {
    const date = String(
      req.query.date || new Date().toISOString().slice(0, 10)
    ); // YYYY-MM-DD
    const tz = String(req.query.tz || "Asia/Kolkata");

    const userId = new mongoose.Types.ObjectId(req.userId); // ⬅️ cast!

    const [r] = await HrContact.aggregate([
      { $match: { createdBy: userId } }, // ⬅️ use ObjectId here
      {
        $addFields: {
          dayLocal: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: tz,
            },
          },
        },
      },
      { $match: { dayLocal: date } },
      {
        $group: {
          _id: null,
          countTotal: { $sum: 1 },
          countWithPhone: {
            $sum: { $cond: [{ $ifNull: ["$phoneE164", false] }, 1, 0] },
          },
          countWithEmail: {
            $sum: { $cond: [{ $ifNull: ["$email", false] }, 1, 0] },
          },
        },
      },
    ]);

    res.json({
      date,
      tz,
      countTotal: r?.countTotal || 0,
      countWithPhone: r?.countWithPhone || 0,
      countWithEmail: r?.countWithEmail || 0,
    });
  } catch (err) {
    console.error("Self daily report error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});
// ⬇️ put this near your other report routes in src/routes/contacts.js

/**
 * GET /contacts/report/status-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Asia/Kolkata
 * Summarize statuses within a local-day range based on createdAt.
 */
router.get(
  "/report/status-summary",
  requireAuth,
  requireRole("verifier", "admin"),
  async (req, res) => {
    try {
      const tz = String(req.query.tz || "Asia/Kolkata");
      let from = req.query.from ? String(req.query.from) : undefined;
      let to = req.query.to ? String(req.query.to) : undefined;

      // If user inverted the dates, swap
      if (from && to && from > to) [from, to] = [to, from];

      // Build pipeline: compute local day string, then range match on that string
      const pipeline = [
        {
          $addFields: {
            dayLocal: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: tz,
              },
            },
          },
        },
      ];

      const match = {};
      if (from && to) {
        match.dayLocal = { $gte: from, $lte: to };
      } else if (from) {
        match.dayLocal = { $gte: from };
      } else if (to) {
        match.dayLocal = { $lte: to };
      }
      if (Object.keys(match).length) pipeline.push({ $match: match });

      pipeline.push({
        $group: {
          _id: null,
          total: { $sum: 1 },
          red: {
            $sum: { $cond: [{ $eq: ["$status", "red"] }, 1, 0] },
          },
          yellow: {
            $sum: { $cond: [{ $eq: ["$status", "yellow"] }, 1, 0] },
          },
          green: {
            $sum: { $cond: [{ $eq: ["$status", "green"] }, 1, 0] },
          },
          unset: {
            // null, missing, or empty -> count as unset
            $sum: {
              $cond: [
                {
                  $or: [{ $eq: ["$status", null] }, { $not: ["$status"] }],
                },
                1,
                0,
              ],
            },
          },
        },
      });

      const [r] = await HrContact.aggregate(pipeline);

      res.json({
        red: r?.red || 0,
        yellow: r?.yellow || 0,
        green: r?.green || 0,
        unset: r?.unset || 0,
        total: r?.total || 0,
      });
    } catch (err) {
      console.error("Status summary error:", err);
      res.status(500).json({ error: "Failed to get status summary" });
    }
  }
);

export default router;
