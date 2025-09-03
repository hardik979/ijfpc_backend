/* scripts/seed-company-experience.js */
import mongoose from "mongoose";
import dotenv from "dotenv";
import PostPlacementOffer from "../models/PostPlacementOffer.js";

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI;

async function main() {
  if (!MONGODB_URI) {
    console.error("Missing MONGODB_URI / DATABASE_URL in env.");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, {});

  // Only update docs that don't have companyExperience set (or it's null)
  const res = await PostPlacementOffer.updateMany(
    {
      $or: [
        { companyExperience: { $exists: false } },
        { companyExperience: null },
      ],
    },
    {
      $set: {
        companyExperience: {
          companyName: "",
          yearsOfExperience: null,
          pf: null,
          doj: null,
          doe: null,
        },
      },
    }
  );

  console.log(`Updated ${res.modifiedCount} documents.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
