import mongoose from "mongoose";
import crypto from "crypto";
import { PRE_PLANS } from "./student.model.js";

const EnrollmentRequestSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    plan: { type: String, enum: PRE_PLANS, required: true },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    requestedAt: { type: Date, default: Date.now },
    decidedAt: Date,
    decidedBy: String, // e.g., adminId or email
    reviewerNote: String,

    // short token to bind student-side actions without requiring auth here
    clientToken: {
      type: String,
      index: true,
      default: () => crypto.randomBytes(24).toString("hex"),
    },

    terms: {
      accepted: { type: Boolean, default: false },
      acceptedAt: Date,
      version: { type: String, default: "v1" },
      ip: String,
      userAgent: String,
    },
  },
  { timestamps: true }
);

const EnrollmentRequest =
  mongoose.models.EnrollmentRequest ||
  mongoose.model("EnrollmentRequest", EnrollmentRequestSchema);

export default EnrollmentRequest;
