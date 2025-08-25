import mongoose from "mongoose";

const InstallmentSchema = new mongoose.Schema(
  {
    receivedDate: { type: String },
    receivedAmount: { type: Number },
    balanceAfter: { type: Number },
    modeOfPayment: {
      type: String,
      enum: ["CASH", "CARD", "UPI", "BANK_TRANSFER", "OTHER"],
    },
    nextInstallmentDate: { type: String },
  },
  { _id: false }
);

const PrePlacementOldDataSchema = new mongoose.Schema(
  {
    candidateName: { type: String },
    courseOpted: { type: String },
    totalFees: { type: Number },
    status: { type: String, enum: ["ONGOING", "COMPLETED", "DROPPED"] },

    admissionPeriod: {
      start: { type: String, required: true }, // required
      end: { type: String, required: false }, // optional now ✅
    },

    installments: [InstallmentSchema], // optional array
    receiptNo: { type: String }, // only once per student
    remarks: { type: String }, // only once per student
    address: { type: String },
    contactNumber: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model("PrePlacementOldData", PrePlacementOldDataSchema);
