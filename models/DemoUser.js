// models/DemoUser.js
import mongoose from "mongoose";

const DemoUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ["student", "teacher", "admin"],
      default: "student",
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("DemoUser", DemoUserSchema);
