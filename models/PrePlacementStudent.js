import mongoose from "mongoose";

export const PREPLACEMENT_STATUSES = ["ACTIVE", "DROPPED", "PAUSED", "PLACED"];
export const PREPLACEMENT_ZONES = ["BLUE", "YELLOW", "GREEN"];

// ---------- Interviews subdocument ----------
const InterviewSchema = new mongoose.Schema(
  {
    company: { type: String, required: true, trim: true },
    // precise date-time for scheduling (UI can send separate date+time; routes will merge)
    scheduledAt: { type: Date, required: true },
    round: { type: String, trim: true }, // e.g. "HR", "Tech 1"
    remarks: { type: String, trim: true }, // free text
    status: {
      type: String,
      enum: ["SCHEDULED", "COMPLETED", "CANCELLED"],
      default: "SCHEDULED",
      index: true,
    },
    createdBy: { type: String, trim: true }, // optional: who logged it
  },
  { timestamps: true }
);

const PaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date },
    mode: { type: String, trim: true },
    receiptNos: { type: [String], default: [] },
    note: { type: String, trim: true },
    raw: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const RefundSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date },
    mode: { type: String, trim: true },
    note: { type: String, trim: true },
  },
  { _id: false }
);

const PrePlacementStudentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    nameKey: { type: String, required: true, unique: true, index: true },

    courseName: { type: String, trim: true },
    terms: { type: String, trim: true },
    totalFee: { type: Number, required: true, min: 0 },
    dueDate: { type: Date },

    payments: { type: [PaymentSchema], default: [] },

    refunds: { type: [RefundSchema], default: [] },
    totalRefunded: { type: Number, default: 0 },
    netCollected: { type: Number, default: 0 },

    totalReceived: { type: Number, default: 0 },
    remainingFee: { type: Number, default: 0 },

    status: {
      type: String,
      enum: PREPLACEMENT_STATUSES,
      default: "ACTIVE",
      index: true,
    },

    // ---------- ZONES ----------
    zone: {
      type: String,
      enum: PREPLACEMENT_ZONES,
      default: "BLUE",
      index: true,
    },
    zoneChangedAt: { type: Date },

    // ---------- GREEN-zone interviews ----------
    interviews: { type: [InterviewSchema], default: [] },

    // status metadata (timestamps)
    droppedAt: { type: Date },
    dropReason: { type: String, trim: true },

    pausedAt: { type: Date },
    placedAt: { type: Date },

    // ---------- NEW: placement computation ----------
    // earliest payment date found
    firstPaymentAt: { type: Date, index: true },
    // bucket: first day of month of (firstPaymentAt + 3 months)
    placementMonth: { type: Date },

    source: {
      provider: { type: String, default: "SheetDB" },
      lastSyncedAt: { type: Date },
      metadata: { type: mongoose.Schema.Types.Mixed },
    },

    reminders: {
      fiveDaySentOn: { type: Date },
      dueDaySentOn: { type: Date },
      fiveDaySeenAt: { type: Date },
      dueDaySeenAt: { type: Date },
      firstOverdueSeenAt: { type: Date },
    },
  },
  { timestamps: true }
);

// ------- helper to compute placementMonth -------
function startOfMonthUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonthsUTC(d, n) {
  // creates a date at UTC month boundary to avoid DST/local shifts
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate())
  );
}
function computePlacementMonthFromFirstPayment(firstPaymentAt) {
  // Your example expects "17-09-2025" -> "December 2025"
  // i.e. firstPayment + 3 months, bucketed to first day of that month
  const plus3 = addMonthsUTC(firstPaymentAt, 3);
  return startOfMonthUTC(
    new Date(Date.UTC(plus3.getUTCFullYear(), plus3.getUTCMonth(), 1))
  );
}

// Rollups + status/zone timestamping + placementMonth calculation
PrePlacementStudentSchema.pre("save", function (next) {
  const sum = (arr = []) =>
    (arr || []).reduce((s, x) => s + (Number(x?.amount) || 0), 0);

  const grossIn = sum(this.payments);
  const refunded = sum(this.refunds);
  const net = Math.max(grossIn - refunded, 0);

  this.totalReceived = grossIn;
  this.totalRefunded = refunded;
  this.netCollected = net;
  this.remainingFee = Math.max((this.totalFee || 0) - net, 0);

  if (this.isModified("status")) {
    const now = new Date();
    if (this.status === "DROPPED" && !this.droppedAt) this.droppedAt = now;
    if (this.status === "PAUSED" && !this.pausedAt) this.pausedAt = now;
    if (this.status === "PLACED" && !this.placedAt) this.placedAt = now;
  }

  if (this.isModified("zone")) {
    this.zoneChangedAt = new Date();
  }

  // ---------- NEW: compute firstPaymentAt + placementMonth ----------
  // Find earliest valid payment date every save. (Covers add/edit/delete payments and creates.)
  const validDates = (this.payments || [])
    .map((p) =>
      p?.date instanceof Date ? p.date : p?.date ? new Date(p.date) : null
    )
    .filter((d) => d instanceof Date && !isNaN(d));
  if (validDates.length) {
    const first = new Date(Math.min(...validDates.map((d) => d.getTime())));
    // normalize to UTC date (ignore time)
    const firstUTC = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate())
    );
    this.firstPaymentAt = firstUTC;
    this.placementMonth = computePlacementMonthFromFirstPayment(firstUTC);
  } else {
    // No payments yet
    this.firstPaymentAt = undefined;
    this.placementMonth = undefined;
  }

  next();
});

// existing indexes…
PrePlacementStudentSchema.index({ status: 1, dueDate: 1, remainingFee: 1 });
PrePlacementStudentSchema.index({ zone: 1, status: 1 });
PrePlacementStudentSchema.index({ "interviews.scheduledAt": 1 });

// NEW helpful index for reporting
PrePlacementStudentSchema.index({ placementMonth: 1 });

export default mongoose.models.PrePlacementStudent ||
  mongoose.model("PrePlacementStudent", PrePlacementStudentSchema);
