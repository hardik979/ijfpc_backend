// lib/pushLeadToSheet.js
import fetch from "node-fetch";

export async function pushLeadToSheet({ webhookUrl, lead }) {
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: lead.fullName,
      fathersName: lead.fathersName,
      mobile: lead.mobile,
      email: lead.email,
      address: lead.address,
      degree: lead.degree,
      passoutYear: lead.passoutYear,
      mode: lead.mode,
      source: lead.source || "AdmissionForm",
    }),
  });
  const out = await resp.json().catch(() => ({}));
  if (!resp.ok || !out?.ok)
    throw new Error(out?.error || "Sheet append failed");
}
