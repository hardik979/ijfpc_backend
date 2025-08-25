import { Router } from "express";
import { body, validationResult } from "express-validator";
import PrePlacementOldData from "../models/prePlacementOldData.model.js";

const router = Router();

const STATUSES = ["ONGOING", "COMPLETED", "DROPPED"];
const PAY_MODES = ["CASH", "CARD", "UPI", "BANK_TRANSFER", "OTHER"];

// Create a legacy candidate
router.post(
  "/",
  [
    body("candidateName").isString().trim().notEmpty(),
    body("courseOpted").isString().trim().notEmpty(),
    body("totalFees").isFloat({ min: 0 }).toFloat(),

    body("address").optional().isString().trim(),
    body("contactNumber").optional().isString().trim(),
    body("status").optional().isIn(STATUSES),

    // admissionPeriod
    body("admissionPeriod.start")
      .isISO8601()
      .withMessage("admissionPeriod.start must be a valid date"), // required ✅
    body("admissionPeriod.end")
      .optional()
      .isISO8601()
      .withMessage("admissionPeriod.end must be a valid date if provided"), // optional ✅

    // installments
    body("installments").isArray().withMessage("installments must be an array"),
    body("installments.*.receiptNo").optional().isString().trim(),
    body("installments.*.receivedDate")
      .optional()
      .isISO8601()
      .withMessage("Invalid date"),
    body("installments.*.receivedAmount")
      .optional()
      .isFloat({ min: 0 })
      .toFloat(),
    body("installments.*.balanceAfter")
      .optional()
      .isFloat({ min: 0 })
      .toFloat(),
    body("installments.*.modeOfPayment").optional().isIn(PAY_MODES),
    body("installments.*.nextInstallmentDate").optional().isISO8601(),
    body("installments.*.remarks").optional().isString().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    try {
      const doc = await PrePlacementOldData.create(req.body);
      res.status(201).json({ data: doc });
    } catch (e) {
      console.error("Create pre-old-data failed:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// Quick list (for verification in UI)
router.get("/", async (req, res) => {
  const { q, status, course } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (course) filter.courseOpted = course;
  if (q) filter.candidateName = new RegExp(String(q), "i");

  const data = await PrePlacementOldData.find(filter)
    .select("candidateName courseOpted totalFees status contactNumber")
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json({ data });
});

export default router;
