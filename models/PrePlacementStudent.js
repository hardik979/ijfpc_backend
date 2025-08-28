import mongoose from "mongoose";
export const PREPLACEMENT_STATUSES = ["ACTIVE", "DROPPED"];

const PaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date },
    mode: { type: String, trim: true },
    receiptNos: { type: [String], default: [] }, // handles "14, 15"
    note: { type: String, trim: true }, // row-level remarks
    raw: { type: mongoose.Schema.Types.Mixed }, // snapshot of original row
  },
  { _id: false }
);

const PrePlacementStudentSchema = new mongoose.Schema(
  {
    // Store original name but enforce uniqueness on a normalized key
    name: { type: String, required: true, trim: true, index: true },
    nameKey: { type: String, required: true, unique: true, index: true }, // lowercased, trimmed, single spaces

    courseName: { type: String, trim: true },
    terms: { type: String, trim: true }, // from column "S" (e.g., "29k+30%")
    totalFee: { type: Number, required: true, min: 0 },
    dueDate: { type: Date },

    payments: { type: [PaymentSchema], default: [] },

    totalReceived: { type: Number, default: 0 },
    remainingFee: { type: Number, default: 0 },

    status: {
      type: String,
      enum: PREPLACEMENT_STATUSES,
      default: "ACTIVE",
      index: true,
    },

    source: {
      provider: { type: String, default: "SheetDB" },
      lastSyncedAt: { type: Date },
      metadata: { type: mongoose.Schema.Types.Mixed },
    },
  },
  { timestamps: true }
);

// Helper if you ever save() docs (note: updateOne bypasses this)
PrePlacementStudentSchema.pre("save", function (next) {
  const sum = (this.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  this.totalReceived = sum;
  this.remainingFee = Math.max((this.totalFee || 0) - sum, 0);
  next();
});

export default mongoose.models.PrePlacementStudent ||
  mongoose.model("PrePlacementStudent", PrePlacementStudentSchema);
