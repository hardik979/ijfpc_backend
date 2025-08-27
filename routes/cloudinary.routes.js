import express from "express";
import cloudinary from "../config/cloudinary.js";

const router = express.Router();

// Creates a short-lived signature for client-side (direct) uploads
router.post("/sign", (req, res) => {
  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = "students/aadhaar";
    const upload_preset = process.env.CLOUDINARY_SIGNED_PRESET;

    // any param you send to Cloudinary must be in the signature
    const paramsToSign = { timestamp, folder, upload_preset };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    );

    return res.json({
      timestamp,
      signature,
      folder,
      upload_preset,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
    });
  } catch (e) {
    console.error("signature error", e);
    res.status(500).json({ error: "Failed to create signature" });
  }
});

export default router;
