// routes/aiQuery.js
import express from "express";
import { universalModel } from "../ai/gemini_universal.js";
import {
  UniversalPlanSchema,
  compileAggregation,
  buildMatchFromPlan,
  monthName,
  looksLikeRankingQuestion,
  guessGroupByFromMessage,
  inferTimeFromMessage,
  applySemanticPostprocessing,
} from "../ai/universalPlan.js";
import PostPlacementOffer from "../models/PostPlacementOffer.js";

export async function aiQueryHandler(req, res) {
  try {
    const { message, debug } = req.body || {};
    if (!message)
      return res.status(400).json({ ok: false, error: "message required" });

    // 1) Ask Gemini for a universal plan
    const r = await universalModel.generateContent({
      contents: [{ role: "user", parts: [{ text: message }] }],
    });
    const raw = r.response.text();

    let plan;
    try {
      plan = UniversalPlanSchema.parse(JSON.parse(raw));
    } catch (e) {
      return res
        .status(400)
        .json({ ok: false, error: "Plan JSON invalid", raw });
    }

    // 2) Semantic post-processing (generic; no per-question code)
    //    - adds remainingFee > 0 for “remaining/due/outstanding/unpaid”
    //    - adds remainingFee <= 0 for “paid in full/no due”
    //    - removes accidental offerDate exists when user didn’t ask about placements
    plan = applySemanticPostprocessing(plan, message);

    // 3) If it’s a ranking-style question but the plan is still a plain count → re-plan to top-1 aggregate
    if (plan.kind === "count" && looksLikeRankingQuestion(message)) {
      const gb = guessGroupByFromMessage(message);
      const inferred = inferTimeFromMessage(message);
      plan = {
        kind: "aggregate",
        filters: [{ field: "offerDate", op: "exists" }], // ranking implies placements
        groupBy: [gb],
        metrics: [{ op: "count", as: "count" }],
        sort: [{ by: "count", dir: "desc" }],
        limit: 1,
        ...(inferred.year
          ? { timeRange: { field: "offerDate", year: inferred.year } }
          : {}),
      };
    }

    // ---------- Execute ----------
    if (plan.kind === "count" && (!plan.groupBy || plan.groupBy.length === 0)) {
      const match = buildMatchFromPlan(plan);
      const count = await PostPlacementOffer.countDocuments(match);
      return res.json({
        ok: true,
        type: "text",
        text: String(count),
        ...(debug ? { _debug: { raw, plan, match } } : {}),
      });
    }

    if (plan.kind === "list") {
      const match = buildMatchFromPlan(plan);
      const proj = {};
      (
        plan.projection || [
          "studentName",
          "companyName",
          "location",
          "packageLPA",
          "offerDate",
        ]
      ).forEach((k) => (proj[k] = 1));
      const docs = await PostPlacementOffer.find(match, proj)
        .limit(plan.limit || 50)
        .sort({ offerDate: 1 })
        .lean();
      return res.json({
        ok: true,
        type: "list",
        rows: docs,
        ...(debug ? { _debug: { raw, plan, match } } : {}),
      });
    }

    if (plan.kind === "aggregate" || plan.kind === "chart") {
      const pipeline = compileAggregation(plan);
      if (
        pipeline.some(
          (st) => "$out" in st || "$merge" in st || "$function" in st
        )
      ) {
        return res
          .status(400)
          .json({ ok: false, error: "Forbidden stage in pipeline" });
      }
      const agg = await PostPlacementOffer.aggregate(pipeline).option({
        maxTimeMS: 10000,
        allowDiskUse: false,
      });

      if (plan.kind === "chart") {
        const chart = plan.chart || { kind: "bar", x: "x", y: ["y"] };
        return res.json({
          ok: true,
          type: "chart",
          chart: { kind: chart.kind, xKey: chart.x, yKeys: chart.y },
          data: agg,
          ...(debug ? { _debug: { raw, plan, pipeline } } : {}),
        });
      }

      // Friendly single line for top-1 aggregates
      if (
        plan.groupBy &&
        plan.metrics?.some((m) => m.op === "count") &&
        plan.limit === 1
      ) {
        const top = agg[0];
        const countField =
          plan.metrics.find((m) => m.op === "count")?.as || "count";
        const n = top?.[countField] ?? 0;
        const monthKey = top?.tb0 || top?.tb1;
        let text;
        if (monthKey instanceof Date) {
          const label = `${monthName(
            monthKey.getUTCMonth() + 1
          )} ${monthKey.getUTCFullYear()}`;
          text = `Most placements in ${label}: ${n} students.`;
        } else if (typeof top?.companyName === "string") {
          text = `Most placements by ${top.companyName}: ${n} students.`;
        } else if (typeof top?.location === "string") {
          text = `Most placements in ${top.location}: ${n} students.`;
        } else {
          text = `Top group count: ${n}.`;
        }
        return res.json({
          ok: true,
          type: "text",
          text,
          data: agg,
          ...(debug ? { _debug: { raw, plan, pipeline } } : {}),
        });
      }

      return res.json({
        ok: true,
        type: "list",
        rows: agg,
        ...(debug ? { _debug: { raw, plan, pipeline } } : {}),
      });
    }

    return res
      .status(400)
      .json({ ok: false, error: "Unsupported plan.kind", plan });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

const router = express.Router();
router.post("/ai/query", aiQueryHandler);
export default router;
