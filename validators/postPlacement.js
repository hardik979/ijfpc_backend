// src/validators/postPlacement.js
import { z } from "zod";

export const PAYMENT_MODES = [
  "CASH",
  "UPI",
  "CARD",
  "BANK_TRANSFER",
  "CHEQUE",
  "OTHER",
];

const installmentInput = z.object({
  _id: z.string().optional(), // present when editing
  label: z.string().min(1),
  amount: z.number().nonnegative(),
  date: z.coerce.date(),
  mode: z.enum(PAYMENT_MODES),
  note: z.string().optional(),
});

export const createOfferSchema = z.object({
  studentName: z.string().min(1),
  offerDate: z.coerce.date().optional(),
  joiningDate: z.coerce.date().optional(),
  companyName: z.string().optional(),
  location: z.string().optional(),
  hr: z
    .object({
      name: z.string().optional(),
      contactNumber: z.string().optional(),
      email: z.string().email().optional(),
    })
    .optional(),
  packageLPA: z.number().nullable().optional(),
  totalPostPlacementFee: z.number().nonnegative().default(0),
  remainingPrePlacementFee: z.number().nonnegative().default(0),
  discount: z.number().nonnegative().default(0),
  installments: z.array(installmentInput).default([]),
  remainingFeeNote: z.string().optional(),
  dedupeKey: z.string().optional(),
  source: z.string().optional(),
});

export const updateOfferSchema = createOfferSchema.partial();

export const queryListSchema = z.object({
  q: z.string().optional(),
  company: z.string().optional(),
  minRemaining: z.coerce.number().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort: z.string().optional(), // e.g. "-createdAt"
});

export const addInstallmentSchema = installmentInput;
