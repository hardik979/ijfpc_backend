// src/models/HrContact.js
import mongoose from "mongoose";

const HrContactSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    companyName: { type: String, required: true, trim: true },
    hrName: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phoneRaw: { type: String }, // ⬅️ no longer required
    phoneE164: { type: String }, // ⬅️ no longer required
    resource: { type: String, trim: true },
    remarks: { type: String, trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Uniqueness only when phoneE164 exists
HrContactSchema.index(
  { phoneE164: 1 },
  { unique: true, partialFilterExpression: { phoneE164: { $type: "string" } } }
);

// Alternatively:
// HrContactSchema.index({ phoneE164: 1 }, { unique: true, sparse: true });

export default mongoose.models.HrContact ||
  mongoose.model("HrContact", HrContactSchema, "ijf_rd_hr_contacts");
