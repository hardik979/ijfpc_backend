import mongoose from "mongoose";

const MODES = ["ONLINE", "OFFLINE", "SELF_PACED"];
const PRE_PLANS = ["ONE_SHOT_25K", "INSTALLMENT_30K"];

const StudentSchema = new mongoose.Schema(
  {
    // filled by student
    fullName: { type: String, required: true, trim: true },
    fathersName: { type: String, required: true, trim: true },
    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    address: { type: String, required: true, trim: true },
    degree: { type: String, required: true, trim: true },
    passoutYear: {
      type: Number,
      required: true,
      min: 1990,
      max: 2100,
    },
    mode: {
      type: String,
      enum: MODES,
      required: true,
    },
    aadhaar: {
      publicId: String,
      url: String, // Cloudinary secure_url
      format: String, // "pdf", "jpg", "png", ...
      bytes: Number, // file size
      uploadedAt: Date,
    },

    // filled by admin/counselor
    receiptNo: { type: String, trim: true, index: true },
    enrollmentDate: { type: Date },
    batchStartDate: { type: Date },
    counselorName: { type: String, trim: true },

    prePlacement: {
      plan: {
        type: String,
        enum: PRE_PLANS,
      },
    },
  },

  { timestamps: true }
);

// normalization before saving
StudentSchema.pre("save", function (next) {
  if (this.fullName) this.fullName = this.fullName.trim().replace(/\s+/g, " ");
  if (this.fathersName)
    this.fathersName = this.fathersName.trim().replace(/\s+/g, " ");
  if (this.counselorName)
    this.counselorName = this.counselorName.trim().replace(/\s+/g, " ");
  next();
});

const Student =
  mongoose.models.Student || mongoose.model("Student", StudentSchema);

export { Student, MODES, PRE_PLANS };
