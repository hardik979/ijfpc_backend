// ai/universalPlan.js
import { z } from "zod";
import { CATALOG } from "./catalog.js";

const FilterOp = z.enum(
  ["=", "!=", " >", ">=", "<", "<=", "contains", "in", "between", "exists"].map(
    (s) => s.trim()
  )
);
const MetricOp = z.enum(["count", "sum", "avg", "min", "max"]);
const TimeUnit = z.enum(["day", "week", "month", "quarter", "year"]);

const FilterSchema = z.object({
  field: z.string(),
  op: FilterOp,
  value: z.any().optional(),
  start: z.any().optional(),
  end: z.any().optional(),
});

const MetricSchema = z.object({
  op: MetricOp,
  field: z.string().optional(),
  as: z.string().optional(),
});

const GroupKey = z.union([
  z.string(),
  z.object({ timeBucket: z.object({ field: z.string(), unit: TimeUnit }) }),
]);

const ChartSchema = z
  .object({
    kind: z.enum(["bar", "line", "pie"]).optional(),
    x: z.string().optional(),
    y: z.array(z.string()).optional(),
  })
  .optional();

export const UniversalPlanSchema = z.object({
  kind: z.enum(["count", "list", "aggregate", "chart"]).default("count"),
  filters: z.array(FilterSchema).optional(),
  timeRange: z
    .object({
      field: z.string().default("offerDate"),
      year: z.number().int().optional(),
      month: z.number().int().min(1).max(12).optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      timezone: z.string().default(CATALOG.timezone),
    })
    .optional(),
  groupBy: z.array(GroupKey).optional(),
  metrics: z.array(MetricSchema).optional(),
  sort: z
    .array(
      z.object({ by: z.string(), dir: z.enum(["asc", "desc"]).default("desc") })
    )
    .optional(),
  limit: z.number().int().min(1).max(200).optional(),
  projection: z.array(z.string()).optional(),
  chart: ChartSchema,
  answerTemplate: z.string().optional(),
});

// ---- IST helpers ----
function istMonthRangeUTC(year, month) {
  const startUTC = new Date(Date.UTC(year, month - 1, 1, -5, -30, 0));
  const endUTC =
    month === 12
      ? new Date(Date.UTC(year + 1, 0, 1, -5, -30, 0))
      : new Date(Date.UTC(year, month, 1, -5, -30, 0));
  return { $gte: startUTC, $lt: endUTC };
}
function istYearRangeUTC(year) {
  const startUTC = new Date(Date.UTC(year, 0, 1, -5, -30, 0));
  const endUTC = new Date(Date.UTC(year + 1, 0, 1, -5, -30, 0));
  return { $gte: startUTC, $lt: endUTC };
}

export function monthName(m) {
  return (
    [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ][m - 1] || ""
  );
}

// ---- Match builder ----
export function buildMatchFromPlan(plan) {
  const match = {};
  for (const fil of plan.filters || []) {
    const field = fil.field;
    const op = String(fil.op).trim();
    switch (op) {
      case "=":
        match[field] = fil.value;
        break;
      case "!=":
        match[field] = { $ne: fil.value };
        break;
      case ">":
        match[field] = { ...(match[field] || {}), $gt: fil.value };
        break;
      case ">=":
        match[field] = { ...(match[field] || {}), $gte: fil.value };
        break;
      case "<":
        match[field] = { ...(match[field] || {}), $lt: fil.value };
        break;
      case "<=":
        match[field] = { ...(match[field] || {}), $lte: fil.value };
        break;
      case "contains":
        match[field] = { $regex: String(fil.value || ""), $options: "i" };
        break;
      case "in":
        match[field] = {
          $in: Array.isArray(fil.value) ? fil.value : [fil.value],
        };
        break;
      case "between":
        match[field] = {
          ...(fil.start != null ? { $gte: fil.start } : {}),
          ...(fil.end != null ? { $lt: fil.end } : {}),
        };
        break;
      case "exists":
        match[field] = { $ne: null };
        break;
    }
  }
  if (plan.timeRange) {
    const f = plan.timeRange.field || "offerDate";
    if (plan.timeRange.year && plan.timeRange.month)
      match[f] = istMonthRangeUTC(plan.timeRange.year, plan.timeRange.month);
    else if (plan.timeRange.year)
      match[f] = istYearRangeUTC(plan.timeRange.year);
    else if (plan.timeRange.start || plan.timeRange.end) {
      match[f] = {
        ...(plan.timeRange.start
          ? { $gte: new Date(plan.timeRange.start) }
          : {}),
        ...(plan.timeRange.end ? { $lt: new Date(plan.timeRange.end) } : {}),
      };
    }
  }
  return match;
}

// ---- Aggregation compiler ----
export function compileAggregation(plan) {
  const pipeline = [];
  const match = buildMatchFromPlan(plan);
  if (Object.keys(match).length) pipeline.push({ $match: match });

  if (plan.groupBy?.length || plan.metrics?.length) {
    const id = {};
    const addFields = {};
    (plan.groupBy || []).forEach((g, idx) => {
      if (typeof g === "string") id[g] = `$${g}`;
      else if (g?.timeBucket) {
        const { field, unit } = g.timeBucket;
        addFields[`__tb${idx}`] = {
          $dateTrunc: { date: `$${field}`, unit, timezone: CATALOG.timezone },
        };
        id[`tb${idx}`] = `$__tb${idx}`;
      }
    });
    if (Object.keys(addFields).length) pipeline.push({ $addFields: addFields });

    const group = { _id: Object.keys(id).length ? id : null };
    for (const m of plan.metrics || []) {
      const as = m.as || m.op + (m.field ? `_${m.field}` : "");
      if (m.op === "count") group[as] = { $sum: 1 };
      if (m.op === "sum") group[as] = { $sum: `$${m.field}` };
      if (m.op === "avg") group[as] = { $avg: `$${m.field}` };
      if (m.op === "min") group[as] = { $min: `$${m.field}` };
      if (m.op === "max") group[as] = { $max: `$${m.field}` };
    }
    pipeline.push({ $group: group });

    const proj = {};
    if (group._id && typeof group._id === "object")
      for (const k of Object.keys(group._id)) proj[k] = `$_id.${k}`;
    for (const m of plan.metrics || []) {
      const as = m.as || m.op + (m.field ? `_${m.field}` : "");
      proj[as] = `$${as}`;
    }
    if (Object.keys(proj).length) pipeline.push({ $project: proj });
  }

  if (plan.sort?.length) {
    const sort = {};
    for (const s of plan.sort) sort[s.by] = s.dir === "asc" ? 1 : -1;
    pipeline.push({ $sort: sort });
  }
  if (plan.limit) pipeline.push({ $limit: Math.min(plan.limit, 200) });
  return pipeline;
}

// ---- NLP helpers & semantic post-processing ----
export function inferTimeFromMessage(message) {
  const m = (message || "").toLowerCase();
  const months = [
    ["january", "jan"],
    ["february", "feb"],
    ["march", "mar"],
    ["april", "apr"],
    ["may"],
    ["june", "jun"],
    ["july", "jul"],
    ["august", "aug"],
    ["september", "sep", "sept"],
    ["october", "oct"],
    ["november", "nov"],
    ["december", "dec"],
  ];
  let month;
  for (let i = 0; i < months.length; i++)
    if (months[i].some((w) => m.includes(w))) {
      month = i + 1;
      break;
    }
  const ym = m.match(/\b(20\d{2})\b/);
  const year = ym ? Number(ym[1]) : undefined;
  return { month, year };
}

export function looksLikeRankingQuestion(message) {
  const m = (message || "").toLowerCase();
  const hasMost = /(most|maximum|highest|top|max|peak)/.test(m);
  const hasWhich = /(which|what)/.test(m);
  const aboutPlacements = /(plac|hired|hire|placement)/.test(m);
  return (hasWhich || hasMost) && aboutPlacements;
}

export function guessGroupByFromMessage(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("month"))
    return { timeBucket: { field: "offerDate", unit: "month" } };
  if (m.includes("company")) return "companyName";
  if (m.includes("location") || m.includes("city")) return "location";
  return { timeBucket: { field: "offerDate", unit: "month" } };
}

export function applySemanticPostprocessing(plan, message) {
  const m = (message || "").toLowerCase();
  const mentionPlaced = /(plac|placement|placed|offer)/.test(m);
  const mentionOutstanding =
    /(remaining|outstanding|due|dues|balance|unpaid)/.test(m);
  const mentionPaidFull =
    /(paid in full|no due|no dues|0 due|zero due|account closed)/.test(m);

  const filters = [...(plan.filters || [])];

  const hasFilter = (field, op) =>
    filters.some((f) => f.field === field && String(f.op).trim() === op);

  const addFilter = (f) => {
    if (!hasFilter(f.field, String(f.op).trim())) filters.push(f);
  };

  // If user did NOT mention placements but the plan added "offerDate exists", drop it.
  if (!mentionPlaced) {
    const cleaned = filters.filter(
      (f) => !(f.field === "offerDate" && String(f.op).trim() === "exists")
    );
    if (cleaned.length !== filters.length) plan.filters = cleaned;
  }

  // Outstanding dues → remainingFee > 0
  if (mentionOutstanding)
    addFilter({ field: "remainingFee", op: ">", value: 0 });

  // Paid in full → remainingFee <= 0
  if (mentionPaidFull) addFilter({ field: "remainingFee", op: "<=", value: 0 });

  // Write back if we added anything
  if (filters.length) plan.filters = filters;

  // If they asked "how many" and kind isn't set, keep as count
  if (!plan.kind) plan.kind = "count";

  return plan;
}
