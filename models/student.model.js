import mongoose from "mongoose";

const MODES = ["ONLINE", "OFFLINE", "SELF_PACED"];
const PRE_PLANS = ["ONE_SHOT_25K", "INSTALLMENT_30K"];

const AadhaarSchema = new mongoose.Schema(
  {
    publicId: { type: String, index: true },
    url: String, // only for convenience; real access uses signed links
    format: String, // "pdf","jpg","png",...
    bytes: Number,
    uploadedAt: Date,
    resourceType: String, // "image" | "raw" | "video"
    pages: Number, // for PDFs (if Cloudinary returns it)
  },
  { _id: false }
);

const StudentSchema = new mongoose.Schema(
  {
    // filled by student
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

    // Aadhaar meta (NOT the full number)
    aadhaar: AadhaarSchema,
    aadhaarLast4: { type: String, minlength: 4, maxlength: 4, trim: true },

    // filled by admin/counselor
    receiptNo: { type: String, trim: true, index: true },
    enrollmentDate: Date,
    batchStartDate: Date,
    counselorName: { type: String, trim: true },

    prePlacement: {
      plan: { type: String, enum: PRE_PLANS },
    },
  },
  { timestamps: true }
);

// normalization
StudentSchema.pre("save", function (next) {
  const compact = (s) => s?.trim().replace(/\s+/g, " ");
  if (this.fullName) this.fullName = compact(this.fullName);
  if (this.fathersName) this.fathersName = compact(this.fathersName);
  if (this.counselorName) this.counselorName = compact(this.counselorName);
  next();
});

const Student =
  mongoose.models.Student || mongoose.model("Student", StudentSchema);
export { Student, MODES, PRE_PLANS };
