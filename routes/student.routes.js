import express from "express";
import { Student, MODES } from "../models/student.model.js";

const router = express.Router();

const isEmail = (s = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
const isYear = (n) => Number.isInteger(n) && n >= 1990 && n <= 2100;

/** Validate ONLY personal info (no payment / no Aadhaar) */
function validatePersonal(body = {}) {
  const errors = [];
  const reqStr = (v, name) => {
    if (!v || typeof v !== "string" || !v.trim())
      errors.push(`${name} is required`);
  };

  reqStr(body.fullName, "fullName");
  reqStr(body.fathersName, "fathersName");
  reqStr(body.mobile, "mobile");
  reqStr(body.email, "email");
  reqStr(body.address, "address");
  reqStr(body.degree, "degree");

  const passoutYearNum = Number(body.passoutYear);
  if (!isYear(passoutYearNum))
    errors.push("passoutYear must be between 1990 and 2100");

  if (!body.mode || !MODES.includes(body.mode)) errors.push("mode is invalid");
  if (body.email && !isEmail(body.email)) errors.push("email is invalid");

  // Allow 10–15 digits (digits-only check)
  if (
    body.mobile &&
    !/^\d{10,15}$/.test(String(body.mobile).replace(/\D/g, ""))
  ) {
    errors.push("mobile is invalid");
  }

  return errors;
}

/* ---------- STEP 1: create student with personal info only ---------- */
/** POST /students/admission/personal */
// ✅ Step-1: validate only (no DB writes)
router.post("/admission/personal", async (req, res) => {
  try {
    const b = req.body || {};
    const errors = validatePersonal(b);
    if (errors.length) {
      return res
        .status(400)
        .json({ error: "Validation failed", details: errors });
    }

    // Create LEAD only (do NOT create Student here)
    const lead = await Lead.create({
      fullName: b.fullName,
      fathersName: b.fathersName,
      mobile: String(b.mobile).trim(),
      email: String(b.email).trim().toLowerCase(),
      address: b.address,
      degree: b.degree,
      passoutYear: Number(b.passoutYear),
      mode: b.mode,
      status: "NEW",
      source: "AdmissionForm",
    });

    // You can return a lightweight token/id if you like
    return res.status(200).json({
      ok: true,
      message: "Personal details received",
      leadId: lead._id, // optional
    });
  } catch (err) {
    return res
      .status(400)
      .json({ error: "Unable to process", details: err?.message });
  }
});
/* ---------- list all students ---------- */
router.get("/", async (_req, res) => {
  try {
    const students = await Student.find().lean();
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

/* ---------- get single student ---------- */
router.get("/:id", async (req, res) => {
  try {
    const student = await Student.findById(req.params.id).lean();
    if (!student) return res.status(404).json({ error: "Student not found" });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch student" });
  }
});
router.post("/:id/accept-terms", async (req, res) => {
  const { id } = req.params;
  const s = await Student.findById(id);
  if (!s) return res.status(404).json({ error: "Student not found" });
  if (s.admissionPayment?.status !== "PAID") {
    return res.status(400).json({ error: "Payment not completed" });
  }
  s.termsAcceptedAt = new Date();
  await s.save();
  return res.json({ ok: true, message: "Terms accepted" });
});

export default router;
