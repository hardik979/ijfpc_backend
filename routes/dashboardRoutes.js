// routes/dashboardRoutes.js
import express from "express";
import mongoose from "mongoose";
import PrePlacementStudent from "../models/PrePlacementStudent.js";
import PostPlacementOffer from "../models/PostPlacementOffer.js";

const router = express.Router();

/* Shared date util (match your existing getDateRange) */
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

/** GET /api/dashboard/summary?month=YYYY-MM (or from=&to=)
 * Returns:
 * {
 *   students: { total, byStatus: { ACTIVE, PAUSED, PLACED, DROPPED } },
 *   revenue: {
 *     total,                // pre.net + post.collected
 *     pre:  { gross, refunds, net, inRange },
 *     post: { collected, inRange },
 *     monthly: [ { y, m, preNet, postCollected, total } ] // optional series
 *   }
 * }
 */
router.get("/summary", async (req, res) => {
  try {
    const { from, to } = getDateRange(req.query);
    const dateMatchPre = hasRange({ from, to })
      ? {
          "txns.date": {
            ...(from ? { $gte: from } : {}),
            ...(to ? { $lt: to } : {}),
          },
        }
      : null;
    const dateMatchPost = hasRange({ from, to })
      ? {
          "installments.date": {
            ...(from ? { $gte: from } : {}),
            ...(to ? { $lt: to } : {}),
          },
        }
      : null;

    // ---------- PRE: status counts + money ----------
    const [preAgg] = await PrePlacementStudent.aggregate([
      {
        $project: {
          status: 1,
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
          statusCounts: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          moneyOverall: [
            {
              $group: {
                _id: null,
                gross: { $sum: "$totalReceived" },
                refunds: { $sum: "$totalRefunded" },
                net: { $sum: "$netCollected" },
                totalStudents: { $sum: 1 },
              },
            },
          ],
          moneyInRange: [
            { $unwind: { path: "$txns", preserveNullAndEmptyArrays: false } },
            ...(dateMatchPre ? [{ $match: dateMatchPre }] : []),
            { $group: { _id: null, inRange: { $sum: "$txns.amount" } } }, // net in range
          ],
          monthlyPre: [
            { $unwind: { path: "$txns", preserveNullAndEmptyArrays: false } },
            { $match: { "txns.date": { $type: "date" } } },
            {
              $group: {
                _id: {
                  y: { $year: "$txns.date" },
                  m: { $month: "$txns.date" },
                },
                preNet: { $sum: "$txns.amount" },
              },
            },
          ],
        },
      },
      {
        $project: {
          statusCountsObj: {
            $arrayToObject: {
              $map: {
                input: "$statusCounts",
                as: "s",
                in: { k: { $ifNull: ["$$s._id", "UNKNOWN"] }, v: "$$s.count" },
              },
            },
          },
          money: {
            gross: { $ifNull: [{ $first: "$moneyOverall.gross" }, 0] },
            refunds: { $ifNull: [{ $first: "$moneyOverall.refunds" }, 0] },
            net: { $ifNull: [{ $first: "$moneyOverall.net" }, 0] },
            totalStudents: {
              $ifNull: [{ $first: "$moneyOverall.totalStudents" }, 0],
            },
            inRange: { $ifNull: [{ $first: "$moneyInRange.inRange" }, 0] },
          },
          monthlyPre: "$monthlyPre",
        },
      },
    ]);

    // ---------- POST: collected from installments ----------
    const [postAgg] = await PostPlacementOffer.aggregate([
      {
        $project: {
          installments: { $ifNull: ["$installments", []] },
        },
      },
      { $unwind: { path: "$installments", preserveNullAndEmptyArrays: false } },
      { $match: { "installments.date": { $type: "date" } } },
      {
        $facet: {
          overall: [
            {
              $group: {
                _id: null,
                collected: { $sum: "$installments.amount" },
              },
            },
          ],
          inRange: [
            ...(dateMatchPost ? [{ $match: dateMatchPost }] : []),
            {
              $group: {
                _id: null,
                collected: { $sum: "$installments.amount" },
              },
            },
          ],
          monthlyPost: [
            {
              $group: {
                _id: {
                  y: { $year: "$installments.date" },
                  m: { $month: "$installments.date" },
                },
                postCollected: { $sum: "$installments.amount" },
              },
            },
          ],
        },
      },
      {
        $project: {
          collected: { $ifNull: [{ $first: "$overall.collected" }, 0] },
          inRange: { $ifNull: [{ $first: "$inRange.collected" }, 0] },
          monthlyPost: "$monthlyPost",
        },
      },
    ]);

    // Merge monthly series (optional if you want charts)
    const monthlyMap = new Map(); // key: y-m
    for (const it of preAgg?.monthlyPre || []) {
      const key = `${it._id.y}-${it._id.m}`;
      monthlyMap.set(key, {
        y: it._id.y,
        m: it._id.m,
        preNet: it.preNet,
        postCollected: 0,
      });
    }
    for (const it of postAgg?.monthlyPost || []) {
      const key = `${it._id.y}-${it._id.m}`;
      const prev = monthlyMap.get(key) || {
        y: it._id.y,
        m: it._id.m,
        preNet: 0,
        postCollected: 0,
      };
      prev.postCollected = it.postCollected;
      monthlyMap.set(key, prev);
    }
    const monthly = Array.from(monthlyMap.values())
      .sort((a, b) => a.y - b.y || a.m - b.m)
      .map((x) => ({ ...x, total: (x.preNet || 0) + (x.postCollected || 0) }));

    const students = {
      total: preAgg?.money?.totalStudents || 0,
      byStatus: {
        ACTIVE: preAgg?.statusCountsObj?.ACTIVE || 0,
        PAUSED: preAgg?.statusCountsObj?.PAUSED || 0,
        PLACED: preAgg?.statusCountsObj?.PLACED || 0,
        DROPPED: preAgg?.statusCountsObj?.DROPPED || 0,
      },
    };

    const pre = {
      gross: preAgg?.money?.gross || 0,
      refunds: preAgg?.money?.refunds || 0,
      net: preAgg?.money?.net || 0,
      inRange: preAgg?.money?.inRange || 0, // net (payments - refunds) in range
    };
    const post = {
      collected: postAgg?.collected || 0,
      inRange: postAgg?.inRange || 0,
    };

    const inRangeTotal = (pre.inRange || 0) + (post.inRange || 0);
    const total = (pre.net || 0) + (post.collected || 0);

    res.json({
      students,
      revenue: {
        total,
        pre,
        post,
        inRangeTotal, // if month/from-to present
        monthly,
      },
      range: hasRange({ from, to }) ? { from, to } : null,
    });
  } catch (err) {
    console.error("dashboard summary error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
