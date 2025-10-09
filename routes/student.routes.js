import express from "express";
import { Student, MODES } from "../models/student.model.js";
import PrePlacementStudent from "../models/PrePlacementStudent.js";
import { makeNameKey } from "../lib/nameKey.js";

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
router.post("/admission/personal", async (req, res) => {
  try {
    const b = req.body || {};
    const errors = validatePersonal(b);
    if (errors.length) {
      return res
        .status(400)
        .json({ error: "Validation failed", details: errors });
    }

    const email = String(b.email).trim().toLowerCase();
    const mobile = String(b.mobile).trim();

    // pre-check duplicates to avoid E11000 logs
    const [emailDup, mobileDup] = await Promise.all([
      Student.exists({ email }),
      Student.exists({ mobile }),
    ]);
    if (emailDup)
      return res.status(409).json({ error: "email already exists" });
    if (mobileDup)
      return res.status(409).json({ error: "mobile already exists" });

    // Save Student (ONLY personal fields)
    const student = new Student({
      fullName: b.fullName,
      fathersName: b.fathersName,
      mobile,
      email,
      address: b.address,
      degree: b.degree,
      passoutYear: Number(b.passoutYear),
      mode: b.mode,
    });

    await student.save();

    // Ensure a minimal PrePlacementStudent exists
    const nameKey = makeNameKey(student.fullName, student.mobile);
    await PrePlacementStudent.updateOne(
      { nameKey },
      {
        $setOnInsert: {
          name: student.fullName,
          nameKey,
          totalFee: 0,
          status: "ACTIVE",
          zone: "BLUE",
          payments: [],
          refunds: [],
          source: { provider: "Admission", lastSyncedAt: new Date() },
        },
      },
      { upsert: true }
    );

    // Optional: notify managers a new admission request came in
    req.io
      ?.of("/admissions")
      ?.to("managers")
      ?.emit("admission:new-request", {
        studentId: String(student._id),
        name: student.fullName,
        mobile: student.mobile,
        createdAt: student.createdAt,
      });

    return res.status(201).json({
      message: "Personal info submitted",
      studentId: student._id,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || "unique field";
      return res.status(409).json({ error: `${field} already exists` });
    }
    return res
      .status(400)
      .json({ error: "Unable to create student", details: err?.message });
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
  try {
    const { id } = req.params;
    const s = await Student.findById(id);
    if (!s) return res.status(404).json({ error: "Student not found" });

    // OPTIONAL: enforce payment success before allowing terms
    // If you want to allow testing without payment, comment this out.
    if (s.admissionPayment?.status !== "PAID") {
      console.warn(
        `accept-terms called but payment status is ${
          s.admissionPayment?.status || "NONE"
        } for ${id}`
      );
      // return res.status(400).json({ error: "Payment not completed" });
    }

    s.termsAcceptedAt = new Date();

    // Optional lightweight stage tracking (only if you want it)
    // s.admissionStage = "COMPLETED";

    await s.save();

    return res.json({ ok: true, message: "Terms accepted" });
  } catch (err) {
    console.error("accept-terms error:", err);
    return res
      .status(500)
      .json({ error: err?.message || "Failed to accept terms" });
  }
});
export default router;
