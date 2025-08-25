// ai/plan.js
import { z } from "zod";

/**
 * Strict JSON schema the LLM must return.
 */
export const PlanSchema = z.object({
  intent: z.enum([
    "COUNT_PLACEMENTS",
    "LIST_PLACEMENTS",
    "CHART_PLACEMENTS_BY_STUDENT",
    "CHART_MONTHLY_TREND",
  ]),
  time: z
    .object({
      year: z.number().int().optional(),
      month: z.number().int().min(1).max(12).optional(), // 1..12
    })
    .optional(),
  filters: z
    .object({
      company: z.string().optional(),
      location: z.string().optional(),
    })
    .optional(),
  chart: z
    .object({
      kind: z.enum(["bar", "line", "pie"]).optional(),
      xKey: z.string().optional(),
      yKeys: z.array(z.string()).optional(),
    })
    .optional(),
});

/**
 * Convert month number (1..12) to English name.
 */
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

/**
 * Build an IST-aligned UTC range for a given month.
 * Example: July 2025 IST window = [2025-06-30T18:30:00Z, 2025-07-31T18:30:00Z)
 * We compute in UTC by subtracting the IST offset (5h30m) from IST midnight.
 */
function istMonthRangeUTC(year, month) {
  // Start: 1st of month @ 00:00 IST -> UTC = minus 5:30
  const startUTC = new Date(Date.UTC(year, month - 1, 1, -5, -30, 0));

  // End: 1st of next month @ 00:00 IST -> UTC = minus 5:30
  const endUTC =
    month === 12
      ? new Date(Date.UTC(year + 1, 0, 1, -5, -30, 0))
      : new Date(Date.UTC(year, month, 1, -5, -30, 0));

  return { $gte: startUTC, $lt: endUTC };
}

/**
 * IST-aligned UTC range for whole year.
 */
function istYearRangeUTC(year) {
  const startUTC = new Date(Date.UTC(year, 0, 1, -5, -30, 0));
  const endUTC = new Date(Date.UTC(year + 1, 0, 1, -5, -30, 0));
  return { $gte: startUTC, $lt: endUTC };
}

/**
 * Build a MongoDB find() match object using **UTC ranges that represent IST days**,
 * so “July 2025” means midnight IST July 1st to midnight IST Aug 1st.
 * This is index-friendly and avoids $expr/timezone availability differences.
 */
export function buildMatch(plan) {
  const match = {};
  const f = plan?.filters || {};

  if (f.company) match.companyName = { $regex: f.company, $options: "i" };
  if (f.location) match.location = { $regex: f.location, $options: "i" };

  const t = plan?.time || {};
  if (t.year && t.month) {
    match.offerDate = istMonthRangeUTC(t.year, t.month);
  } else if (t.year) {
    match.offerDate = istYearRangeUTC(t.year);
  } else {
    // If no time was specified at all, we consider "placed" = has offerDate
    match.offerDate = { $ne: null };
  }
  return match;
}

/**
 * Infer {month,year} from free text like:
 *  - "in July 2025" => {month:7, year:2025}
 *  - "in July" => {month:7}
 *  - "in 2025" => {year:2025}
 */
export function inferTimeFromMessage(message) {
  if (!message) return {};
  const m = String(message).toLowerCase();

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
  for (let i = 0; i < months.length; i++) {
    if (months[i].some((w) => m.includes(w))) {
      month = i + 1;
      break;
    }
  }

  const yearMatch = m.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;

  return { month, year };
}
