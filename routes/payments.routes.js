// routes/payments.routes.js
import express from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { Student } from "../models/student.model.js";
import PrePlacementStudent from "../models/PrePlacementStudent.js";
import { makeNameKey } from "../lib/nameKey.js";
import { sendMail } from "../lib/mailer.js";
import { buildReceiptHTML } from "../lib/receipt-template.js";
import { htmlToPdf } from "../lib/receipt-pdf.js";
import { welcomeHtml, plainTextFallback } from "../lib/email-template.js";
import fs from "fs";
const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- helper: map RZP method -> friendly mode string

function modeFromPayment(p) {
  const m = p?.method;
  if (m === "upi") return "RZP:UPI";
  if (m === "card") return "RZP:CARD";
  if (m === "netbanking") return "RZP:NETBANKING";
  if (m === "wallet") return `RZP:WALLET:${p?.wallet || "GEN"}`;
  if (m === "emi") return "RZP:EMI";
  if (m === "cardless_emi")
    return `RZP:CARDLESS_EMI:${(
      p?.cardless_emi?.provider || "PROVIDER"
    ).toUpperCase()}`;
  return `RZP:${(m || "UNKNOWN").toUpperCase()}`;
}
// POST /payments/create-order
// POST /payments/create-order
router.post("/create-order", async (req, res) => {
  try {
    const { studentId } = req.body || {};
    if (!studentId) return res.status(400).json({ error: "Missing studentId" });

    const s = await Student.findById(studentId);
    if (!s) return res.status(404).json({ error: "Student not found" });

    // Fixed admission fee: ₹1,000
    const amount = 100000; // paise

    // short receipt (<= 40 chars)
    const short = String(studentId).slice(-6);
    const ts = Date.now().toString().slice(-8);
    const receipt = `ad1k_${short}_${ts}`;

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt,
      notes: { studentId, purpose: "Admission 1K" },
    });

    s.admissionPayment = {
      plan: "ADMISSION_1K",
      status: "CREATED",
      amount,
      currency: "INR",
      orderId: order.id,
      notes: order.notes || {},
    };
    await s.save();

    return res.json({
      orderId: order.id,
      key: process.env.RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (e) {
    console.error("create-order error", e);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// POST /payments/verify
router.post("/verify", async (req, res) => {
  try {
    const {
      studentId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};
    if (
      !studentId ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // 1) Signature verify
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    if (expected !== razorpay_signature) {
      await Student.updateOne(
        { _id: studentId, "admissionPayment.orderId": razorpay_order_id },
        { $set: { "admissionPayment.status": "FAILED" } }
      );
      return res
        .status(400)
        .json({ verified: false, error: "Signature mismatch" });
    }

    // 2) Fetch payment + order
    const [payment, order] = await Promise.all([
      razorpay.payments.fetch(razorpay_payment_id),
      razorpay.orders.fetch(razorpay_order_id),
    ]);

    // 3) Update Student payment fields
    const s = await Student.findById(studentId);
    if (!s) return res.status(404).json({ error: "Student not found" });

    s.admissionPayment = {
      ...(s.admissionPayment || {}),
      plan: "ADMISSION_1K",
      status: "PAID",
      paymentId: payment.id,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || "INR",
      paidAt: new Date(payment.created_at * 1000),
      notes: order.notes || {},
    };
    await s.save();

    // 4) Upsert into PrePlacementStudent.payments
    const nameKey = makeNameKey(s.fullName, s.mobile);
    const rupees = Math.round((payment.amount || 0) / 100);
    await PrePlacementStudent.updateOne(
      { nameKey, "payments.receiptNos": { $ne: payment.id } },
      {
        $setOnInsert: {
          name: s.fullName,
          nameKey,
          totalFee: 0,
          status: "ACTIVE",
          zone: "BLUE",
        },
        $push: {
          payments: {
            amount: rupees,
            date: new Date(payment.created_at * 1000),
            mode: modeFromPayment(payment),
            receiptNos: [payment.id, order.receipt].filter(Boolean),
            note: "ADMISSION_1K",
            raw: payment,
          },
        },
      },
      { upsert: true }
    );

    // 5) Build PDF + email (unchanged)
    const preplacement = await PrePlacementStudent.findOne({ nameKey })
      .lean()
      .catch(() => null);

    const html = buildReceiptHTML({
      student: s.toObject ? s.toObject() : s,
      preplacement,
      payment,
      order,
      plan: "ADMISSION_1K",
    });

    const recName = `Receipt_${order?.receipt || payment?.id}.pdf`;
    const pdf = await htmlToPdf({ html, filename: recName });

    try {
      await sendMail({
        to: s.email,
        subject: "Welcome to IT Jobs Factory — Admission Payment Received",
        html: welcomeHtml({ name: s.fullName }),
        text: plainTextFallback({ name: s.fullName }),
        attachments: [
          {
            filename: pdf.filename,
            path: pdf.filePath,
            contentType: "application/pdf",
          },
        ],
      });
      await Student.updateOne(
        { _id: s._id },
        { $set: { "admissionPayment.emailSentAt": new Date() } }
      );
    } catch (mailErr) {
      console.error("Email send failed:", mailErr);
    } finally {
      try {
        fs.unlinkSync(pdf.filePath);
      } catch {}
    }

    return res.json({ verified: true });
  } catch (e) {
    console.error("verify error", e);
    return res.status(500).json({ error: e.message, verified: false });
  }
});

export default router;
