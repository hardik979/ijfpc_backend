// scripts/seedAdmin.js
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User.js";

async function main() {
  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.DB_NAME || "test",
  });

  const username = process.env.SEED_ADMIN_USERNAME;
  const name = process.env.SEED_ADMIN_NAME || "Super Admin";
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!username || !email || !password) {
    console.error("Missing seed admin envs");
    process.exit(1);
  }

  const exists = await User.findOne({ username: username.toLowerCase() });
  if (exists) {
    console.log("Admin already exists:", username);
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({
      username: username.toLowerCase(),
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: "admin",
      isActive: true,
    });
    console.log("Admin created:", username);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
