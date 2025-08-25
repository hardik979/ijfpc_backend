// routes/aiChat.js
import express from "express";
import { model as geminiModel } from "../ai/gemini.js";
import {
  PlanSchema,
  buildMatch,
  monthName,
  inferTimeFromMessage,
} from "../ai/plan.js";
import PostPlacementOffer from "../models/PostPlacementOffer.js";

const router = express.Router();

/**
 * POST /api/ai/chat
 * Body: { message: string }
 * Replies:
 *  - { ok:true, type:"text", text:string }
 *  - { ok:true, type:"list", rows:[...] }
 *  - { ok:true, type:"chart", chart:{kind,xKey,yKeys}, data:[...], unit?, summary? }
 */
router.post("/ai/chat", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) {
      return res.status(400).json({ ok: false, error: "message required" });
    }

    // 1) Get a strictly-typed plan from Gemini
    const resp = await geminiModel.generateContent({
      contents: [{ role: "user", parts: [{ text: message }] }],
    });

    const raw = resp.response.text(); // JSON string
    let plan;
    try {
      plan = PlanSchema.parse(JSON.parse(raw));
    } catch (e) {
      return res
        .status(400)
        .json({ ok: false, error: "LLM did not return valid JSON", raw });
    }

    // 2) Fallback: infer time from message if LLM omitted them
    const inferred = inferTimeFromMessage(message);
    plan.time = plan.time || {};
    if (!plan.time.month && inferred.month) plan.time.month = inferred.month;
    if (!plan.time.year && inferred.year) plan.time.year = inferred.year;
    if (plan.time.month && !plan.time.year) {
      plan.time.year = new Date().getFullYear();
    }

    // 3) Build IST-accurate match (range on offerDate)
    const match = buildMatch(plan);

    // 4) Execute intent
    if (plan.intent === "COUNT_PLACEMENTS") {
      const count = await PostPlacementOffer.countDocuments(match);
      let whenTxt = "";
      if (plan?.time?.year && plan?.time?.month)
        whenTxt = `${monthName(plan.time.month)} ${plan.time.year}`;
      else if (plan?.time?.year) whenTxt = `${plan.time.year}`;

      return res.json({
        ok: true,
        type: "text",
        text: `Students placed${whenTxt ? " in " + whenTxt : ""}: ${count}.`,
      });
    }

    if (plan.intent === "LIST_PLACEMENTS") {
      const docs = await PostPlacementOffer.find(match, {
        studentName: 1,
        companyName: 1,
        location: 1,
        packageLPA: 1,
        offerDate: 1,
      })
        .sort({ offerDate: 1 })
        .lean();

      return res.json({ ok: true, type: "list", rows: docs });
    }

    if (plan.intent === "CHART_PLACEMENTS_BY_STUDENT") {
      // dataset for Recharts: [{ studentName, packageLPA }]
      const docs = await PostPlacementOffer.aggregate([
        { $match: match },
        { $project: { _id: 0, studentName: 1, packageLPA: 1 } },
        { $sort: { studentName: 1 } },
      ]);

      const whenTxt =
        plan?.time?.year && plan?.time?.month
          ? `${monthName(plan.time.month)} ${plan.time.year}`
          : "";

      const chart =
        plan.chart?.kind && plan.chart?.xKey && plan.chart?.yKeys?.length
          ? plan.chart
          : { kind: "bar", xKey: "studentName", yKeys: ["packageLPA"] };

      return res.json({
        ok: true,
        type: "chart",
        summary: `${docs.length} student${docs.length === 1 ? "" : "s"} placed${
          whenTxt ? ` in ${whenTxt}` : ""
        }.`,
        chart,
        data: docs,
        unit: "LPA",
      });
    }

    if (plan.intent === "CHART_MONTHLY_TREND") {
      // Ensure we have a year; default to current
      const year =
        plan?.time?.year && Number.isInteger(plan.time.year)
          ? plan.time.year
          : new Date().getFullYear();

      // Count placements per month for that year
      const docs = await PostPlacementOffer.aggregate([
        { $match: buildMatch({ time: { year } }) }, // reuse IST range
        {
          $group: {
            _id: { $month: "$offerDate" }, // already in UTC, but we used IST-aligned ranges above
            count: { $sum: 1 },
          },
        },
        { $project: { _id: 0, month: "$_id", count: 1 } },
        { $sort: { month: 1 } },
      ]);

      const data = docs.map((d) => ({
        month: monthName(d.month),
        count: d.count,
      }));

      return res.json({
        ok: true,
        type: "chart",
        summary: `Monthly placement trend for ${year}.`,
        chart: { kind: "line", xKey: "month", yKeys: ["count"] },
        data,
      });
    }

    return res.status(400).json({ ok: false, error: "Unhandled intent", plan });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
