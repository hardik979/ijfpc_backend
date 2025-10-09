import dayjs from "dayjs";

function esc(s = "") {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m])
  );
}

export function buildReceiptHTML({
  student,
  payment,
  order,
  plan /*, preplacement*/,
}) {
  const paidAt = payment?.created_at
    ? dayjs(payment.created_at * 1000).format("DD MMM YYYY, HH:mm")
    : "-";
  const amountR = (payment?.amount || 0) / 100;
  const planText =
    plan === "EMI_SNAPMINT_30K"
      ? "EMI via Snapmint — ₹30,000"
      : "One-shot — ₹25,000";
  const totalFee = plan === "EMI_SNAPMINT_30K" ? 30000 : 25000;
  // Remaining is plan total minus amount paid in this receipt
  const remaining = Math.max(totalFee - amountR, 0);

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Payment Receipt</title>
  <style>
    body{font-family:Inter,Arial,Helvetica,sans-serif;margin:0;color:#0f172a;background:#fff;}
    .wrap{max-width:820px;margin:0 auto;padding:32px;}
    /* --- Header centered --- */
    .brand{display:flex;flex-direction:column;align-items:center;justify-content:center;margin-bottom:16px;text-align:center}
    .brand h1{margin:8px 0 2px;font-size:24px;color:#0ea5b7;font-weight:800}
    .muted{color:#64748b;font-size:12px} /* smaller subtitle */
    .card{border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:14px 0;background:#fafafa}
    .row{display:flex;gap:24px;flex-wrap:wrap}
    .col{flex:1 1 280px}
    .h{font-weight:600;margin-bottom:6px}
    .kv{margin:6px 0}
    .table{width:100%;border-collapse:collapse;margin-top:8px}
    .table th,.table td{border:1px solid #e2e8f0;padding:10px;text-align:left}
    .badge{display:inline-block;padding:4px 10px;border-radius:999px;background:#ecfeff;color:#0e7490;font-weight:600;font-size:12px}
    .footer{margin-top:28px;font-size:12px;color:#64748b}
    .total{font-weight:700}
    .right{text-align:right}
    img.logo{height:40px}
  </style>
</head>
<body>
  <div class="wrap">
    <!-- Centered header -->
    <div class="brand">
      <img class="logo" src="https://res.cloudinary.com/doliynoks/image/upload/v1759574260/WhatsApp_Image_2025-10-04_at_3.56.23_PM_gwkxlu.jpg" alt="Logo"/>

      <div class="muted">From Learning to Earning</div>
    </div>

    <h2 style="margin:8px 0 0">Payment Receipt</h2>
    <div class="muted">Receipt No: ${esc(
      order?.receipt || payment?.id || "-"
    )}</div>

    <!-- 1) Student FIRST -->
    <div class="card row">
      <div class="col">
        <div class="h">Student</div>
        <div class="kv">Name: <b>${esc(student?.fullName || "-")}</b></div>
        <div class="kv">Email: ${esc(student?.email || "-")}</div>
        <div class="kv">Mobile: ${esc(student?.mobile || "-")}</div>
      </div>
      <div class="col">
        <div class="h">Plan</div>
        <div class="kv">Selected Plan: <span class="badge">${esc(
          planText
        )}</span></div>
      </div>
    </div>

    <!-- 2) Payment -->
    <div class="card row">
      <div class="col">
        <div class="h">Payment</div>
        <div class="kv">Date & Time: <b>${esc(paidAt)}</b></div>
        <div class="kv">Amount Paid: <b>₹${amountR.toLocaleString(
          "en-IN"
        )}</b></div>
        <div class="kv">Method: <b>${methodLabel(payment)}</b></div>
        <div class="kv">Currency: ${esc(payment?.currency || "INR")}</div>
      </div>
    </div>

    <!-- 3) Identifiers -->
    <div class="card row">
      <div class="col">
        <div class="h">Identifiers</div>
        <div class="kv">Payment ID: ${esc(payment?.id || "-")}</div>
        <div class="kv">Order ID: ${esc(order?.id || "-")}</div>
      </div>
    </div>

    <!-- 4) Fee Summary (no "Collected till date") -->
    <div class="card row">
      <div class="col">
        <div class="h">Fee Summary</div>
        <table class="table">
          <tr><th>Total Fee (Plan)</th><td>₹${totalFee.toLocaleString(
            "en-IN"
          )}</td></tr>
          <tr><th class="total">Remaining</th><td class="total">₹${Number(
            remaining
          ).toLocaleString("en-IN")}</td></tr>
        </table>
      </div>
    </div>

    <div class="footer">
      This is a system-generated receipt. For any queries, reply to this email.
    </div>
  </div>
</body>
</html>`;
}

function methodLabel(p) {
  const m = p?.method;
  if (m === "upi") return "UPI (QR/Intent)";
  if (m === "card") return "Card";
  if (m === "netbanking") return "Netbanking";
  if (m === "wallet") return `Wallet (${p?.wallet || "N/A"})`;
  if (m === "emi") return "EMI";
  if (m === "cardless_emi")
    return `Cardless EMI (${p?.cardless_emi?.provider || "Provider"})`;
  return (m || "Unknown").toUpperCase();
}
