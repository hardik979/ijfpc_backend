import express from "express";
import PostPlacementOffer from "../models/PostPlacementOffer.js";

const router = express.Router();

// GET all offers
router.get("/list", async (req, res) => {
  try {
    const offers = await PostPlacementOffer.find().sort({ createdAt: -1 });
    res.json(offers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single offer
router.get("/:id", async (req, res) => {
  try {
    const offer = await PostPlacementOffer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: "Not found" });
    res.json(offer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE new offer
router.post("/create", async (req, res) => {
  try {
    const offer = new PostPlacementOffer(req.body);
    await offer.save();
    res.status(201).json(offer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE an offer
router.put("/:id", async (req, res) => {
  try {
    const offer = await PostPlacementOffer.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!offer) return res.status(404).json({ error: "Not found" });
    res.json(offer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE an offer
router.delete("/:id", async (req, res) => {
  try {
    const offer = await PostPlacementOffer.findByIdAndDelete(req.params.id);
    if (!offer) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add installment
router.post("/:id/installments", async (req, res) => {
  try {
    const offer = await PostPlacementOffer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: "Not found" });

    offer.installments.push(req.body); // {label, amount, date, mode, note}
    await offer.save();

    res.json(offer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update installment
router.patch("/:id/installments/:instId", async (req, res) => {
  try {
    const offer = await PostPlacementOffer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: "Not found" });

    const inst = offer.installments.id(req.params.instId);
    if (!inst) return res.status(404).json({ error: "Installment not found" });

    Object.assign(inst, req.body); // shallow merge
    await offer.save();

    res.json(offer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete installment
router.delete("/:id/installments/:instId", async (req, res) => {
  try {
    const offer = await PostPlacementOffer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: "Not found" });

    const inst = offer.installments.id(req.params.instId);
    if (!inst) return res.status(404).json({ error: "Installment not found" });

    inst.remove();
    await offer.save();

    res.json(offer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
