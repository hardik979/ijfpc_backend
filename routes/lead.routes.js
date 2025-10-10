// routes/leads.routes.js
import express from "express";
import Lead from "../models/lead.model.js";
import { pushLeadToSheet } from "../lib/pushLeadToSheet.js";

const router = express.Router();

/** Manually trigger or call from a cron (Render/Heroku cron, etc.) */
router.post("/flush", async (req, res) => {
  if (req.get("x-cron-key") !== process.env.CRON_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
    if (!webhookUrl)
      return res
        .status(500)
        .json({ error: "Missing GOOGLE_SHEET_WEBHOOK_URL" });

    // pick leads older than 30 minutes and still unpaid
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);

    const leads = await Lead.find({
      status: "NEW",
      createdAt: { $lte: cutoff },
    })
      .limit(200)
      .lean();

    for (const lead of leads) {
      try {
        await pushLeadToSheet({ webhookUrl, lead });
        await Lead.updateOne(
          { _id: lead._id },
          { $set: { status: "SENT_TO_SHEET" } }
        );
      } catch (err) {
        console.error("pushLeadToSheet failed:", err?.message);
        // keep as NEW; will retry next run
      }
    }

    return res.json({ ok: true, processed: leads.length });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "flush failed" });
  }
});

export default router;
