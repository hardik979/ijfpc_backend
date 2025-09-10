import mongoose from "mongoose";

export const PREPLACEMENT_STATUSES = ["ACTIVE", "DROPPED", "PAUSED", "PLACED"];

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

    // status metadata (timestamps)
    droppedAt: { type: Date },
    dropReason: { type: String, trim: true },

    pausedAt: { type: Date }, // NEW
    placedAt: { type: Date }, // NEW

    source: {
      provider: { type: String, default: "SheetDB" },
      lastSyncedAt: { type: Date },
      metadata: { type: mongoose.Schema.Types.Mixed },
    },
  },
  { timestamps: true }
);

// Rollups + status timestamping
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

    if (this.status === "DROPPED" && !this.droppedAt) {
      this.droppedAt = now;
    }
    if (this.status === "PAUSED" && !this.pausedAt) {
      this.pausedAt = now;
    }
    if (this.status === "PLACED" && !this.placedAt) {
      this.placedAt = now;
    }
  }

  next();
});
PrePlacementStudentSchema.index({ status: 1, dueDate: 1, remainingFee: 1 });
export default mongoose.models.PrePlacementStudent ||
  mongoose.model("PrePlacementStudent", PrePlacementStudentSchema);
