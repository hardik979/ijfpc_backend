import express from "express";
import { requireAuth, clerkClient } from "@clerk/express";
import TimesheetWorkday, {
  OFFICE_TZ,
  OFFICE_START_MINUTES,
  OFFICE_END_MINUTES,
  MAX_BREAK_MINUTES,
} from "../models/timesheet_workday.js";
import { toDayKey, localMinutes } from "./_time.js";

const router = express.Router();

/** ========= Clock-in (auto, idempotent) =========
 * POST /api/workday/clock-in
 * Creates the user's workday if missing and sets clockIn.
 * If already exists, returns existing document unchanged.
 */
router.post("/workday/clock-in", requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;

    const cu = await clerkClient.users.getUser(userId);
    const email =
      cu?.emailAddresses?.find((e) => e.id === cu.primaryEmailAddressId)
        ?.emailAddress ||
      cu?.emailAddresses?.[0]?.emailAddress ||
      "";
    const name =
      [cu?.firstName, cu?.lastName].filter(Boolean).join(" ") ||
      cu?.username ||
      "";

    const dayKey = toDayKey();

    // If already created, return as-is
    let doc = await TimesheetWorkday.findOne({ clerkId: userId, dayKey });
    if (doc) return res.json({ ok: true, workday: doc });

    // Clock-in timestamp = now; if before office start, still store actual now
    const now = new Date();

    doc = await TimesheetWorkday.create({
      dayKey,
      clerkId: userId,
      email,
      name,
      clockIn: now,
      tasks: [],
      breaks: [],
      breakTotalMin: 0,
      totalTaskMinutes: 0,
      totalPaidMinutes: 0,
    });

    return res.json({ ok: true, workday: doc });
  } catch (err) {
    console.error("clock-in error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/** ========= Add/Update Task =========
 * POST /api/workday/tasks
 * body: { title, notes?, startISO, endISO, tags? , taskId? (for edit) }
 * Validations: inside today's window, no overlap (basic), duration > 0
 */
router.post("/workday/tasks", requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const dayKey = toDayKey();

    const {
      title,
      notes = "",
      startISO,
      endISO,
      tags = [],
      taskId,
    } = req.body || {};
    if (!title || !startISO || !endISO) {
      return res.status(400).json({ error: "Missing title/startISO/endISO" });
    }

    const start = new Date(startISO);
    const end = new Date(endISO);
    if (!(start < end))
      return res.status(400).json({ error: "start must be before end" });

    // Check office window bounds
    const startMin = localMinutes(start);
    const endMin = localMinutes(end);
    if (startMin < OFFICE_START_MINUTES || endMin > OFFICE_END_MINUTES) {
      return res.status(400).json({
        error: `Task must be within office hours 10:15–19:00 ${OFFICE_TZ}`,
      });
    }

    const doc = await TimesheetWorkday.findOne({ clerkId: userId, dayKey });
    if (!doc)
      return res
        .status(404)
        .json({ error: "Workday not found. Clock-in first." });

    // Basic overlap check with existing tasks (excluding self on edit)
    const overlap = doc.tasks.some((t) => {
      if (taskId && String(t._id) === String(taskId)) return false;
      return !(end <= t.start || start >= t.end);
    });
    if (overlap)
      return res
        .status(400)
        .json({ error: "Task overlaps with existing task" });

    const durationMin = Math.round((end - start) / 60000);

    if (taskId) {
      const t = doc.tasks.id(taskId);
      if (!t) return res.status(404).json({ error: "Task not found" });
      t.title = title;
      t.notes = notes;
      t.start = start;
      t.end = end;
      t.durationMin = durationMin;
      t.tags = tags;
    } else {
      doc.tasks.push({ title, notes, start, end, durationMin, tags });
    }

    // Recalculate totals
    const totalTaskMinutes = doc.tasks.reduce(
      (s, t) => s + (t.durationMin || 0),
      0
    );
    const breakTotalMin = doc.breakTotalMin || 0;
    doc.totalTaskMinutes = totalTaskMinutes;
    doc.totalPaidMinutes = Math.max(0, totalTaskMinutes - breakTotalMin);

    await doc.save();
    return res.json({ ok: true, workday: doc });
  } catch (err) {
    console.error("add task error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/** ========= Set Break (single 30-min anywhere or split) =========
 * POST /api/workday/breaks
 * body: { startISO, endISO }
 * Multiple breaks allowed but total <= 30 minutes
 */
router.post("/workday/breaks", requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const dayKey = toDayKey();
    const { startISO, endISO } = req.body || {};
    if (!startISO || !endISO)
      return res.status(400).json({ error: "Missing break startISO/endISO" });

    const start = new Date(startISO);
    const end = new Date(endISO);
    if (!(start < end))
      return res.status(400).json({ error: "Break start must be before end" });

    // bounds check
    const sMin = localMinutes(start),
      eMin = localMinutes(end);
    if (sMin < OFFICE_START_MINUTES || eMin > OFFICE_END_MINUTES) {
      return res
        .status(400)
        .json({ error: "Break must be within office hours" });
    }

    const minutes = Math.round((end - start) / 60000);
    if (minutes < 1) return res.status(400).json({ error: "Break too short" });

    const doc = await TimesheetWorkday.findOne({ clerkId: userId, dayKey });
    if (!doc)
      return res
        .status(404)
        .json({ error: "Workday not found. Clock-in first." });

    const newTotal = (doc.breakTotalMin || 0) + minutes;
    if (newTotal > MAX_BREAK_MINUTES) {
      return res
        .status(400)
        .json({ error: `Total break exceeds ${MAX_BREAK_MINUTES} minutes` });
    }

    doc.breaks.push({ start, end, minutes });
    doc.breakTotalMin = newTotal;
    doc.totalPaidMinutes = Math.max(0, (doc.totalTaskMinutes || 0) - newTotal);

    await doc.save();
    return res.json({ ok: true, workday: doc });
  } catch (err) {
    console.error("break error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/** ========= Clock-out (optional; managers can auto-close at 19:00) =========
 * POST /api/workday/clock-out
 * body: { atISO? } (default now, clamped to <= 19:00)
 */
router.post("/workday/clock-out", requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const dayKey = toDayKey();
    const at = req.body?.atISO ? new Date(req.body.atISO) : new Date();

    const doc = await TimesheetWorkday.findOne({ clerkId: userId, dayKey });
    if (!doc) return res.status(404).json({ error: "Workday not found" });

    // do not allow after office end
    const m = localMinutes(at);
    if (m > OFFICE_END_MINUTES) {
      // clamp to 19:00 local
      const d = new Date(at);
      const add = OFFICE_END_MINUTES - m;
      doc.clockOut = new Date(d.getTime() + add * 60000);
    } else {
      doc.clockOut = at;
    }

    await doc.save();
    return res.json({ ok: true, workday: doc });
  } catch (err) {
    console.error("clock-out error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/** ========= Get my today =========
 * GET /api/workday/today
 */
router.get("/workday/today", requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const dayKey = toDayKey();
    const doc = await TimesheetWorkday.findOne({
      clerkId: userId,
      dayKey,
    }).lean();
    return res.json({ ok: true, workday: doc });
  } catch (err) {
    console.error("get today error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});
/** ========= Delete task =========
 * DELETE /api/workday/tasks/:taskId
 */
router.delete("/workday/tasks/:taskId", requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const dayKey = toDayKey();
    const { taskId } = req.params;

    const doc = await TimesheetWorkday.findOne({ clerkId: userId, dayKey });
    if (!doc) return res.status(404).json({ error: "Workday not found" });

    const t = doc.tasks.id(taskId);
    if (!t) return res.status(404).json({ error: "Task not found" });

    t.deleteOne(); // remove the subdoc
    doc.totalTaskMinutes = doc.tasks.reduce(
      (s, t) => s + (t.durationMin || 0),
      0
    );
    doc.totalPaidMinutes = Math.max(
      0,
      doc.totalTaskMinutes - (doc.breakTotalMin || 0)
    );

    await doc.save();
    return res.json({ ok: true, workday: doc });
  } catch (err) {
    console.error("delete task error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});
/** ========= Update task =========
 * PUT /api/workday/tasks/:taskId
 */
router.put("/workday/tasks/:taskId", requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const { taskId } = req.params;
    const { title, start, end, notes } = req.body;
    const dayKey = toDayKey();

    const doc = await TimesheetWorkday.findOne({ clerkId: userId, dayKey });
    if (!doc) return res.status(404).json({ error: "Workday not found" });

    const t = doc.tasks.id(taskId);
    if (!t) return res.status(404).json({ error: "Task not found" });

    if (title) t.title = title;
    if (start) t.start = new Date(start);
    if (end) t.end = new Date(end);
    if (notes !== undefined) t.notes = notes;

    // recalc duration
    if (t.start && t.end) {
      t.durationMin = Math.max(0, Math.round((t.end - t.start) / (1000 * 60)));
    }

    doc.totalTaskMinutes = doc.tasks.reduce(
      (s, x) => s + (x.durationMin || 0),
      0
    );
    doc.totalPaidMinutes = Math.max(
      0,
      doc.totalTaskMinutes - (doc.breakTotalMin || 0)
    );

    await doc.save();
    return res.json({ ok: true, workday: doc });
  } catch (err) {
    console.error("update task error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
