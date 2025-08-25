import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
dayjs.extend(customParseFormat);

// "1,95,000" => 195000 ; "" => 0
const toAmount = (v) => {
  if (!v) return 0;
  const n = Number(String(v).replace(/[^\d.]/g, "")); // keep digits + dot
  return Number.isFinite(n) ? n : 0;
};

// "6.5 LPA" => 6.5
const toLPA = (v) => {
  if (!v) return null;
  const m = String(v).match(/([\d.]+)/);
  return m ? Number(m[1]) : null;
};

// "22-11-2024" or "03-02-2025"
const parseDMY = (v) => {
  if (!v) return null;
  // also handle "JOINING (25-11-2024)"
  const clean = String(v).replace(/[^\d-\/]/g, "");
  const formats = [
    "DD-MM-YYYY",
    "D-M-YYYY",
    "DD/MM/YYYY",
    "D/M/YYYY",
    "YYYY-MM-DD",
  ];
  for (const f of formats) {
    const d = dayjs(clean, f, true);
    if (d.isValid()) return d.toDate();
  }
  const d = new Date(clean);
  return Number.isNaN(d.getTime()) ? null : d;
};

const INSTALLMENT_KEYS = [
  "1ST INSTALLMENT",
  "2ND INSTALLMENT",
  "3RD INSTALLMENT",
  "4TH INSTALLMENT",
  "5TH INSTALLMENT",
  "6TH INSTALLMENT",
];

export function transformOfferRow(row) {
  const studentName = (row["STUDENT NAME"] || "").trim();
  const companyName = (row["COMPANY NAME"] || "").trim();
  const location = (row["LOCATION"] || "").trim();

  const offerDate = parseDMY(row["OFFER DATE"]);
  const joiningDate = parseDMY(row["JOINING DATE"]);

  const hr = {
    name: (row["HR NAME"] || "").trim(),
    contactNumber: (row["HR CONTACT NUMBER"] || "").trim(),
    email: (row["HR MAIL ID"] || "").trim(),
  };

  const packageLPA = toLPA(row["PACKAGE"]);
  const totalPostPlacementFee = toAmount(row["TOTAL POST PLACEMENT FEE"]);
  const remainingPrePlacementFee = toAmount(row["REMAINING PRE PLACEMENT FEE"]);
  const discount = toAmount(row["DISCOUNT"]);

  const installments = INSTALLMENT_KEYS.filter(
    (k) => row[k] !== undefined && String(row[k]).trim() !== ""
  ).map((k) => ({ label: k, amount: toAmount(row[k]) }));

  const remainingFeeRaw = (row["REMAINING FEE"] || "").trim();
  const remainingFee = toAmount(remainingFeeRaw); // 0 if text
  const remainingFeeNote =
    remainingFeeRaw && !remainingFee ? remainingFeeRaw : "";

  const datePart = offerDate ? dayjs(offerDate).format("YYYY-MM-DD") : "nodate";
  const dedupeKey = `${studentName.toUpperCase()}|${companyName.toUpperCase()}|${datePart}`;

  return {
    studentName,
    offerDate,
    joiningDate,
    companyName,
    location,
    hr,
    packageLPA,
    totalPostPlacementFee,
    remainingPrePlacementFee,
    discount,
    installments,
    remainingFee,
    remainingFeeNote,
    dedupeKey,
    source: "sheetdb",
  };
}
