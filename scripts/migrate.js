import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../db.js";
import PostPlacementOffer from "../models/PostPlacementOffer.js";

await connectDB();

const cursor = PostPlacementOffer.find({}).cursor();

for await (const doc of cursor) {
  let mutated = false;

  doc.installments = (doc.installments || []).map((it, idx) => {
    const clone = it.toObject ? it.toObject() : it;
    if (!clone.date) {
      clone.date = doc.offerDate || new Date();
      mutated = true;
    }
    if (!clone.mode) {
      clone.mode = "OTHER";
      mutated = true;
    }
    if (!clone.label) {
      clone.label = `INSTALLMENT ${idx + 1}`;
      mutated = true;
    }
    if (clone.amount == null) {
      clone.amount = 0;
      mutated = true;
    }
    return clone;
  });

  if (mutated) {
    await doc.save();
    console.log(`✔ Fixed installments for ${doc._id}`);
  }
}

await mongoose.disconnect();
console.log("Done.");
