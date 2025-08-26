// routes/hr.js
import express from "express";
import PostPlacementOffer from "../models/PostPlacementOffer.js";

const router = express.Router();

/**
 * GET /api/hr
 * Returns a deduped HR directory with stats.
 * Query params:
 *  - q: free text (matches name/email/phone/company/student)
 *  - company: filter by company (regex, case-insensitive)
 *  - hasEmail=true : only entries with email
 */
router.get("/", async (req, res) => {
  try {
    const { q, company, hasEmail } = req.query;

    const match = {};
    if (company) match.companyName = { $regex: company, $options: "i" };
    if (q) {
      match.$or = [
        { "hr.name": { $regex: q, $options: "i" } },
        { "hr.email": { $regex: q, $options: "i" } },
        { "hr.contactNumber": { $regex: q, $options: "i" } },
        { companyName: { $regex: q, $options: "i" } },
        { studentName: { $regex: q, $options: "i" } },
      ];
    }
    if (hasEmail === "true") {
      match["hr.email"] = { $exists: true, $ne: "" };
    }

    // Build a stable dedupe key: email → phone → name|company
    const dedupeKey = {
      $cond: [
        {
          $and: [{ $ifNull: ["$hr.email", false] }, { $ne: ["$hr.email", ""] }],
        },
        { $toLower: "$hr.email" },
        {
          $cond: [
            {
              $and: [
                { $ifNull: ["$hr.contactNumber", false] },
                { $ne: ["$hr.contactNumber", ""] },
              ],
            },
            "$hr.contactNumber",
            {
              $concat: [
                { $ifNull: ["$hr.name", "UNKNOWN"] },
                "|",
                { $ifNull: ["$companyName", ""] },
              ],
            },
          ],
        },
      ],
    };

    const pipeline = [
      { $match: match },
      { $addFields: { __key: dedupeKey } },
      {
        $group: {
          _id: "$__key",
          emails: { $addToSet: "$hr.email" },
          names: { $addToSet: "$hr.name" },
          phones: { $addToSet: "$hr.contactNumber" },
          companies: { $addToSet: "$companyName" },
          offersCount: { $sum: 1 },
          students: { $addToSet: "$studentName" },
          lastOfferDate: { $max: "$offerDate" },
        },
      },
      {
        $project: {
          _id: 0,
          key: "$_id",
          canonicalEmail: { $first: "$emails" },
          emails: {
            $filter: {
              input: "$emails",
              as: "e",
              cond: { $and: [{ $ne: ["$$e", null] }, { $ne: ["$$e", ""] }] },
            },
          },
          names: {
            $filter: {
              input: "$names",
              as: "n",
              cond: { $and: [{ $ne: ["$$n", null] }, { $ne: ["$$n", ""] }] },
            },
          },
          phones: {
            $filter: {
              input: "$phones",
              as: "p",
              cond: { $and: [{ $ne: ["$$p", null] }, { $ne: ["$$p", ""] }] },
            },
          },
          companies: {
            $filter: {
              input: "$companies",
              as: "c",
              cond: { $and: [{ $ne: ["$$c", null] }, { $ne: ["$$c", ""] }] },
            },
          },
          offersCount: 1,
          studentsCount: { $size: "$students" },
          lastOfferDate: 1,
        },
      },
      { $sort: { lastOfferDate: -1, offersCount: -1 } },
    ];

    const data = await PostPlacementOffer.aggregate(pipeline);
    res.json(data);
  } catch (err) {
    console.error("GET /api/hr error:", err);
    res.status(500).json({ error: "Failed to build HR directory" });
  }
});

/**
 * GET /api/hr/offers?key=...
 * Returns all offers tied to a given HR key (from /api/hr response).
 */
router.get("/offers", async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: "Missing ?key" });

    const dedupeKey = {
      $cond: [
        {
          $and: [{ $ifNull: ["$hr.email", false] }, { $ne: ["$hr.email", ""] }],
        },
        { $toLower: "$hr.email" },
        {
          $cond: [
            {
              $and: [
                { $ifNull: ["$hr.contactNumber", false] },
                { $ne: ["$hr.contactNumber", ""] },
              ],
            },
            "$hr.contactNumber",
            {
              $concat: [
                { $ifNull: ["$hr.name", "UNKNOWN"] },
                "|",
                { $ifNull: ["$companyName", ""] },
              ],
            },
          ],
        },
      ],
    };

    const pipeline = [
      { $addFields: { __key: dedupeKey } },
      { $match: { __key: key } },
      {
        $project: {
          studentName: 1,
          companyName: 1,
          offerDate: 1,
          joiningDate: 1,
          "hr.name": 1,
          "hr.email": 1,
          "hr.contactNumber": 1,
          totalPostPlacementFee: 1,
          discount: 1,
          remainingFee: 1,
          createdAt: 1,
        },
      },
      { $sort: { offerDate: -1, _id: -1 } },
    ];

    const rows = await PostPlacementOffer.aggregate(pipeline);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/hr/offers error:", err);
    res.status(500).json({ error: "Failed to fetch HR offers" });
  }
});

/**
 * GET /api/hr/export.csv
 * Exports a concise HR directory CSV.
 */
router.get("/export.csv", async (req, res) => {
  try {
    const dedupeKey = {
      $cond: [
        {
          $and: [{ $ifNull: ["$hr.email", false] }, { $ne: ["$hr.email", ""] }],
        },
        { $toLower: "$hr.email" },
        {
          $cond: [
            {
              $and: [
                { $ifNull: ["$hr.contactNumber", false] },
                { $ne: ["$hr.contactNumber", ""] },
              ],
            },
            "$hr.contactNumber",
            {
              $concat: [
                { $ifNull: ["$hr.name", "UNKNOWN"] },
                "|",
                { $ifNull: ["$companyName", ""] },
              ],
            },
          ],
        },
      ],
    };

    const rows = await PostPlacementOffer.aggregate([
      { $addFields: { __key: dedupeKey } },
      {
        $group: {
          _id: "$__key",
          name: { $first: "$hr.name" },
          email: { $first: "$hr.email" },
          phone: { $first: "$hr.contactNumber" },
          companies: { $addToSet: "$companyName" },
          offers: { $sum: 1 },
          students: { $addToSet: "$studentName" },
          lastOfferDate: { $max: "$offerDate" },
        },
      },
      {
        $project: {
          _id: 0,
          key: "$_id",
          name: 1,
          email: 1,
          phone: 1,
          companies: 1,
          offers,
          studentsCount: { $size: "$students" },
          lastOfferDate: 1,
        },
      },
      { $sort: { lastOfferDate: -1 } },
    ]);

    // Flatten "companies" array for CSV
    const flat = rows.map((r) => ({
      ...r,
      companies: (r.companies || []).filter(Boolean).join(", "),
    }));

    const { Parser } = await import("json2csv");
    const parser = new Parser({
      fields: [
        "key",
        "name",
        "email",
        "phone",
        "companies",
        "offers",
        "studentsCount",
        "lastOfferDate",
      ],
    });
    const csv = parser.parse(flat);

    res.header("Content-Type", "text/csv");
    res.attachment("hr-directory.csv");
    res.send(csv);
  } catch (err) {
    console.error("GET /api/hr/export.csv error:", err);
    res.status(500).json({ error: "Failed to export CSV" });
  }
});

export default router;
