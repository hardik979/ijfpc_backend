// models/lead.model.js
import mongoose from "mongoose";

const LeadSchema = new mongoose.Schema(
  {
    fullName: String,
    fathersName: String,
    mobile: { type: String, index: true },
    email: { type: String, index: true },
    address: String,
    degree: String,
    passoutYear: Number,
    mode: { type: String, enum: ["ONLINE", "OFFLINE", "SELF_PACED"] },
    status: {
      type: String,
      enum: ["NEW", "CONVERTED", "SENT_TO_SHEET"],
      default: "NEW",
      index: true,
    },
    source: { type: String, default: "AdmissionForm" },
  },
  { timestamps: true }
);

LeadSchema.index({ createdAt: -1 });
export default mongoose.models.Lead || mongoose.model("Lead", LeadSchema);
