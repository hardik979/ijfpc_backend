import express from "express";
import { Student } from "../models/student.model.js";
import cloudinary from "../config/cloudinary.js";
const router = express.Router();

const isEmail = (s = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
const isYear = (n) => Number.isInteger(n) && n >= 1990 && n <= 2100;

function validateAdmission(body = {}) {
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

  if (!body.aadhaar?.publicId) errors.push("aadhaar upload metadata missing");
  if (!body.aadhaarLast4 || !/^\d{4}$/.test(String(body.aadhaarLast4)))
    errors.push("aadhaarLast4 must be exactly 4 digits");

  if (!body.prePlacement?.plan || !PRE_PLANS.includes(body.prePlacement.plan))
    errors.push("prePlacement.plan is invalid");

  if (body.email && !isEmail(body.email)) errors.push("email is invalid");

  // Allow 10–15 digits (you can tighten to India rules if you like)
  if (
    body.mobile &&
    !/^\d{10,15}$/.test(String(body.mobile).replace(/\D/g, ""))
  )
    errors.push("mobile is invalid");

  return errors;
}

/* ---------- create student ---------- */
router.post("/admission", async (req, res) => {
  try {
    const b = req.body || {};

    // 1) validate early
    const errors = validateAdmission(b);
    if (errors.length) {
      // no big stack traces — just a clean 400
      return res
        .status(400)
        .json({ error: "Validation failed", details: errors });
    }

    // 2) normalize
    const email = String(b.email).trim().toLowerCase();
    const mobile = String(b.mobile).trim();

    // 3) pre-check duplicates to avoid E11000 logs
    const [emailDup, mobileDup] = await Promise.all([
      Student.exists({ email }),
      Student.exists({ mobile }),
    ]);
    if (emailDup)
      return res.status(409).json({ error: "email already exists" });
    if (mobileDup)
      return res.status(409).json({ error: "mobile already exists" });

    // 4) save
    const student = new Student({
      fullName: b.fullName,
      fathersName: b.fathersName,
      mobile,
      email,
      address: b.address,
      degree: b.degree,
      passoutYear: Number(b.passoutYear),
      mode: b.mode,
      aadhaar: {
        publicId: b.aadhaar.publicId,
        url: b.aadhaar.url,
        format: b.aadhaar.format,
        bytes: b.aadhaar.bytes,
        uploadedAt: b.aadhaar.uploadedAt
          ? new Date(b.aadhaar.uploadedAt)
          : new Date(),
        resourceType: b.aadhaar.resourceType || "image",
        pages: b.aadhaar.pages,
      },
      aadhaarLast4: String(b.aadhaarLast4).slice(-4),
      prePlacement: b.prePlacement,
    });

    await student.save();
    return res
      .status(201)
      .json({ message: "Student registered successfully", student });
  } catch (err) {
    // 5) quiet, user-friendly errors
    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || "unique field";
      console.warn(`Duplicate ${field} attempted`);
      return res.status(409).json({ error: `${field} already exists` });
    }
    console.warn("Admission create failed:", err?.message);
    return res
      .status(400)
      .json({ error: "Unable to create student", details: err?.message });
  }
});

/* ---------- existing GET (unchanged) ---------- */
router.get("/:id/aadhaar", async (req, res) => {
  try {
    const s = await Student.findById(req.params.id).select("aadhaar");
    if (!s?.aadhaar?.publicId)
      return res.status(404).json({ error: "Not found" });

    const isPdf = s.aadhaar.format?.toLowerCase() === "pdf";
    const resourceType = isPdf ? "raw" : s.aadhaar.resourceType || "image";
    const format = isPdf ? "pdf" : s.aadhaar.format || "jpg";

    const url = cloudinary.utils.private_download_url(
      s.aadhaar.publicId,
      format,
      {
        resource_type: resourceType,
        expires_at: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      }
    );

    res.json({ url, publicId: s.aadhaar.publicId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 👉 Get all students
router.get("/", async (req, res) => {
  try {
    const students = await Student.find().lean();
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

// 👉 Get single student by ID
router.get("/:id", async (req, res) => {
  try {
    const student = await Student.findById(req.params.id).lean();
    if (!student) return res.status(404).json({ error: "Student not found" });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch student" });
  }
});

export default router;
