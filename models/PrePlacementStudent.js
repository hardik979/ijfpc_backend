import mongoose from "mongoose";
export const PREPLACEMENT_STATUSES = ["ACTIVE", "DROPPED"];

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

// NEW: refunds you issued to the student
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

    // NEW: refunds and rollups
    refunds: { type: [RefundSchema], default: [] },
    totalRefunded: { type: Number, default: 0 }, // sum(refunds.amount)
    netCollected: { type: Number, default: 0 }, // totalReceived - totalRefunded

    totalReceived: { type: Number, default: 0 }, // sum(payments.amount) (gross in)
    remainingFee: { type: Number, default: 0 }, // totalFee - netCollected

    status: {
      type: String,
      enum: PREPLACEMENT_STATUSES,
      default: "ACTIVE",
      index: true,
    },

    // (optional) meta about dropping – handy if you want to store when/why
    droppedAt: { type: Date },
    dropReason: { type: String, trim: true },

    source: {
      provider: { type: String, default: "SheetDB" },
      lastSyncedAt: { type: Date },
      metadata: { type: mongoose.Schema.Types.Mixed },
    },
  },
  { timestamps: true }
);

// Recalculate rollups before save
PrePlacementStudentSchema.pre("save", function (next) {
  const sum = (arr = []) =>
    (arr || []).reduce((s, x) => s + (Number(x?.amount) || 0), 0);

  const grossIn = sum(this.payments); // what they paid
  const refunded = sum(this.refunds); // what you returned
  const net = Math.max(grossIn - refunded, 0); // don't go negative

  this.totalReceived = grossIn;
  this.totalRefunded = refunded;
  this.netCollected = net;
  this.remainingFee = Math.max((this.totalFee || 0) - net, 0);

  // convenience: set droppedAt if newly marked DROPPED and missing
  if (
    this.isModified("status") &&
    this.status === "DROPPED" &&
    !this.droppedAt
  ) {
    this.droppedAt = new Date();
  }

  next();
});

export default mongoose.models.PrePlacementStudent ||
  mongoose.model("PrePlacementStudent", PrePlacementStudentSchema);
