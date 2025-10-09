// models/student.model.js
import mongoose from "mongoose";

const MODES = ["ONLINE", "OFFLINE", "SELF_PACED"];
// models/student.model.js  (add inside StudentSchema definition)
const AdmissionPaymentSchema = new mongoose.Schema(
  {
    plan: {
      type: String,
      enum: ["ADMISSION_1K", "ONE_SHOT_25K", "EMI_SNAPMINT_30K"], // ← add ADMISSION_1K
      index: true,
    },
    status: {
      type: String,
      enum: ["NONE", "CREATED", "PAID", "FAILED", "REFUNDED"],
      default: "NONE",
      index: true,
    },
    amount: Number, // paise
    currency: { type: String, default: "INR" },
    orderId: String,
    paymentId: String,
    notes: { type: Object, default: {} },
    paidAt: Date,
  },
  { _id: false }
);
const StudentSchema = new mongoose.Schema(
  {
    // filled by student (step-1 only)
    fullName: { type: String, required: true, trim: true },
    fathersName: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, unique: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    address: { type: String, required: true, trim: true },
    degree: { type: String, required: true, trim: true },
    passoutYear: { type: Number, required: true, min: 1990, max: 2100 },
    mode: { type: String, enum: MODES, required: true },

    // optional admin/counselor fields (kept for ops)
    receiptNo: { type: String, trim: true, index: true },
    enrollmentDate: Date,
    batchStartDate: Date,
    counselorName: { type: String, trim: true },
    admissionPayment: { type: AdmissionPaymentSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// normalization
StudentSchema.pre("save", function (next) {
  const compact = (s) =>
    typeof s === "string" ? s.trim().replace(/\s+/g, " ") : s;
  if (this.fullName) this.fullName = compact(this.fullName);
  if (this.fathersName) this.fathersName = compact(this.fathersName);
  if (this.counselorName) this.counselorName = compact(this.counselorName);
  next();
});

// helpful indexes for queues & lookups (trimmed)
StudentSchema.index({ createdAt: -1 });

const Student =
  mongoose.models.Student || mongoose.model("Student", StudentSchema);

export { Student, MODES };
