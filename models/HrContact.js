// src/models/HrContact.js
import mongoose from "mongoose";

const HrContactSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    companyName: { type: String, required: true, trim: true },
    hrName: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },

    phoneRaw: { type: String },
    phoneE164: { type: String },

    resource: { type: String, trim: true },
    remarks: { type: String, trim: true },

    keySkills: { type: [String], default: [] },
    experienceYears: { type: Number },
    experienceText: { type: String, trim: true },
    profileUrl: { type: String, trim: true },

    // ⬇️ NEW: verifier status
    status: {
      type: String,
      enum: ["red", "yellow", "green"],
      default: undefined,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// unique only when phoneE164 exists
HrContactSchema.index(
  { phoneE164: 1 },
  { unique: true, partialFilterExpression: { phoneE164: { $type: "string" } } }
);

export default mongoose.models.HrContact ||
  mongoose.model("HrContact", HrContactSchema, "ijf_rd_hr_contacts");
