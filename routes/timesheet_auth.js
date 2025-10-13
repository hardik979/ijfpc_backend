import express from "express";
import TimesheetUser from "../models/timesheet_user.js";
import { requireAuth, clerkClient } from "@clerk/express"; // ✅ no ClerkExpressWithAuth

const router = express.Router();

/**
 * POST /api/auth/sync
 * Creates/updates a TimesheetUser on first login.
 */
router.post("/auth/sync", requireAuth(), async (req, res) => {
  try {
    const { userId, orgId } = req.auth(); // provided by clerkMiddleware + requireAuth

    // Optional: lock to one org
    if (process.env.ALLOWED_ORG_ID && orgId !== process.env.ALLOWED_ORG_ID) {
      return res.status(403).json({ error: "Not in allowed organization" });
    }

    // Pull identity from Clerk
    const cu = await clerkClient.users.getUser(userId);
    const email =
      cu?.emailAddresses?.find((e) => e.id === cu.primaryEmailAddressId)
        ?.emailAddress ||
      cu?.emailAddresses?.[0]?.emailAddress ||
      "";
    const name =
      [cu?.firstName, cu?.lastName].filter(Boolean).join(" ") ||
      cu?.username ||
      email.split("@")[0] ||
      "User";

    // Upsert
    const doc = await TimesheetUser.findOneAndUpdate(
      { clerkId: userId },
      {
        $set: { email, name },
        $setOnInsert: { active: true, isApproved: false },
      },
      { new: true, upsert: true }
    );

    return res.json({ ok: true, user: doc });
  } catch (err) {
    console.error("auth/sync error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * GET /api/me
 */
router.get("/me", requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth();
    const me = await TimesheetUser.findOne({ clerkId: userId }).lean();
    if (!me) return res.status(404).json({ error: "User not found" });
    return res.json({ ok: true, user: me });
  } catch (err) {
    console.error("me error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
