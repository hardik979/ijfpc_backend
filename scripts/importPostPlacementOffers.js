import "dotenv/config";
import mongoose from "mongoose";
import PostPlacementOffer from "../models/PostPlacementOffer.js";
import { transformOfferRow } from "../lib/postPlacementOfferSync.js";

const { MONGO_URI, SHEETDB_POST_PLACEMENT_URL } = process.env;

async function main() {
  if (!MONGO_URI || !SHEETDB_POST_PLACEMENT_URL) {
    throw new Error("Missing MONGODB_URI or SHEETDB_POST_PLACEMENT_URL");
  }

  await mongoose.connect(MONGO_URI);

  const res = await fetch(SHEETDB_POST_PLACEMENT_URL);
  if (!res.ok) throw new Error(`SheetDB fetch failed: ${res.status}`);
  const rows = await res.json();

  const cleaned = rows.filter((r) => (r?.["STUDENT NAME"] || "").trim());
  const ops = cleaned.map((r) => {
    const doc = transformOfferRow(r);
    return {
      updateOne: {
        filter: { dedupeKey: doc.dedupeKey },
        update: { $set: doc },
        upsert: true,
      },
    };
  });

  if (ops.length) {
    const result = await PostPlacementOffer.bulkWrite(ops, { ordered: false });
    console.log({
      totalProcessed: ops.length,
      matched: result.matchedCount,
      upserted: result.upsertedCount || 0,
      modified: result.modifiedCount || 0,
    });
  } else {
    console.log("No rows to import.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
