import express from "express";
import EnrollmentRequest from "../models/EnrollmentRequest.js";
import { Student, PRE_PLANS } from "../models/student.model.js";

const router = express.Router();

// OPTIONAL: wire your real auth here
const isAdmin = (req, res, next) => {
  // TODO: replace with Clerk/JWT role check
  // if (!req.user?.isAdmin) return res.status(403).json({ error: "Forbidden" });
  next();
};

// Create or reuse a PENDING request (called from "Payment" page)
router.post("/request", async (req, res) => {
  try {
    const { studentId, plan } = req.body || {};
    if (!studentId)
      return res.status(400).json({ error: "studentId required" });
    if (!plan || !PRE_PLANS.includes(plan))
      return res.status(400).json({ error: "Invalid plan" });

    const student = await Student.findById(studentId).select(
      "_id fullName email"
    );
    if (!student) return res.status(404).json({ error: "Student not found" });

    let existing = await EnrollmentRequest.findOne({
      student: student._id,
      status: "PENDING",
    });
    if (existing) {
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

// Student/Admin: read request status
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

// Admin: list pending
router.get("/admin/list", isAdmin, async (req, res) => {
  const status = req.query.status || "PENDING";
  const list = await EnrollmentRequest.find({ status }).populate(
    "student",
    "fullName email mobile"
  );
  res.json(list);
});

// Admin: approve
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

// Admin: reject
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

// Student: accept terms (requires approval first)
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

  // (Optional) also stamp the student record
  // await Student.findByIdAndUpdate(r.student._id, { enrollmentDate: new Date() });

  res.json({ ok: true, termsAccepted: true });
});

export default router;
