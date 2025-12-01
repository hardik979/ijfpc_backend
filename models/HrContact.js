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
    qualityBand: {
      type: String,
      enum: ["cold", "warm", "hot", "super_hot"],
      required: true,
      index: true,
    },
    // verifier status
    status: {
      type: String,
      enum: ["red", "yellow", "green"],
      default: undefined,
    },

    // ⬇️ NEW: verifier remark + simple audit
    verifierRemark: { type: String, trim: true, maxlength: 500 },
    statusUpdatedAt: { type: Date },
    statusUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

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
HrContactSchema.index({ createdBy: 1, createdAt: -1 });
HrContactSchema.index({ createdAt: -1 });

export default mongoose.models.HrContact ||
  mongoose.model("HrContact", HrContactSchema, "ijf_rd_hr_contacts");
