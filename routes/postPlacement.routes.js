// routes/postPlacementRoutes.js
import express from "express";
import PostPlacementOffer from "../models/PostPlacementOffer.js";

const router = express.Router();

/* ───────────────────────── helpers ───────────────────────── */

const toISODate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const daysBetween = (from, to = new Date()) =>
  from ? Math.floor((to - new Date(from)) / (1000 * 60 * 60 * 24)) : 0;

const numFrom = (x) => {
  if (x === null || x === undefined) return NaN;
  if (typeof x === "number") return x;
  const s = String(x).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
};

/** Map DB doc -> UI row (RecordRow) using SIMPLE math */
function toRecordRow(doc, { overdueDays = 0 } = {}) {
  const paid = (doc.installments || []).reduce(
    (sum, it) => sum + (Number(it.amount) || 0),
    0
  );
  const total = Number(doc.totalPostPlacementFee || 0);
  const remaining = Math.max(total - paid, 0);

  // derive "overdue" if you pass a threshold (e.g., 60); 0 disables it
  let status = remaining <= 0 ? "paid" : "partial";
  if (status !== "paid" && overdueDays > 0) {
    const lastPayment = (doc.installments || [])
      .map((i) => i.date)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0];
    const anchor = lastPayment || doc.offerDate;
    if (daysBetween(anchor) > overdueDays) status = "overdue";
  }

  return {
    _id: String(doc._id),

    studentName: doc.studentName || "",
    offerDate: toISODate(doc.offerDate),
    joiningDate: toISODate(doc.joiningDate),

    hrName: doc.hr?.name || "",
    hrContact: doc.hr?.contactNumber || "",
    hrEmail: doc.hr?.email || "",

    company: doc.companyName || "",
    location: doc.location || "",

    // UI expects string like "4 LPA"
    package: Number.isFinite(doc.packageLPA) ? `${doc.packageLPA} LPA` : "",

    totalPPFee: total,
    remainingPreFee: String(doc.remainingPrePlacementFee ?? ""),
    discount: String(doc.discount ?? ""), // informational only in SIMPLE mode

    installments: (doc.installments || []).map((i) => ({
      amount: i.amount || 0,
      dueDate: null, // not tracked in your model
      paidDate: toISODate(i.date), // your "date" is the payment date
      status: "paid",
    })),

    collected: paid,
    remainingFee: String(remaining),
    remaining,
    status,
    daysSinceOffer: daysBetween(doc.offerDate),

    raw: doc, // handy in your drawer
  };
}

/* ───────────────────────── list/fetch ───────────────────────── */

/**
 * GET /api/post-placement/offers
 * Query:
 *  search, companies, locations, packages, statuses, offerMonth (YYYY-MM),
 *  page, limit, sortBy, sortOrder, overdueDays (0 disables overdue calc)
 */
router.get("/offers", async (req, res) => {
  try {
    const {
      search = "",
      companies = "",
      locations = "",
      packages = "",
      statuses = "",
      offerMonth = "",
      page = 1,
      limit = 500,
      sortBy = "createdAt",
      sortOrder = "desc",
      overdueDays = "0",
    } = req.query;

    const match = {};
    const companyArr = companies
      ? String(companies).split(",").filter(Boolean)
      : [];
    const locationArr = locations
      ? String(locations).split(",").filter(Boolean)
      : [];
    const packageArr = packages
      ? String(packages).split(",").filter(Boolean)
      : [];

    if (companyArr.length) match.companyName = { $in: companyArr };
    if (locationArr.length) match.location = { $in: locationArr };

    // packages: accept "4 LPA" or "4"
    if (packageArr.length) {
      const nums = packageArr
        .map((p) => numFrom(p))
        .filter((n) => Number.isFinite(n));
      if (nums.length) match.packageLPA = { $in: nums };
    }

    if (offerMonth) {
      const [y, m] = offerMonth.split("-").map((n) => parseInt(n, 10));
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 1));
      match.offerDate = { $gte: start, $lt: end };
    }

    if (search) {
      match.$or = [
        { studentName: new RegExp(search, "i") },
        { companyName: new RegExp(search, "i") },
        { location: new RegExp(search, "i") },
        { "hr.name": new RegExp(search, "i") },
      ];
    }

    const docs = await PostPlacementOffer.find(match)
      .sort({ [String(sortBy)]: sortOrder === "asc" ? 1 : -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    const mapped = docs.map((d) =>
      toRecordRow(d, { overdueDays: Number(overdueDays) || 0 })
    );

    // optional client status filter (after mapping)
    const statusArr = statuses
      ? String(statuses).split(",").filter(Boolean)
      : [];
    const items = statusArr.length
      ? mapped.filter((r) => statusArr.includes(r.status))
      : mapped;

    res.json({
      items,
      page: Number(page),
      limit: Number(limit),
      count: items.length,
    });
  } catch (err) {
    console.error("GET /offers error:", err);
    res.status(500).json({ error: "Failed to fetch offers" });
  }
});

/** GET one */
router.get("/offers/:id", async (req, res) => {
  try {
    const doc = await PostPlacementOffer.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json(
      toRecordRow(doc, { overdueDays: Number(req.query.overdueDays) || 0 })
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch" });
  }
});

/* ───────────────────────── mutate offer ───────────────────────── */

/** CREATE offer */
router.post("/offers", async (req, res) => {
  try {
    const created = await PostPlacementOffer.create(req.body);
    res.status(201).json(toRecordRow(created.toObject(), { overdueDays: 0 }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** UPDATE offer fields (triggers pre('save') in model if you switch to findById+save) */
router.patch("/offers/:id", async (req, res) => {
  try {
    // Use findById -> assign -> save to ensure your model's pre('save') runs
    const doc = await PostPlacementOffer.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    Object.assign(doc, req.body);
    await doc.save();
    res.json(toRecordRow(doc.toObject(), { overdueDays: 0 }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** DELETE offer (optional) */
router.delete("/offers/:id", async (req, res) => {
  try {
    const removed = await PostPlacementOffer.findByIdAndDelete(
      req.params.id
    ).lean();
    if (!removed) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ───────────────────────── installments ───────────────────────── */

/** ADD installment */
router.post("/offers/:id/installments", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await PostPlacementOffer.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    doc.installments.push({
      label: req.body.label,
      amount: req.body.amount,
      date: req.body.date,
      mode: req.body.mode,
      note: req.body.note,
    });

    await doc.save(); // keeps remainingFee in sync per your model
    res.json(toRecordRow(doc.toObject(), { overdueDays: 0 }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** UPDATE an installment */
router.patch("/offers/:id/installments/:instId", async (req, res) => {
  try {
    const { id, instId } = req.params;
    const doc = await PostPlacementOffer.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    const inst = doc.installments.id(instId);
    if (!inst) return res.status(404).json({ error: "Installment not found" });

    ["label", "amount", "date", "mode", "note"].forEach((k) => {
      if (req.body[k] !== undefined) inst[k] = req.body[k];
    });

    await doc.save();
    res.json(toRecordRow(doc.toObject(), { overdueDays: 0 }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** DELETE an installment */
router.delete("/offers/:id/installments/:instId", async (req, res) => {
  try {
    const { id, instId } = req.params;
    const doc = await PostPlacementOffer.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    const sub = doc.installments.id(instId);
    if (!sub) return res.status(404).json({ error: "Installment not found" });
    sub.deleteOne();

    await doc.save();
    res.json(toRecordRow(doc.toObject(), { overdueDays: 0 }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
