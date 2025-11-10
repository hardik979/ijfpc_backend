import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// 1) create order (fixed 28,320)
router.post("/create-order", async (req, res) => {
  try {
    const amount = 432000; // 28,320 * 100
    const receipt = `pp_${Date.now().toString().slice(-8)}`;

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt,
      notes: {
        purpose: "PREPLACEMENT_24K_GST",
      },
    });

    return res.json({
      orderId: order.id,
      key: process.env.RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err) {
    console.error("preplacement create-order error", err);
    return res.status(500).json({ error: "Failed to create order" });
  }
});

// 2) verify payment — NO DB WRITE
router.post("/verify", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      // form, // we don't need it now
    } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res
        .status(400)
        .json({ verified: false, error: "Missing razorpay fields" });
    }

    // check signature
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res
        .status(400)
        .json({ verified: false, error: "Signature mismatch" });
    }

    // optional: fetch payment to show details on frontend
    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    return res.json({
      verified: true,
      payment: {
        id: payment.id,
        amount: payment.amount / 100,
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        email: payment.email,
        contact: payment.contact,
      },
    });
  } catch (err) {
    console.error("preplacement verify error", err);
    return res.status(500).json({ verified: false, error: err.message });
  }
});

export default router;
