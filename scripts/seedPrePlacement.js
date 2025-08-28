// scripts/seedPrePlacement.js
import "dotenv/config";
import mongoose from "mongoose";
import fetch from "node-fetch";
import PrePlacementStudent from "../models/PrePlacementStudent.js";

const { MONGO_URI, SHEETDB_URL } = process.env;

function normalizeName(name) {
  return (name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function toNumber(v) {
  // Handles "29,000", "29000", "₹29000", etc.
  if (v == null) return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseDMY(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  const parts = str.split(/[\/\-.]/).map((x) => x.trim());
  if (parts.length < 3) return null;
  let [d, m, y] = parts;
  const day = parseInt(d, 10);
  const month = parseInt(m, 10) - 1;
  let year = parseInt(y, 10);
  if (y.length === 2) year = 2000 + year; // "24" => 2024
  const dt = new Date(Date.UTC(year, month, day));
  return isNaN(dt) ? null : dt;
}

(async () => {
  try {
    if (!MONGO_URI) throw new Error("Missing MONGO_URI");
    if (!SHEETDB_URL) throw new Error("Missing SHEETDB_URL");

    await mongoose.connect(MONGO_URI, { maxPoolSize: 10 });
    console.log("✅ MongoDB connected");

    const res = await fetch(SHEETDB_URL);
    if (!res.ok) {
      throw new Error(`SheetDB fetch failed: ${res.status} ${res.statusText}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("SheetDB response not an array");

    // Group rows by normalized Name
    const grouped = new Map();

    for (const row of rows) {
      const nameRaw = (row["Name"] || "").trim();
      if (!nameRaw) continue;

      const key = normalizeName(nameRaw);

      // Build a payment entry from the row
      const payment = {
        amount: toNumber(row["Fees Received"]),
        date: parseDMY(row["Date of recpt."]),
        mode: String(row["Mode "] || row["Mode"] || "").trim(),
        receiptNos: String(row["RECEIPT No."] || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        note: String(row["Remarks"] || "").trim(),
        raw: row,
      };

      // Seed the group container
      const base = grouped.get(key) || {
        name: nameRaw,
        nameKey: key,
        courseName: String(row["Course Name"] || "").trim(),
        terms: String(row["S"] || "").trim(), // e.g., "29+30%"
        totalFee: toNumber(row["Fees"]),
        dueDate: parseDMY(row["Due Date"]),
        payments: [],
      };

      // Prefer first non-empty values for some fields
      if (!base.courseName && row["Course Name"])
        base.courseName = String(row["Course Name"]).trim();
      if (!base.terms && row["S"]) base.terms = String(row["S"]).trim();
      if (!base.dueDate && row["Due Date"])
        base.dueDate = parseDMY(row["Due Date"]);

      // Keep the max seen totalFee (defensive)
      base.totalFee = Math.max(base.totalFee || 0, toNumber(row["Fees"]));

      // Push a payment if there is something meaningful
      if (
        payment.amount ||
        payment.date ||
        payment.mode ||
        payment.receiptNos.length
      ) {
        base.payments.push(payment);
      }

      grouped.set(key, base);
    }

    let upserts = 0;

    for (const [, g] of grouped) {
      const totalReceived = (g.payments || []).reduce(
        (sum, p) => sum + (p.amount || 0),
        0
      );
      const remainingFee = Math.max((g.totalFee || 0) - totalReceived, 0);

      await PrePlacementStudent.updateOne(
        { nameKey: g.nameKey },
        {
          $set: {
            name: g.name,
            courseName: g.courseName,
            terms: g.terms,
            totalFee: g.totalFee,
            dueDate: g.dueDate,
            payments: g.payments,
            totalReceived,
            remainingFee,
            "source.provider": "SheetDB",
            "source.lastSyncedAt": new Date(),
          },
          $setOnInsert: { status: "ACTIVE", createdAt: new Date() },
        },
        { upsert: true }
      );

      upserts++;
    }

    console.log(
      `✅ Seed complete: upserted ${upserts} students from ${rows.length} rows.`
    );
  } catch (err) {
    console.error("❌ Seed failed:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
})();
