// src/models/HrContact.js
import mongoose from "mongoose";

const HrContactSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    companyName: { type: String, required: true, trim: true },
    hrName: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },

    // Phone now optional
    phoneRaw: { type: String },
    phoneE164: { type: String },

    resource: { type: String, trim: true },
    remarks: { type: String, trim: true },

    // NEW optional fields
    keySkills: { type: [String], default: [] }, // e.g., ["Java", "Recruitment", "HRIS"]
    experienceYears: { type: Number }, // e.g., 1.2
    experienceText: { type: String, trim: true }, // raw text (e.g., "1 year", "1.2 years")
    profileUrl: { type: String, trim: true }, // e.g., LinkedIn, Naukri profile

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
