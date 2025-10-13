import mongoose from "mongoose";

/** ====== CONSTANTS (keep in sync with routes) ====== */
export const OFFICE_TZ = "Asia/Kolkata";
export const OFFICE_START_MINUTES = 10 * 60 + 15; // 10:15
export const OFFICE_END_MINUTES = 19 * 60; // 19:00
export const MAX_BREAK_MINUTES = 30;

/** ====== Subdocs ====== */
const TaskSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    title: { type: String, trim: true, required: true }, // e.g., "Job posting research"
    notes: { type: String, trim: true, default: "" },
    start: { type: Date, required: true }, // UTC Date
    end: { type: Date, required: true }, // UTC Date
    durationMin: { type: Number, required: true, min: 0 }, // derived on save
    tags: { type: [String], default: [] }, // optional
  },
  { _id: true }
);

const BreakSchema = new mongoose.Schema(
  {
    start: { type: Date, required: true }, // UTC
    end: { type: Date, required: true }, // UTC
    minutes: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const WorkdaySchema = new mongoose.Schema(
  {
    dayKey: { type: String, required: true, index: true }, // "YYYY-MM-DD" in OFFICE_TZ
    clerkId: { type: String, required: true, index: true },
    email: { type: String, trim: true, default: "" },
    name: { type: String, trim: true, default: "" },

    // Attendance
    clockIn: { type: Date, required: true }, // UTC
    clockOut: { type: Date }, // UTC (optional until EOD)

    // Work details
    tasks: { type: [TaskSchema], default: [] },
    breaks: { type: [BreakSchema], default: [] }, // anywhere in the day
    breakTotalMin: { type: Number, default: 0, min: 0, max: MAX_BREAK_MINUTES },

    // Rollups (fast reporting)
    totalTaskMinutes: { type: Number, default: 0, min: 0 },
    totalPaidMinutes: { type: Number, default: 0, min: 0 }, // task minutes minus breaks (clamped to office window)
  },
  { timestamps: true }
);

// enforce 1 doc / user / day
WorkdaySchema.index({ clerkId: 1, dayKey: 1 }, { unique: true });

const TimesheetWorkday =
  mongoose.models.TimesheetWorkday ||
  mongoose.model("TimesheetWorkday", WorkdaySchema);

export default TimesheetWorkday;
