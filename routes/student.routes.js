import express from "express";
import { Student } from "../models/student.model.js";

const router = express.Router();

// routes/students.js
router.post("/admission", async (req, res) => {
  try {
    const {
      fullName,
      fathersName,
      mobile,
      email,
      address,
      degree,
      passoutYear,
      mode,
      aadhaar, // <-- { publicId, url, format, bytes, uploadedAt }
    } = req.body;

    const student = new Student({
      fullName,
      fathersName,
      mobile,
      email,
      address,
      degree,
      passoutYear,
      mode,
      aadhaar,
      aadhaarLast4,
    });

    await student.save();
    res
      .status(201)
      .json({ message: "Student registered successfully", student });
  } catch (err) {
    console.error("❌ Error saving student:", err);
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
