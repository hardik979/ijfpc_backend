// src/models/PostPlacementOffer.js
import mongoose from "mongoose";

export const PAYMENT_MODES = [
  "CASH",
  "UPI",
  "CARD",
  "BANK_TRANSFER",
  "CHEQUE",
  "OTHER",
];

/* NEW: Company Experience (all optional) */
const CompanyExperienceSchema = new mongoose.Schema(
  {
    companyName: { type: String, trim: true, default: "" },
    yearsOfExperience: { type: Number, min: 0, default: null },
    pf: { type: Boolean, default: null }, // true/false, null if unknown
    doj: { type: Date, default: null }, // Date of joining
    doe: { type: Date, default: null }, // Date of exit
  },
  { _id: false }
);

const InstallmentSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true }, // e.g. "1ST INSTALLMENT"
    amount: { type: Number, required: true, min: 0 }, // ₹ numeric
    date: { type: Date, required: true }, // payment date
    mode: { type: String, enum: PAYMENT_MODES, required: true }, // payment mode
    note: { type: String, trim: true }, // optional (receipt no., remarks)
  },
  { _id: true, timestamps: false }
);

const PostPlacementOfferSchema = new mongoose.Schema(
  {
    studentName: { type: String, required: true, trim: true, index: true },
    offerDate: { type: Date, index: true },
    joiningDate: { type: Date },
    companyName: { type: String, trim: true, index: true },
    location: { type: String, trim: true },

    hr: {
      name: { type: String, trim: true },
      contactNumber: { type: String, trim: true },
      email: { type: String, trim: true },
    },

    packageLPA: { type: Number, default: null },
    totalPostPlacementFee: { type: Number, default: 0, min: 0 },
    remainingPrePlacementFee: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },

    installments: { type: [InstallmentSchema], default: [] },

    remainingFee: { type: Number, default: 0 }, // auto-kept in sync
    remainingFeeNote: { type: String, trim: true },

    /* NEW: single “companyExperience” block (optional) */
    companyExperience: {
      type: CompanyExperienceSchema,
      default: () => ({}), // creates the subdoc and applies defaults on NEW docs
    },

    dedupeKey: { type: String, unique: true, index: true },
    source: { type: String, default: "sheetdb" },
  },
  { timestamps: true }
);

// Keep remainingFee in sync
PostPlacementOfferSchema.pre("save", function (next) {
  const paid = (this.installments || []).reduce(
    (sum, it) => sum + (Number(it.amount) || 0),
    0
  );
  const gross = Number(this.totalPostPlacementFee || 0);
  const discount = Number(this.discount || 0);
  const computed = Math.max(gross - discount - paid, 0);
  this.remainingFee = Number.isFinite(computed) ? computed : 0;
  next();
});

// Helpful compound index for search
PostPlacementOfferSchema.index({
  studentName: 1,
  companyName: 1,
  offerDate: -1,
});
PostPlacementOfferSchema.index({ "hr.email": 1 });
PostPlacementOfferSchema.index({ "hr.contactNumber": 1 });

export default mongoose.models.PostPlacementOffer ||
  mongoose.model("PostPlacementOffer", PostPlacementOfferSchema);
