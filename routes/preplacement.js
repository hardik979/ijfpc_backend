import express from "express";
import mongoose from "mongoose";
import PrePlacementStudent, {
  PREPLACEMENT_STATUSES,
} from "../models/PrePlacementStudent.js";

const router = express.Router();

// -------- Util: date range parsing (supports month=YYYY-MM or from/to ISO) ----------
function getDateRange(q) {
  // month=2024-10 => [2024-10-01T00:00Z, 2024-11-01T00:00Z)
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

// -------- GET /api/preplacement/summary -------------------------------------------
// Totals: totalStudents, totalFee, totalReceived, remainingFee
// Also: collectedInRange (if month/from/to passed), monthly breakdown (within range)
router.get("/summary", async (req, res) => {
  try {
    const { status, course } = req.query;
    const { from, to } = getDateRange(req.query);

    const match = {};
    if (status && PREPLACEMENT_STATUSES.includes(status)) match.status = status;
    if (course) match.courseName = { $regex: String(course), $options: "i" };

    const dateMatch = hasRange({ from, to })
      ? {
          "payments.date": {
            ...(from ? { $gte: from } : {}),
            ...(to ? { $lt: to } : {}),
          },
        }
      : null;

    const pipeline = [
      { $match: match },
      {
        $facet: {
          overall: [
            {
              $group: {
                _id: null,
                totalStudents: { $sum: 1 },
                totalFee: { $sum: "$totalFee" },
                totalReceived: { $sum: "$totalReceived" },
                remainingFee: { $sum: "$remainingFee" },
              },
            },
          ],
          collectedInRange: [
            {
              $unwind: { path: "$payments", preserveNullAndEmptyArrays: false },
            },
            ...(dateMatch ? [{ $match: dateMatch }] : []),
            { $group: { _id: null, collected: { $sum: "$payments.amount" } } },
          ],
          byMonth: [
            {
              $unwind: { path: "$payments", preserveNullAndEmptyArrays: false },
            },
            ...(dateMatch ? [{ $match: dateMatch }] : []),
            {
              $group: {
                _id: {
                  y: { $year: "$payments.date" },
                  m: { $month: "$payments.date" },
                },
                collected: { $sum: "$payments.amount" },
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
          remainingFee: { $ifNull: [{ $first: "$overall.remainingFee" }, 0] },
          collectedInRange: {
            $ifNull: [{ $first: "$collectedInRange.collected" }, 0],
          },
          monthly: "$byMonth",
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

// -------- GET /api/preplacement/students ------------------------------------------
// Paginated list with optional search/status/course filters.
// Supports month/from/to to compute per-student paymentsInRange + collectedInRange.
// Query: ?page=1&limit=20&search=akshay&status=ACTIVE&course=Premium&month=2024-10
router.get("/students", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "20", 10), 1),
      200
    );
    const skip = (page - 1) * limit;

    const { search, status, course } = req.query;
    const { from, to } = getDateRange(req.query);
    const includePayments =
      String(req.query.includePayments || "false") === "true";

    const match = {};
    if (status && PREPLACEMENT_STATUSES.includes(status)) match.status = status;
    if (course) match.courseName = { $regex: String(course), $options: "i" };
    if (search) {
      const rx = { $regex: String(search), $options: "i" };
      match.$or = [{ name: rx }, { courseName: rx }];
    }

    // We compute paymentsInRange and collectedInRange only if a range was supplied
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
            },
          },
          {
            $addFields: {
              collectedInRange: {
                $sum: {
                  $map: {
                    input: "$paymentsInRange",
                    as: "pi",
                    in: "$$pi.amount",
                  },
                },
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
                totalReceived: 1,
                remainingFee: 1,
                status: 1,
                dueDate: 1,
                createdAt: 1,
                updatedAt: 1,
                paymentsCount: { $size: "$payments" },
                ...(hasRange({ from, to })
                  ? {
                      collectedInRange: 1,
                      paymentsInRange: includePayments ? 1 : 0,
                    }
                  : {}),
                ...(includePayments ? { payments: 1 } : {}),
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

// -------- GET /api/preplacement/students/:id --------------------------------------
// Full detail for one student. Supports month/from/to to filter payments shown.
router.get("/students/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });

    const { from, to } = getDateRange(req.query);

    // If range provided, filter payments through aggregation; else findById
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
          },
        },
        {
          $addFields: {
            totalReceivedInRange: {
              $sum: { $map: { input: "$payments", as: "p", in: "$$p.amount" } },
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

// -------- PATCH /api/preplacement/students/:id/status -----------------------------
// Body: { status: "ACTIVE" | "DROPPED" }
router.patch("/students/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });
    if (!PREPLACEMENT_STATUSES.includes(status))
      return res.status(400).json({ error: "Invalid status" });

    const updated = await PrePlacementStudent.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    console.error("status update error:", err);
    res.status(500).json({ error: err.message });
  }
});
router.post("/students/:id/payments", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Invalid id" });
    const p = req.body || {};

    const doc = await PrePlacementStudent.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    const payment = {
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
    };
    doc.payments.push(payment);

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
    if (idx >= doc.payments.length)
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
    if (idx >= doc.payments.length)
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
router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      50
    );
    const skip = (page - 1) * limit;

    const { status, course } = req.query;
    const match = {};
    if (q) {
      const rx = { $regex: q, $options: "i" };
      match.$or = [{ name: rx }, { courseName: rx }];
    }
    if (status && PREPLACEMENT_STATUSES.includes(status)) match.status = status;
    if (course) match.courseName = { $regex: String(course), $options: "i" };

    const [rows, total] = await Promise.all([
      PrePlacementStudent.find(match, {
        name: 1,
        courseName: 1,
        status: 1,
        totalFee: 1,
        totalReceived: 1,
        remainingFee: 1,
      })
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit),
      PrePlacementStudent.countDocuments(match),
    ]);

    res.json({ page, limit, total, rows });
  } catch (err) {
    console.error("search error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
