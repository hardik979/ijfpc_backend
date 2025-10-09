// lib/nameKey.js
export function makeNameKey(fullName = "", mobile = "") {
  const slug = String(fullName)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/\-+/g, "-");
  const last4 = String(mobile).replace(/\D/g, "").slice(-4);
  return last4 ? `${slug}-${last4}` : slug;
}
