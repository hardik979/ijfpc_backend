// routes/adminDebug.js
import express from "express";
import PostPlacementOffer from "../models/PostPlacementOffer.js";
import { buildMatch } from "../ai/plan.js";

const r = express.Router();

// Count placements for a given month/year (IST-accurate)
r.get("/admin/debug/month", async (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!year || !month)
    return res.status(400).json({ ok: false, error: "year & month required" });

  const count = await PostPlacementOffer.countDocuments(
    buildMatch({ time: { year, month } })
  );
  const rows = await PostPlacementOffer.find(
    buildMatch({ time: { year, month } }),
    {
      studentName: 1,
      companyName: 1,
      offerDate: 1,
      packageLPA: 1,
      location: 1,
    }
  )
    .sort({ offerDate: 1 })
    .lean();

  res.json({ ok: true, year, month, count, sample: rows.slice(0, 10) });
});

// Count by month in a year
r.get("/admin/debug/year", async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = await PostPlacementOffer.aggregate([
    { $match: buildMatch({ time: { year } }) },
    { $group: { _id: { $month: "$offerDate" }, count: { $sum: 1 } } },
    { $project: { _id: 0, month: "$_id", count: 1 } },
    { $sort: { month: 1 } },
  ]);
  res.json({ ok: true, year, rows });
});

export default r;
