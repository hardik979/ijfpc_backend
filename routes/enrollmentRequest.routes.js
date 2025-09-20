// routes/enrollmentRequest.routes.js
import express from "express";
import EnrollmentRequest from "../models/EnrollmentRequest.js";
import { Student, PRE_PLANS } from "../models/student.model.js";
import {
  makeDecisionLinks,
  verifyDecisionToken,
} from "../lib/approvalLinks.js";
import { sendOfflineApprovalEmail } from "../lib/mailer.js";

const router = express.Router();

// OPTIONAL: replace with Clerk/JWT role check
const isAdmin = (req, res, next) => next();

// ========== EXISTING ==========
// Create or reuse a PENDING request (called from "Payment" page)
router.post("/request", async (req, res) => {
  try {
    const { studentId, plan } = req.body || {};
    if (!studentId)
      return res.status(400).json({ error: "studentId required" });
    if (!plan || !PRE_PLANS.includes(plan))
      return res.status(400).json({ error: "Invalid plan" });

    const student = await Student.findById(studentId).select(
      "_id fullName email mobile mode"
    );
    if (!student) return res.status(404).json({ error: "Student not found" });

    let existing = await EnrollmentRequest.findOne({
      student: student._id,
      status: "PENDING",
    });

    // Always (re)send email for OFFLINE mode when the student lands on Page 2
    const maybeSendEmail = async (reqDoc) => {
      if (student.mode !== "OFFLINE") return;
      const to =
        process.env.ADMISSIONS_APPROVER_EMAILS?.split(",").map((e) =>
          e.trim()
        ) || [];
      if (!to.length) return;

      const { approveUrl, rejectUrl } = makeDecisionLinks(reqDoc._id);
      await sendOfflineApprovalEmail({
        to,
        student,
        plan,
        approveUrl,
        rejectUrl,
        requestId: reqDoc._id,
      });
    };

    if (existing) {
      await maybeSendEmail(existing); // re-notify approvers
      return res.json({
        requestId: existing._id,
        status: existing.status,
        token: existing.clientToken,
      });
    }

    const reqDoc = await EnrollmentRequest.create({
      student: student._id,
      plan,
      status: "PENDING",
      requestedAt: new Date(),
    });

    await maybeSendEmail(reqDoc);

    res.status(201).json({
      requestId: reqDoc._id,
      status: reqDoc.status,
      token: reqDoc.clientToken,
    });
  } catch (e) {
    console.warn("create request failed:", e?.message);
    res.status(400).json({ error: "Unable to create request" });
  }
});

// Student/Admin: read request status (UNCHANGED)
router.get("/:id", async (req, res) => {
  const r = await EnrollmentRequest.findById(req.params.id).populate(
    "student",
    "fullName email"
  );
  if (!r) return res.status(404).json({ error: "Not found" });
  res.json({
    _id: r._id,
    status: r.status,
    plan: r.plan,
    student: r.student,
    terms: r.terms,
  });
});

// Admin: list pending (UNCHANGED)
router.get("/admin/list", isAdmin, async (req, res) => {
  const status = req.query.status || "PENDING";
  const list = await EnrollmentRequest.find({ status }).populate(
    "student",
    "fullName email mobile"
  );
  res.json(list);
});

// Admin: approve (UNCHANGED)
router.patch("/admin/:id/approve", isAdmin, async (req, res) => {
  const { reviewerNote, decidedBy } = req.body || {};
  const r = await EnrollmentRequest.findById(req.params.id);
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.status !== "PENDING")
    return res.status(400).json({ error: "Not pending" });
  r.status = "APPROVED";
  r.decidedAt = new Date();
  r.decidedBy = decidedBy || "admin";
  r.reviewerNote = reviewerNote;
  await r.save();
  res.json({ ok: true, status: r.status });
});

// Admin: reject (UNCHANGED)
router.patch("/admin/:id/reject", isAdmin, async (req, res) => {
  const { reviewerNote, decidedBy } = req.body || {};
  const r = await EnrollmentRequest.findById(req.params.id);
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.status !== "PENDING")
    return res.status(400).json({ error: "Not pending" });
  r.status = "REJECTED";
  r.decidedAt = new Date();
  r.decidedBy = decidedBy || "admin";
  r.reviewerNote = reviewerNote;
  await r.save();
  res.json({ ok: true, status: r.status });
});

// Student: accept terms (UNCHANGED)
router.post("/:id/agree", async (req, res) => {
  const { token } = req.body || {};
  const r = await EnrollmentRequest.findById(req.params.id).populate(
    "student",
    "_id"
  );
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.status !== "APPROVED")
    return res.status(400).json({ error: "Not approved yet" });
  if (!token || token !== r.clientToken)
    return res.status(403).json({ error: "Invalid token" });
  if (r.terms?.accepted)
    return res.status(400).json({ error: "Already accepted" });

  r.terms = {
    accepted: true,
    acceptedAt: new Date(),
    version: "v1",
    ip:
      req.headers["x-forwarded-for"]?.toString() ||
      req.socket?.remoteAddress ||
      "",
    userAgent: req.headers["user-agent"] || "",
  };
  await r.save();
  res.json({ ok: true, termsAccepted: true });
});

// ========== NEW: public one-click decision via email ==========
router.get("/email/decision", async (req, res) => {
  const { token } = req.query || {};
  if (!token) return res.status(400).send("Missing token");

  try {
    const payload = verifyDecisionToken(String(token));
    // payload: { rid, decision: 'approve'|'reject', n, iat, exp }
    const r = await EnrollmentRequest.findById(payload.rid).populate(
      "student",
      "fullName email"
    );
    if (!r) return res.status(404).send("Request not found");

    if (r.status !== "PENDING") {
      // idempotent / already decided
      return redirectToResult(res, r.status);
    }

    const nextStatus = payload.decision === "approve" ? "APPROVED" : "REJECTED";
    r.status = nextStatus;
    r.decidedAt = new Date();
    r.decidedBy = "email-link";
    if (nextStatus === "REJECTED" && !r.reviewerNote) {
      r.reviewerNote = "Rejected via email link";
    }
    await r.save();

    return redirectToResult(res, nextStatus);
  } catch (e) {
    return res.status(400).send("Invalid or expired token");
  }
});

function redirectToResult(res, status) {
  const base = process.env.DECISION_REDIRECT_URL;
  if (base) {
    const url = new URL(base);
    url.searchParams.set("status", status);
    return res.redirect(url.toString());
  }
  // fallback simple page
  return res.send(`Decision recorded: <b>${status}</b>`);
}

// ========== OPTIONAL: resend approval email ==========
router.post("/:id/resend-email", isAdmin, async (req, res) => {
  const r = await EnrollmentRequest.findById(req.params.id).populate(
    "student",
    "fullName email mobile mode"
  );
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.status !== "PENDING")
    return res
      .status(400)
      .json({ error: "Only pending requests can be re-notified" });
  if (r.student.mode !== "OFFLINE")
    return res.json({ ok: true, skipped: true });

  const to =
    process.env.ADMISSIONS_APPROVER_EMAILS?.split(",").map((e) => e.trim()) ||
    [];
  if (!to.length)
    return res.status(400).json({ error: "No approver emails configured" });

  const { approveUrl, rejectUrl } = makeDecisionLinks(r._id);
  await sendOfflineApprovalEmail({
    to,
    student: r.student,
    plan: r.plan,
    approveUrl,
    rejectUrl,
    requestId: r._id,
  });

  res.json({ ok: true });
});

export default router;
