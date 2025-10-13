// routes/hrContacts.stats.js
import express from "express";
import mongoose from "mongoose";
import HrContact from "../models/HrContact.js";
import User from "../models/User.js"; // adjust path if needed

const router = express.Router();

/**
 * GET /api/hr-contacts/stats
 * Query (all optional):
 *  - start=YYYY-MM-DD
 *  - end=YYYY-MM-DD           // inclusive (we add +1 day internally)
 *  - createdBy=id1,id2        // filter by uploader(s)
 *  - useCreatedAt=true        // use createdAt instead of 'date' field
 */
router.get("/stats", async (req, res) => {
  try {
    const { start, end, createdBy, useCreatedAt } = req.query;

    // Build $match
    const match = {};
    const dateField = useCreatedAt === "true" ? "createdAt" : "date";

    if (start || end) {
      match[dateField] = {};
      if (start) match[dateField].$gte = new Date(start);
      if (end) {
        const e = new Date(end);
        e.setDate(e.getDate() + 1); // make inclusive
        match[dateField].$lt = e;
      }
    }

    if (createdBy) {
      const ids = createdBy
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => new mongoose.Types.ObjectId(x));
      if (ids.length) match.createdBy = { $in: ids };
    }

    const isVerifiedExpr = { $in: ["$status", ["red", "yellow", "green"]] };

    const pipeline = [
      { $match: match },
      {
        $facet: {
          overall: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                verified: { $sum: { $cond: [isVerifiedExpr, 1, 0] } },
                notVerified: { $sum: { $cond: [isVerifiedExpr, 0, 1] } },
                red: { $sum: { $cond: [{ $eq: ["$status", "red"] }, 1, 0] } },
                yellow: {
                  $sum: { $cond: [{ $eq: ["$status", "yellow"] }, 1, 0] },
                },
                green: {
                  $sum: { $cond: [{ $eq: ["$status", "green"] }, 1, 0] },
                },
              },
            },
            {
              $project: {
                _id: 0,
                totalUploaded: "$total",
                verified: 1,
                notVerified: 1,
                statusCounts: {
                  red: "$red",
                  yellow: "$yellow",
                  green: "$green",
                },
              },
            },
          ],
          byUser: [
            {
              $group: {
                _id: "$createdBy",
                total: { $sum: 1 },
                verified: { $sum: { $cond: [isVerifiedExpr, 1, 0] } },
                notVerified: { $sum: { $cond: [isVerifiedExpr, 0, 1] } },
                red: { $sum: { $cond: [{ $eq: ["$status", "red"] }, 1, 0] } },
                yellow: {
                  $sum: { $cond: [{ $eq: ["$status", "yellow"] }, 1, 0] },
                },
                green: {
                  $sum: { $cond: [{ $eq: ["$status", "green"] }, 1, 0] },
                },
              },
            },
            {
              $lookup: {
                from: User.collection.name, // usually "users"
                localField: "_id",
                foreignField: "_id",
                as: "user",
              },
            },
            { $addFields: { user: { $first: "$user" } } },
            {
              $project: {
                _id: 0,
                userId: "$_id",
                name: "$user.fullName", // adjust if your User has different fields
                email: "$user.email",
                totalUploaded: "$total",
                verified: 1,
                notVerified: 1,
                statusCounts: {
                  red: "$red",
                  yellow: "$yellow",
                  green: "$green",
                },
              },
            },
            { $sort: { totalUploaded: -1 } },
          ],
        },
      },
      {
        $project: {
          overall: {
            $ifNull: [
              { $arrayElemAt: ["$overall", 0] },
              {
                totalUploaded: 0,
                verified: 0,
                notVerified: 0,
                statusCounts: { red: 0, yellow: 0, green: 0 },
              },
            ],
          },
          byUser: 1,
        },
      },
    ];

    const [result] = await HrContact.aggregate(pipeline);

    res.json({
      filters: {
        start: start || null,
        end: end || null,
        createdBy: createdBy || null,
        usingDateField: dateField,
      },
      overall: result?.overall || {
        totalUploaded: 0,
        verified: 0,
        notVerified: 0,
        statusCounts: { red: 0, yellow: 0, green: 0 },
      },
      byUser: result?.byUser || [],
    });
  } catch (err) {
    console.error("GET /api/hr-contacts/stats error:", err);
    res.status(500).json({ error: err?.message || "Server error" });
  }
});

export default router;
