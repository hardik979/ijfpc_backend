import mongoose from "mongoose";

const TimesheetUserSchema = new mongoose.Schema(
  {
    clerkId: { type: String, index: true, unique: true, required: true },
    email: {
      type: String,
      index: true,
      unique: true,
      sparse: true,
      trim: true,
    },
    name: { type: String, trim: true, default: "" },

    role: {
      type: String,
      enum: ["EMPLOYEE", "MANAGER", "ADMIN"],
      default: "EMPLOYEE",
    },
    active: { type: Boolean, default: true },
    isApproved: { type: Boolean, default: false }, // 👈 NEW
    hourlyRate: { type: Number, default: 0 },
    department: { type: String, trim: true },
  },
  { timestamps: true }
);

TimesheetUserSchema.index({ clerkId: 1, email: 1 });

const TimesheetUser =
  mongoose.models.TimesheetUser ||
  mongoose.model("TimesheetUser", TimesheetUserSchema);

export default TimesheetUser;
