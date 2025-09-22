// src/models/User.js
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true, unique: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["admin", "employee", "verifier"],
      default: "employee",
    }, // ⬅️ added verifier
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// force collection name to ijf_rd_users
export default mongoose.models.User ||
  mongoose.model("User", UserSchema, "ijf_rd_users");
