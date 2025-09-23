// routes/preplacementRoutes.js
import express from "express";
import mongoose from "mongoose";
import PrePlacementStudent, {
  PREPLACEMENT_STATUSES,
} from "../models/PrePlacementStudent.js";

const router = express.Router();

/* ───────────────────────── utils ───────────────────────── */

function getDateRange(q) {
  if (q.month) {
    const [y, m] = String(q.month).split("-").map(Number);
    if (!y || !m) return {};
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
    return { from, to };
  }
  const from = q.from ? new Date(q.from) : undefined;
  const to = q.to ? new Date(q.to) : undefined;
  return { from, to };
}
function hasRange({ from, to }) {
  return from instanceof Date || to instanceof Date;
}
function toNumber(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function parseDateAuto(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(s)) {
    const [d, m, yRaw] = s.split(/[\/.-]/).map((x) => x.trim());
    let y = parseInt(yRaw, 10);
    if (yRaw.length === 2) y = 2000 + y;
    const dt = new Date(Date.UTC(y, parseInt(m, 10) - 1, parseInt(d, 10)));
    return isNaN(dt) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt) ? null : dt;
}
function normalizeName(name) {
  return (name || "").trim().replace(/\s+/g, " ").toLowerCase();
}
function recalcTotals(doc) {
  const paid = (doc.payments || []).reduce((a, p) => a + toNumber(p.amount), 0);
  const refunded = (doc.refunds || []).reduce(
    (a, r) => a + toNumber(r.amount),
    0
  );
  const net = Math.max(paid - refunded, 0);
  doc.totalReceived = paid; // gross in
  doc.totalRefunded = refunded; // out
  doc.netCollected = net; // in - out
  const rawRemaining = Math.max(toNumber(doc.totalFee) - net, 0);
  doc.remainingFee = doc.status === "DROPPED" ? 0 : rawRemaining;
}
// Build a Date from separate local date + time strings (fallback 09:00) or a single scheduledAt string.
// We keep it simple to match your existing code paths (no external TZ lib).
function parseDateTime({ scheduledAt, date, time, tz = "Asia/Kolkata" }) {
  if (scheduledAt) {
    const d = new Date(String(scheduledAt));
    return isNaN(d) ? null : d;
  }
  const dStr = String(date || "").trim();
  if (!dStr) return null;
  const tStr = String(time || "09:00").trim(); // HH:mm
  const isoGuess = `${dStr}T${tStr}:00`;
  const d = new Date(isoGuess);
  return isNaN(d) ? null : d;
}

/* ───────────────────────── SUMMARY ─────────────────────────
Totals and monthly net collections (payments - refunds)
Query: ?status=&course=&month=YYYY-MM OR from=&to= (ISO)
*/
router.get("/summary", async (req, res) => {
  try {
    const { status, course } = req.query;
    const { from, to } = getDateRange(req.query);

    const match = {};
    if (status && PREPLACEMENT_STATUSES.includes(status)) match.status = status;
    if (course) match.courseName = { $regex: String(course), $options: "i" };

    const dateMatch = hasRange({ from, to })
      ? {
          "txns.date": {
            ...(from ? { $gte: from } : {}),
            ...(to ? { $lt: to } : {}),
          },
        }
      : null;
    const pipeline = [
      { $match: match },
      {
        $project: {
          status: 1, // <— add status so we can count by it
          totalFee: 1,
          totalReceived: 1,
          totalRefunded: { $ifNull: ["$totalRefunded", 0] },
          netCollected: {
            $ifNull: [
              "$netCollected",
              {
                $subtract: [
                  "$totalReceived",
                  { $ifNull: ["$totalRefunded", 0] },
                ],
              },
            ],
          },
          remainingFee: {
            $cond: [{ $eq: ["$status", "DROPPED"] }, 0, "$remainingFee"],
          },
          txns: {
            $concatArrays: [
              {
                $map: {
                  input: { $ifNull: ["$payments", []] },
                  as: "p",
                  in: { date: "$$p.date", amount: "$$p.amount" },
                },
              },
              {
                $map: {
                  input: { $ifNull: ["$refunds", []] },
                  as: "r",
                  in: {
                    date: "$$r.date",
                    amount: { $multiply: ["$$r.amount", -1] },
                  },
                },
              },
            ],
          },
        },
      },
      {
        $facet: {
          overall: [
            {
              $group: {
                _id: null,
                totalStudents: { $sum: 1 },
                totalFee: { $sum: "$totalFee" },
                totalReceived: { $sum: "$totalReceived" },
                totalRefunded: { $sum: "$totalRefunded" },
                netCollected: { $sum: "$netCollected" },
                remainingFee: { $sum: "$remainingFee" },
              },
            },
          ],
          // NEW: counts by status
          byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          collectedInRange: [
            { $unwind: { path: "$txns", preserveNullAndEmptyArrays: false } },
            ...(dateMatch ? [{ $match: dateMatch }] : []),
            { $group: { _id: null, collected: { $sum: "$txns.amount" } } },
          ],
          byMonth: [
            { $unwind: { path: "$txns", preserveNullAndEmptyArrays: false } },
            ...(dateMatch ? [{ $match: dateMatch }] : []),
            { $match: { "txns.date": { $type: "date" } } },
            {
              $group: {
                _id: {
                  y: { $year: "$txns.date" },
                  m: { $month: "$txns.date" },
                },
                collected: { $sum: "$txns.amount" },
              },
            },
            { $sort: { "_id.y": 1, "_id.m": 1 } },
          ],
        },
      },
      {
        $project: {
          totalStudents: { $ifNull: [{ $first: "$overall.totalStudents" }, 0] },
          totalFee: { $ifNull: [{ $first: "$overall.totalFee" }, 0] },
          totalReceived: { $ifNull: [{ $first: "$overall.totalReceived" }, 0] },
          totalRefunded: { $ifNull: [{ $first: "$overall.totalRefunded" }, 0] },
          netCollected: { $ifNull: [{ $first: "$overall.netCollected" }, 0] },
          remainingFee: { $ifNull: [{ $first: "$overall.remainingFee" }, 0] },
          collectedInRange: {
            $ifNull: [{ $first: "$collectedInRange.collected" }, 0],
          },
          monthly: "$byMonth",
          // turn [{_id: "ACTIVE", count: n},...] into an object
          countsByStatus: {
            $arrayToObject: {
              $map: {
                input: "$byStatus",
                as: "s",
                in: { k: { $ifNull: ["$$s._id", "UNKNOWN"] }, v: "$$s.count" },
              },
            },
          },
        },
      },
    ];
    const [data = {}] = await PrePlacementStudent.aggregate(pipeline);
    res.json({
      ...data,
      range: hasRange({ from, to }) ? { from, to } : null,
      filters: { status: status || null, course: course || null },
    });
  } catch (err) {
    console.error("summary error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ───────────────────────── LIST ─────────────────────────
Paginated list + optional month/from/to
?includePayments=true&includeRefunds=true to include arrays
If range passed, collectedInRange is NET (payments - refunds)
*/
router.get("/students", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "20", 10), 1),
      200
    );
    const skip = (page - 1) * limit;

    const { search, status, course, zone } = req.query;
    const { from, to } = getDateRange(req.query);
    const includePayments =
      String(req.query.includePayments || "false") === "true";
    const includeRefunds =
      String(req.query.includeRefunds || "false") === "true";

    const match = {};
    if (status && PREPLACEMENT_STATUSES.includes(status)) match.status = status;
    if (course) match.courseName = { $regex: String(course), $options: "i" };
    if (search) {
      const rx = { $regex: String(search), $options: "i" };
      match.$or = [{ name: rx }, { courseName: rx }];
    }
    if (zone) {
      const z = String(zone).toUpperCase();
      if (["BLUE", "YELLOW", "GREEN"].includes(z)) {
        match.zone = z;
        // Zones don't apply to PLACED students. Exclude them unless user explicitly passed a status.
        if (!status) {
          match.status = { $ne: "PLACED" };
        }
      }
    }

    const setRangeFields = hasRange({ from, to })
      ? [
          {
            $set: {
              paymentsInRange: {
                $filter: {
                  input: "$payments",
                  as: "p",
                  cond: {
                    $and: [
                      ...(from ? [{ $gte: ["$$p.date", from] }] : []),
                      ...(to ? [{ $lt: ["$$p.date", to] }] : []),
                    ],
                  },
                },
              },
              refundsInRange: {
                $filter: {
                  input: { $ifNull: ["$refunds", []] },
                  as: "r",
                  cond: {
                    $and: [
                      ...(from ? [{ $gte: ["$$r.date", from] }] : []),
                      ...(to ? [{ $lt: ["$$r.date", to] }] : []),
                    ],
                  },
                },
              },
            },
          },
          {
            $addFields: {
              collectedInRange: {
                $subtract: [
                  {
                    $sum: {
                      $map: {
                        input: "$paymentsInRange",
                        as: "pi",
                        in: "$$pi.amount",
                      },
                    },
                  },
                  {
                    $sum: {
                      $map: {
                        input: "$refundsInRange",
                        as: "ri",
                        in: "$$ri.amount",
                      },
                    },
                  },
                ],
              },
            },
          },
        ]
      : [];

    const pipeline = [
      { $match: match },
      { $sort: { createdAt: -1 } },
      ...setRangeFields,
      {
        $facet: {
          rows: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                name: 1,
                courseName: 1,
                terms: 1,
                totalFee: 1,
                totalReceived: 1, // gross
                totalRefunded: 1,
                netCollected: 1, // NEW net
                remainingFee: {
                  $cond: [{ $eq: ["$status", "DROPPED"] }, 0, "$remainingFee"],
                },
                status: 1,
                zone: 1,
                dueDate: 1,
                createdAt: 1,
                updatedAt: 1,
                paymentsCount: { $size: "$payments" },
                ...(hasRange({ from, to })
                  ? {
                      collectedInRange: 1, // NET in range
                      ...(includePayments ? { paymentsInRange: 1 } : {}),
                      ...(includeRefunds ? { refundsInRange: 1 } : {}),
                    }
                  : {}),
                ...(includePayments ? { payments: 1 } : {}),
                ...(includeRefunds ? { refunds: 1 } : {}),
              },
            },
          ],
          meta: [{ $count: "total" }],
        },
      },
      {
        $project: {
          rows: 1,
          total: { $ifNull: [{ $first: "$meta.total" }, 0] },
        },
      },
    ];

    const [result] = await PrePlacementStudent.aggregate(pipeline);
    res.json({
      page,
      limit,
      total: result?.total || 0,
      rows: result?.rows || [],
      range: hasRange({ from, to }) ? { from, to } : null,
    });
  } catch (err) {
    console.error("students list error:", err);
    res.status(500).json({ error: err.message });
  }
});
// CREATE a new pre-placement student
router.post("/students", async (req, res) => {
  try {
    const b = req.body || {};

    // basic validation
    const name = (b.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });
    if (b.status && !PREPLACEMENT_STATUSES.includes(b.status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // shape arrays from payload (both optional)
    const payments = Array.isArray(b.payments)
      ? b.payments.map((p) => ({
          amount: toNumber(p.amount),
          date: parseDateAuto(p.date),
          mode: (p.mode || "").trim(),
          receiptNos: Array.isArray(p.receiptNos)
            ? p.receiptNos.map((x) => String(x).trim()).filter(Boolean)
            : String(p.receiptNos || "")
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
          note: (p.note || "").trim(),
          raw: p.raw || undefined,
        }))
      : [];

    const refunds = Array.isArray(b.refunds)
      ? b.refunds.map((r) => ({
          amount: toNumber(r.amount),
          date: parseDateAuto(r.date),
          mode: (r.mode || "").trim(),
          note: (r.note || "").trim(),
        }))
      : [];
    const zoneRaw = (b.zone || "").toUpperCase();
    const zone = ["BLUE", "YELLOW", "GREEN"].includes(zoneRaw)
      ? zoneRaw
      : "BLUE";
    // assemble doc
    const base = {
      name,
      nameKey: normalizeName(name),
      courseName: (b.courseName || "").trim(),
      terms: (b.terms || "").trim(),
      totalFee: toNumber(b.totalFee),
      dueDate: parseDateAuto(b.dueDate),
      status: b.status || "ACTIVE",
      payments,
      refunds,
      zone, // <— NEW
    };
    const now = new Date();

    const doc = new PrePlacementStudent({
      ...base,
      ...(b.status === "DROPPED"
        ? {
            droppedAt: b.droppedAt ? parseDateAuto(b.droppedAt) || now : now,
            dropReason: (b.dropReason || "").trim() || undefined,
          }
        : {}),
      ...(b.status === "PAUSED"
        ? { pausedAt: b.pausedAt ? parseDateAuto(b.pausedAt) || now : now }
        : {}),
      ...(b.status === "PLACED"
        ? { placedAt: b.placedAt ? parseDateAuto(b.placedAt) || now : now }
        : {}),
    });

    // rollups
    recalcTotals(doc);

    await doc.save();
    return res.status(201).json(doc);
  } catch (err) {
    if (err?.code === 11000) {
      // unique index on nameKey
      return res
        .status(409)
        .json({ error: "Another student already uses that name" });
    }
    console.error("create student error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ───────────────────────── DETAIL ─────────────────────────
Supports month/from/to; also filters refunds if range supplied
*/
router.get("/students/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });

    const { from, to } = getDateRange(req.query);

    if (hasRange({ from, to })) {
      const [doc] = await PrePlacementStudent.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(id) } },
        {
          $set: {
            payments: {
              $filter: {
                input: "$payments",
                as: "p",
                cond: {
                  $and: [
                    ...(from ? [{ $gte: ["$$p.date", from] }] : []),
                    ...(to ? [{ $lt: ["$$p.date", to] }] : []),
                  ],
                },
              },
            },
            refunds: {
              $filter: {
                input: { $ifNull: ["$refunds", []] },
                as: "r",
                cond: {
                  $and: [
                    ...(from ? [{ $gte: ["$$r.date", from] }] : []),
                    ...(to ? [{ $lt: ["$$r.date", to] }] : []),
                  ],
                },
              },
            },
          },
        },
        {
          $addFields: {
            totalReceivedInRange: {
              $sum: { $map: { input: "$payments", as: "p", in: "$$p.amount" } },
            },
            totalRefundedInRange: {
              $sum: { $map: { input: "$refunds", as: "r", in: "$$r.amount" } },
            },
            netCollectedInRange: {
              $subtract: [
                {
                  $sum: {
                    $map: { input: "$payments", as: "p", in: "$$p.amount" },
                  },
                },
                {
                  $sum: {
                    $map: { input: "$refunds", as: "r", in: "$$r.amount" },
                  },
                },
              ],
            },
            remainingFee: {
              $cond: [{ $eq: ["$status", "DROPPED"] }, 0, "$remainingFee"],
            },
          },
        },
      ]);
      if (!doc) return res.status(404).json({ error: "Not found" });
      return res.json(doc);
    } else {
      const doc = await PrePlacementStudent.findById(id);
      if (!doc) return res.status(404).json({ error: "Not found" });
      return res.json(doc);
    }
  } catch (err) {
    console.error("student detail error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ───────────────────────── STATUS (with optional refund) ─────────────────────────
PATCH /students/:id/status
Body: { status: "ACTIVE"|"DROPPED", refund?: { amount, date, mode, note }, dropReason? }
*/
router.patch("/students/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, refund, dropReason } = req.body || {};

    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });
    if (!PREPLACEMENT_STATUSES.includes(status))
      return res.status(400).json({ error: "Invalid status" });

    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    const was = doc.status;
    doc.status = status;

    // clear dropReason if moving away from DROPPED
    if (was === "DROPPED" && status !== "DROPPED") {
      doc.dropReason = undefined;
    }

    const now = new Date();

    if (status === "DROPPED") {
      if (!doc.droppedAt) doc.droppedAt = now;
      if (typeof dropReason === "string")
        doc.dropReason = dropReason.trim() || undefined;

      // optional refund on drop
      if (refund && toNumber(refund.amount) > 0) {
        doc.refunds = doc.refunds || [];
        doc.refunds.push({
          amount: toNumber(refund.amount),
          date: parseDateAuto(refund.date),
          mode: (refund.mode || "").trim(),
          note: (refund.note || "").trim(),
        });
      }
    } else if (status === "PAUSED") {
      if (!doc.pausedAt) doc.pausedAt = now;
    } else if (status === "PLACED") {
      if (!doc.placedAt) doc.placedAt = now;
    } else if (status === "ACTIVE") {
      // Optional: when re-activating, you might want to clear pausedAt.
      // Comment out if you prefer to keep history.
      // doc.pausedAt = undefined;
      // doc.droppedAt = undefined; // usually you keep this; uncomment if you want to clear
      // doc.placedAt = undefined;  // usually keep; uncomment if you want to clear
    }

    recalcTotals(doc);
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error("status update error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ───────────────────────── PAYMENTS ───────────────────────── */

router.post("/students/:id/payments", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });
    const p = req.body || {};

    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    doc.payments.push({
      amount: toNumber(p.amount),
      date: parseDateAuto(p.date),
      mode: (p.mode || "").trim(),
      receiptNos: Array.isArray(p.receiptNos)
        ? p.receiptNos.map((x) => String(x).trim()).filter(Boolean)
        : String(p.receiptNos || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
      note: (p.note || "").trim(),
      raw: p.raw || undefined,
    });

    recalcTotals(doc);
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error("add payment error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/students/:id/payments/:index", async (req, res) => {
  try {
    const { id, index } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });

    const idx = parseInt(index, 10);
    if (!Number.isInteger(idx) || idx < 0)
      return res.status(400).json({ error: "Invalid index" });

    const body = req.body || {};
    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (idx >= (doc.payments || []).length)
      return res.status(404).json({ error: "Payment not found" });

    const p = doc.payments[idx];
    if (body.amount !== undefined) p.amount = toNumber(body.amount);
    if (body.date !== undefined) p.date = parseDateAuto(body.date);
    if (body.mode !== undefined) p.mode = String(body.mode || "").trim();
    if (body.receiptNos !== undefined) {
      p.receiptNos = Array.isArray(body.receiptNos)
        ? body.receiptNos.map((x) => String(x).trim()).filter(Boolean)
        : String(body.receiptNos || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
    }
    if (body.note !== undefined) p.note = String(body.note || "").trim();

    recalcTotals(doc);
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error("update payment error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/students/:id/payments/:index", async (req, res) => {
  try {
    const { id, index } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });

    const idx = parseInt(index, 10);
    if (!Number.isInteger(idx) || idx < 0)
      return res.status(400).json({ error: "Invalid index" });

    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (idx >= (doc.payments || []).length)
      return res.status(404).json({ error: "Payment not found" });

    doc.payments.splice(idx, 1);

    recalcTotals(doc);
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error("delete payment error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ───────────────────────── REFUNDS ───────────────────────── */

router.post("/students/:id/refunds", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });
    const r = req.body || {};

    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    doc.refunds = doc.refunds || [];
    doc.refunds.push({
      amount: toNumber(r.amount),
      date: parseDateAuto(r.date),
      mode: (r.mode || "").trim(),
      note: (r.note || "").trim(),
    });

    recalcTotals(doc);
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error("add refund error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/students/:id/refunds/:index", async (req, res) => {
  try {
    const { id, index } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });

    const idx = parseInt(index, 10);
    if (!Number.isInteger(idx) || idx < 0)
      return res.status(400).json({ error: "Invalid index" });

    const body = req.body || {};
    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (idx >= (doc.refunds || []).length)
      return res.status(404).json({ error: "Refund not found" });

    const r = doc.refunds[idx];
    if (body.amount !== undefined) r.amount = toNumber(body.amount);
    if (body.date !== undefined) r.date = parseDateAuto(body.date);
    if (body.mode !== undefined) r.mode = String(body.mode || "").trim();
    if (body.note !== undefined) r.note = String(body.note || "").trim();

    recalcTotals(doc);
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error("update refund error:", err);
    res.status(500).json({ error: err.message });
  }
});
// UPDATE (full) a pre-placement student, optionally replacing payments/refunds
router.put("/students/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });

    const b = req.body || {};
    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    // ---- top-level fields ----
    if (typeof b.name === "string") {
      const name = b.name.trim();
      if (!name) return res.status(400).json({ error: "Name is required" });
      doc.name = name;
      doc.nameKey = normalizeName(name);
    }
    if (typeof b.courseName === "string") doc.courseName = b.courseName.trim();
    if (typeof b.terms === "string") doc.terms = b.terms.trim();
    if (b.totalFee !== undefined) doc.totalFee = toNumber(b.totalFee);
    if (b.dueDate !== undefined) doc.dueDate = parseDateAuto(b.dueDate);
    if (b.status && PREPLACEMENT_STATUSES.includes(b.status)) {
      const now = new Date();
      doc.status = b.status;

      if (b.status === "DROPPED") {
        if (!doc.droppedAt) doc.droppedAt = now;
        if (typeof b.dropReason === "string") {
          doc.dropReason = b.dropReason.trim() || undefined;
        }
      } else {
        // clear dropReason if not dropped
        doc.dropReason = undefined;
      }

      if (b.status === "PAUSED" && !doc.pausedAt) {
        doc.pausedAt = b.pausedAt ? parseDateAuto(b.pausedAt) || now : now;
      }
      if (b.status === "PLACED" && !doc.placedAt) {
        doc.placedAt = b.placedAt ? parseDateAuto(b.placedAt) || now : now;
      }

      // Optional clearing on ACTIVE (comment out if you prefer keeping history)
      // if (b.status === "ACTIVE") {
      //   doc.pausedAt = undefined;
      //   // doc.droppedAt = undefined;
      //   // doc.placedAt = undefined;
      // }
    }

    // ---- replace payments if provided ----
    if (Array.isArray(b.payments)) {
      doc.payments = b.payments.map((p) => ({
        amount: toNumber(p.amount),
        date: parseDateAuto(p.date),
        mode: (p.mode || "").trim(),
        receiptNos: Array.isArray(p.receiptNos)
          ? p.receiptNos.map((x) => String(x).trim()).filter(Boolean)
          : String(p.receiptNos || "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
        note: (p.note || "").trim(),
        raw: p.raw || undefined,
      }));
    }

    // ---- optionally replace refunds too (if you send them) ----
    if (Array.isArray(b.refunds)) {
      doc.refunds = b.refunds.map((r) => ({
        amount: toNumber(r.amount),
        date: parseDateAuto(r.date),
        mode: (r.mode || "").trim(),
        note: (r.note || "").trim(),
      }));
    } else if (!doc.refunds) {
      doc.refunds = [];
    }

    // roll-ups
    recalcTotals(doc);

    await doc.save();
    res.json(doc);
  } catch (err) {
    if (err?.code === 11000) {
      return res
        .status(409)
        .json({ error: "Another student already uses that name" });
    }
    console.error("update student error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/students/:id/refunds/:index", async (req, res) => {
  try {
    const { id, index } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });

    const idx = Number.parseInt(index, 10);
    if (!Number.isInteger(idx) || idx < 0)
      return res.status(400).json({ error: "Invalid index" });

    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    // ensure array exists
    doc.refunds = doc.refunds || [];
    if (idx >= doc.refunds.length)
      return res.status(404).json({ error: "Refund not found" });

    doc.refunds.splice(idx, 1);
    // optional but safe:
    doc.markModified("refunds");

    // Recalculate rollups (see helper below) OR rely on your model's pre('save')
    recalcTotals(doc);

    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error("delete refund error:", err);
    res.status(500).json({ error: err.message });
  }
});
// ───────────────────────── DUE NOTIFICATIONS ─────────────────────────
// GET /preplacement/due-notifications?date=YYYY-MM-DD&daysBefore=5&tz=Asia/Kolkata&includeStatuses=ACTIVE,PAUSED,PLACED
router.get("/due-notifications", async (req, res) => {
  try {
    const {
      date, // anchor date (local) for computing buckets; default: today
      daysBefore = "5", // N for "due in N days"
      tz = "Asia/Kolkata", // dashboard TZ
      includeStatuses, // comma list; default excludes DROPPED
    } = req.query;

    const N = Math.max(parseInt(String(daysBefore), 10) || 5, 0);

    // Parse anchor date and normalize it to "start of day" in TZ inside the pipeline.
    // We pass JS Date; $dateTrunc will handle TZ correctly.
    const refDate = date ? new Date(String(date)) : new Date();

    // Build allowed statuses (default: everything except DROPPED)
    let statusFilter;
    if (typeof includeStatuses === "string" && includeStatuses.trim()) {
      const allow = includeStatuses
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      statusFilter = { status: { $in: allow } };
    } else {
      statusFilter = { status: { $ne: "DROPPED" } };
    }

    const pipeline = [
      {
        $match: {
          ...statusFilter,
          remainingFee: { $gt: 0 },
          dueDate: { $type: "date" },
        },
      },
      // Compute "start of day" for both the reference date and each doc's due date in the given TZ
      {
        $addFields: {
          refStart: {
            $dateTrunc: { date: refDate, unit: "day", timezone: tz },
          },
          dueStart: {
            $dateTrunc: { date: "$dueDate", unit: "day", timezone: tz },
          },
        },
      },
      {
        $addFields: {
          daysUntilDue: {
            $dateDiff: { start: "$refStart", end: "$dueStart", unit: "day" },
          },
        },
      },
      {
        $project: {
          name: 1,
          courseName: 1,
          status: 1,
          dueDate: 1,
          remainingFee: 1,
          netCollected: 1,
          daysUntilDue: 1,
        },
      },
      {
        $facet: {
          dueToday: [
            { $match: { daysUntilDue: 0 } },
            { $sort: { dueDate: 1 } },
          ],
          dueInN: [{ $match: { daysUntilDue: N } }, { $sort: { dueDate: 1 } }],
          overdue: [
            { $match: { daysUntilDue: { $lt: 0 } } },
            { $sort: { dueDate: 1 } },
          ],
        },
      },
      {
        $addFields: {
          counts: {
            dueToday: { $size: "$dueToday" },
            dueInN: { $size: "$dueInN" },
            overdue: { $size: "$overdue" },
          },
        },
      },
      {
        $project: {
          dueToday: 1,
          dueInN: 1,
          overdue: 1,
          counts: 1,
        },
      },
    ];

    const [
      out = {
        dueToday: [],
        dueInN: [],
        overdue: [],
        counts: { dueToday: 0, dueInN: 0, overdue: 0 },
      },
    ] = await PrePlacementStudent.aggregate(pipeline);

    // Helpful UI strings for your “update” notifications
    const messages = {
      dueToday: "Today is the due date.",
      dueInN: `Due date in ${N} day${N === 1 ? "" : "s"}.`,
      overdue: "Due date has passed.",
    };

    return res.json({
      anchorDate: refDate, // JS date (UTC) used; client can format to IST
      timezone: tz,
      daysBefore: N,
      counts: out.counts,
      buckets: {
        dueToday: out.dueToday.map((s) => ({
          ...s,
          message: messages.dueToday,
        })),
        dueInN: out.dueInN.map((s) => ({
          ...s,
          message: messages.dueInN,
        })),
        overdue: out.overdue.map((s) => ({
          ...s,
          daysOverdue: Math.abs(s.daysUntilDue), // positive count of days late
          message: messages.overdue,
        })),
      },
    });
  } catch (err) {
    console.error("due-notifications error:", err);
    return res.status(500).json({ error: err.message });
  }
});
// PATCH /preplacement/students/:id/reminders
// Body: { type: "FIVE_DAY" | "DUE_DAY" }
router.patch("/students/:id/reminders", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });
    const { type } = req.body || {};
    if (!["FIVE_DAY", "DUE_DAY"].includes(type))
      return res.status(400).json({ error: "Invalid type" });

    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    doc.reminders = doc.reminders || {};
    const now = new Date();
    if (type === "FIVE_DAY") doc.reminders.fiveDaySentOn = now;
    if (type === "DUE_DAY") doc.reminders.dueDaySentOn = now;

    await doc.save();
    res.json({ ok: true, reminders: doc.reminders });
  } catch (err) {
    console.error("reminders ack error:", err);
    res.status(500).json({ error: err.message });
  }
});
// GET /preplacement/notifications?daysBefore=5&tz=Asia/Kolkata&page=1&limit=50&includeStatuses=ACTIVE,PAUSED,PLACED
router.get("/notifications", async (req, res) => {
  try {
    const {
      daysBefore = "5",
      tz = "Asia/Kolkata",
      includeStatuses, // optional: comma list; default excludes DROPPED
      page: pageStr = "1",
      limit: limitStr = "50",
      date, // optional anchor date (YYYY-MM-DD) for testing
    } = req.query;

    const N = Math.max(parseInt(String(daysBefore), 10) || 5, 0);
    const refDate = date ? new Date(String(date)) : new Date();

    let statusFilter;
    if (typeof includeStatuses === "string" && includeStatuses.trim()) {
      const allow = includeStatuses
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      statusFilter = { status: { $in: allow } };
    } else {
      statusFilter = { status: { $ne: "DROPPED" } };
    }

    const page = Math.max(parseInt(pageStr, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200);
    const skip = (page - 1) * limit;

    // Build the three buckets using one aggregation, then flatten in JS
    const pipeline = [
      {
        $match: {
          ...statusFilter,
          remainingFee: { $gt: 0 },
          dueDate: { $type: "date" },
        },
      },
      {
        $addFields: {
          refStart: {
            $dateTrunc: { date: refDate, unit: "day", timezone: tz },
          },
          dueStart: {
            $dateTrunc: { date: "$dueDate", unit: "day", timezone: tz },
          },
        },
      },
      {
        $addFields: {
          daysUntilDue: {
            $dateDiff: {
              startDate: "$refStart",
              endDate: "$dueStart",
              unit: "day",
            },
          },
        },
      },
      {
        $project: {
          name: 1,
          courseName: 1,
          status: 1,
          dueDate: 1,
          remainingFee: 1,
          daysUntilDue: 1,
          "reminders.fiveDaySeenAt": 1,
          "reminders.dueDaySeenAt": 1,
          "reminders.firstOverdueSeenAt": 1,
        },
      },
      {
        $facet: {
          dueToday: [
            { $match: { daysUntilDue: 0 } },
            { $sort: { dueDate: 1 } },
          ],
          dueInN: [{ $match: { daysUntilDue: N } }, { $sort: { dueDate: 1 } }],
          overdue: [
            { $match: { daysUntilDue: { $lt: 0 } } },
            { $sort: { dueDate: 1 } },
          ],
          counts: [
            {
              $group: {
                _id: null,
                dueToday: {
                  $sum: { $cond: [{ $eq: ["$daysUntilDue", 0] }, 1, 0] },
                },
                dueInN: {
                  $sum: { $cond: [{ $eq: ["$daysUntilDue", N] }, 1, 0] },
                },
                overdue: {
                  $sum: { $cond: [{ $lt: ["$daysUntilDue", 0] }, 1, 0] },
                },
              },
            },
          ],
        },
      },
    ];

    const [out] = await PrePlacementStudent.aggregate(pipeline);
    const dueToday = out?.dueToday || [];
    const dueInN = out?.dueInN || [];
    const overdue = out?.overdue || [];
    const counts = out?.counts?.[0] || { dueToday: 0, dueInN: 0, overdue: 0 };

    // Flatten to inbox items with a type and seen flag
    const items = [
      ...overdue.map((s) => ({
        studentId: s._id,
        type: "OVERDUE",
        title: `${s.name} – Overdue`,
        message: "Due date has passed.",
        dueDate: s.dueDate,
        remainingFee: s.remainingFee,
        courseName: s.courseName,
        urgencyRank: 1, // highest
        seen: !!s?.reminders?.firstOverdueSeenAt,
        seenAt: s?.reminders?.firstOverdueSeenAt || null,
        daysUntilDue: s.daysUntilDue, // negative
      })),
      ...dueToday.map((s) => ({
        studentId: s._id,
        type: "DUE_DAY",
        title: `${s.name} – Due today`,
        message: "Today is the due date.",
        dueDate: s.dueDate,
        remainingFee: s.remainingFee,
        courseName: s.courseName,
        urgencyRank: 2,
        seen: !!s?.reminders?.dueDaySeenAt,
        seenAt: s?.reminders?.dueDaySeenAt || null,
        daysUntilDue: s.daysUntilDue, // 0
      })),
      ...dueInN.map((s) => ({
        studentId: s._id,
        type: "FIVE_DAY",
        title: `${s.name} – Due in ${N} days`,
        message: `Due date in ${N} day${N === 1 ? "" : "s"}.`,
        dueDate: s.dueDate,
        remainingFee: s.remainingFee,
        courseName: s.courseName,
        urgencyRank: 3,
        seen: !!s?.reminders?.fiveDaySeenAt,
        seenAt: s?.reminders?.fiveDaySeenAt || null,
        daysUntilDue: s.daysUntilDue, // N
      })),
    ];

    // Sort: unseen first, then urgency, then nearest due date
    items.sort((a, b) => {
      if (a.seen !== b.seen) return a.seen ? 1 : -1;
      if (a.urgencyRank !== b.urgencyRank) return a.urgencyRank - b.urgencyRank;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });

    const total = items.length;
    const pageItems = items.slice(skip, skip + limit);

    return res.json({
      anchorDate: refDate,
      timezone: tz,
      daysBefore: N,
      counts,
      page,
      limit,
      total,
      rows: pageItems,
    });
  } catch (err) {
    console.error("notifications error:", err);
    res.status(500).json({ error: err.message });
  }
});
// PATCH /preplacement/notifications/:studentId/seen
// Body: { type: "FIVE_DAY" | "DUE_DAY" | "OVERDUE" }
router.patch("/notifications/:studentId/seen", async (req, res) => {
  try {
    const { studentId } = req.params;
    const { type } = req.body || {};

    if (!mongoose.isValidObjectId(studentId))
      return res.status(400).json({ error: "Invalid studentId" });
    if (!["FIVE_DAY", "DUE_DAY", "OVERDUE"].includes(type))
      return res.status(400).json({ error: "Invalid type" });

    const doc = await PrePlacementStudent.findById(studentId);
    if (!doc) return res.status(404).json({ error: "Not found" });

    const now = new Date();
    doc.reminders = doc.reminders || {};
    if (type === "FIVE_DAY") doc.reminders.fiveDaySeenAt = now;
    if (type === "DUE_DAY") doc.reminders.dueDaySeenAt = now;
    if (type === "OVERDUE") doc.reminders.firstOverdueSeenAt = now;

    await doc.save();
    return res.json({ ok: true, reminders: doc.reminders });
  } catch (err) {
    console.error("notifications seen error:", err);
    res.status(500).json({ error: err.message });
  }
});
// PATCH /preplacement/students/:id/zone
router.patch("/students/:id/zone", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });

    const z = String(req.body?.zone || "").toUpperCase();
    if (!["BLUE", "YELLOW", "GREEN"].includes(z))
      return res.status(400).json({ error: "Invalid zone" });

    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    // NEW: zones don't apply to placed students
    if (doc.status === "PLACED") {
      return res
        .status(409)
        .json({ error: "Zones do not apply to PLACED students" });
    }

    doc.zone = z; // pre('save') sets zoneChangedAt
    await doc.save();
    res.json({ ok: true, zone: doc.zone, zoneChangedAt: doc.zoneChangedAt });
  } catch (err) {
    console.error("zone update error:", err);
    res.status(500).json({ error: err.message });
  }
});
// POST /preplacement/students/:id/interviews
// Body: { company (req), scheduledAt? OR (date, time), round?, remarks?, status?, createdBy? }
router.post("/students/:id/interviews", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });

    const b = req.body || {};
    const company = String(b.company || "").trim();
    if (!company) return res.status(400).json({ error: "Company is required" });

    const sched = parseDateTime({
      scheduledAt: b.scheduledAt,
      date: b.date,
      time: b.time,
      tz: b.tz || "Asia/Kolkata",
    });
    if (!sched) return res.status(400).json({ error: "Invalid date/time" });

    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    // optional: auto-set zone to GREEN when an interview is added
    if (doc.zone !== "GREEN") doc.zone = "GREEN";

    const statusIn = String(b.status || "SCHEDULED").toUpperCase();
    const status = ["SCHEDULED", "COMPLETED", "CANCELLED"].includes(statusIn)
      ? statusIn
      : "SCHEDULED";

    doc.interviews.push({
      company,
      scheduledAt: sched,
      round: String(b.round || "").trim() || undefined,
      remarks: String(b.remarks || "").trim() || undefined,
      status,
      createdBy: String(b.createdBy || "").trim() || undefined,
    });

    await doc.save();

    const sorted = [...doc.interviews].sort(
      (a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt)
    );
    res.status(201).json({ ok: true, zone: doc.zone, interviews: sorted });
  } catch (err) {
    console.error("add interview error:", err);
    res.status(500).json({ error: err.message });
  }
});
// GET /preplacement/students/:id/interviews?month=YYYY-MM or &from=&to=
router.get("/students/:id/interviews", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });

    const { from, to } = getDateRange(req.query);
    const doc = await PrePlacementStudent.findById(id).lean();
    if (doc.status === "PLACED") {
      return res
        .status(409)
        .json({ error: "Cannot add interviews for PLACED students" });
    }

    if (!doc) return res.status(404).json({ error: "Not found" });

    let ints = (doc.interviews || []).slice();
    if (from || to) {
      ints = ints.filter((iv) => {
        const d = new Date(iv.scheduledAt);
        if (isNaN(d)) return false;
        if (from && d < from) return false;
        if (to && d >= to) return false;
        return true;
      });
    }
    ints.sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));

    res.json({ studentId: id, zone: doc.zone, interviews: ints });
  } catch (err) {
    console.error("list interviews error:", err);
    res.status(500).json({ error: err.message });
  }
});
// PATCH /preplacement/students/:id/interviews/:interviewId
router.patch("/students/:id/interviews/:interviewId", async (req, res) => {
  try {
    const { id, interviewId } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });

    const doc = await PrePlacementStudent.findById(id);
    if (doc.status === "PLACED") {
      return res
        .status(409)
        .json({ error: "Cannot update interviews for PLACED students" });
    }

    if (!doc) return res.status(404).json({ error: "Not found" });

    const iv = doc.interviews.id(interviewId);
    if (!iv) return res.status(404).json({ error: "Interview not found" });

    const b = req.body || {};
    if (b.company !== undefined) iv.company = String(b.company || "").trim();
    if (b.round !== undefined)
      iv.round = String(b.round || "").trim() || undefined;
    if (b.remarks !== undefined)
      iv.remarks = String(b.remarks || "").trim() || undefined;

    if (b.status !== undefined) {
      const st = String(b.status || "").toUpperCase();
      if (!["SCHEDULED", "COMPLETED", "CANCELLED"].includes(st))
        return res.status(400).json({ error: "Invalid status" });
      iv.status = st;
    }

    if (
      b.scheduledAt !== undefined ||
      b.date !== undefined ||
      b.time !== undefined
    ) {
      const sched = parseDateTime({
        scheduledAt: b.scheduledAt,
        date: b.date,
        time: b.time,
        tz: b.tz || "Asia/Kolkata",
      });
      if (!sched) return res.status(400).json({ error: "Invalid date/time" });
      iv.scheduledAt = sched;
    }

    await doc.save();
    res.json({ ok: true, interview: iv });
  } catch (err) {
    console.error("update interview error:", err);
    res.status(500).json({ error: err.message });
  }
});
// GET /preplacement/green/interviews?month=YYYY-MM or &from=&to=&company=&round=
router.get("/green/interviews", async (req, res) => {
  try {
    const { from, to } = getDateRange(req.query);
    const company = String(req.query.company || "").trim();
    const round = String(req.query.round || "").trim();

    const pipeline = [
      { $match: { zone: "GREEN", status: { $ne: "PLACED" } } },
      { $unwind: { path: "$interviews", preserveNullAndEmptyArrays: false } },
      ...(from || to
        ? [
            {
              $match: {
                "interviews.scheduledAt": {
                  ...(from ? { $gte: from } : {}),
                  ...(to ? { $lt: to } : {}),
                },
              },
            },
          ]
        : []),
      ...(company
        ? [
            {
              $match: {
                "interviews.company": { $regex: company, $options: "i" },
              },
            },
          ]
        : []),
      ...(round
        ? [{ $match: { "interviews.round": { $regex: round, $options: "i" } } }]
        : []),
      { $sort: { "interviews.scheduledAt": -1 } },
      {
        $group: {
          _id: "$_id",
          name: { $first: "$name" },
          courseName: { $first: "$courseName" },
          status: { $first: "$status" },
          latestInterview: { $first: "$interviews" },
        },
      },
      { $sort: { "latestInterview.scheduledAt": -1 } },
    ];

    const rows = await PrePlacementStudent.aggregate(pipeline);
    res.json({ rows });
  } catch (err) {
    console.error("green interviews list error:", err);
    res.status(500).json({ error: err.message });
  }
});
// routes/preplacementRoutes.js (add somewhere below your other routes)
router.get("/placements/summary", async (req, res) => {
  try {
    const { month, from, to } = req.query;
    // support ?month=YYYY-MM or from/to filters on placementMonth
    let range = {};
    if (month) {
      const [y, m] = String(month).split("-").map(Number);
      if (y && m) {
        const start = new Date(Date.UTC(y, m - 1, 1));
        const end = new Date(
          Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)
        );
        range = { placementMonth: { $gte: start, $lt: end } };
      }
    } else if (from || to) {
      range = {
        placementMonth: {
          ...(from ? { $gte: new Date(String(from)) } : {}),
          ...(to ? { $lt: new Date(String(to)) } : {}),
        },
      };
    }

    const rows = await PrePlacementStudent.aggregate([
      { $match: { placementMonth: { $type: "date" }, ...range } },
      {
        $group: {
          _id: "$placementMonth",
          count: { $sum: 1 },
          students: {
            $push: { _id: "$_id", name: "$name", courseName: "$courseName" },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({ rows });
  } catch (err) {
    console.error("placements summary error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
