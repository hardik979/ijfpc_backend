// models/timesheet_workday.js
import mongoose from "mongoose";

/** ====== CONSTANTS (keep in sync with routes) ====== */
export const OFFICE_TZ = "Asia/Kolkata";
export const OFFICE_START_MINUTES = 10 * 60 + 15; // 10:15
export const OFFICE_END_MINUTES = 19 * 60; // 19:00
// export const MAX_BREAK_MINUTES = 30;   // ⛔️ no longer used

/** ====== Subdocs ====== */
const TaskSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    title: { type: String, trim: true, required: true },
    notes: { type: String, trim: true, default: "" },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    durationMin: { type: Number, required: true, min: 0 },
    tags: { type: [String], default: [] },
  },
  { _id: true }
);

const BreakSchema = new mongoose.Schema(
  {
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    minutes: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const WorkdaySchema = new mongoose.Schema(
  {
    dayKey: { type: String, required: true, index: true },
    clerkId: { type: String, required: true, index: true },
    email: { type: String, trim: true, default: "" },
    name: { type: String, trim: true, default: "" },

    // Attendance
    clockIn: { type: Date, required: true },
    clockOut: { type: Date },

    // Work details
    tasks: { type: [TaskSchema], default: [] },

    // Break tracking (now Start/Stop)
    breaks: { type: [BreakSchema], default: [] }, // completed segments
    breakActiveStart: { type: Date, default: null }, // 👈 currently running break (null if none)
    breakTotalMin: { type: Number, default: 0, min: 0 }, // unlimited now

    // Rollups
    totalTaskMinutes: { type: Number, default: 0, min: 0 },
    totalPaidMinutes: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

WorkdaySchema.index({ clerkId: 1, dayKey: 1 }, { unique: true });

const TimesheetWorkday =
  mongoose.models.TimesheetWorkday ||
  mongoose.model("TimesheetWorkday", WorkdaySchema);

export default TimesheetWorkday;
export { TaskSchema, BreakSchema };
