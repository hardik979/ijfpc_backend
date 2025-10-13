import express from "express";
import TimesheetWorkday from "../models/timesheet_workday.js";
import { toDayKey } from "./_time.js";
import { requireAuth } from "@clerk/express";

const router = express.Router();

/** ========= EOD (manager view) =========
 * GET /api/reports/eod?day=YYYY-MM-DD (optional; defaults today)
 * Returns each staff member's tasks summary for the day.
 */
router.get("/reports/eod", requireAuth(), async (req, res) => {
  try {
    const dayKey = req.query.day || toDayKey();

    const rows = await TimesheetWorkday.find({ dayKey })
      .select(
        "clerkId name email clockIn clockOut tasks totalTaskMinutes breakTotalMin totalPaidMinutes"
      )
      .sort({ name: 1 })
      .lean();

    // shape summary
    const data = rows.map((r) => ({
      name: r.name || r.email,
      email: r.email,
      clockIn: r.clockIn,
      clockOut: r.clockOut || null,
      totalTaskMinutes: r.totalTaskMinutes || 0,
      breakMinutes: r.breakTotalMin || 0,
      totalPaidMinutes: r.totalPaidMinutes || 0,
      tasks: (r.tasks || []).map((t) => ({
        title: t.title,
        start: t.start,
        end: t.end,
        durationMin: t.durationMin,
        notes: t.notes,
        tags: t.tags,
      })),
    }));

    return res.json({ ok: true, dayKey, data });
  } catch (err) {
    console.error("eod report error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
