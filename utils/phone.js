// src/utils/phone.js
import { parsePhoneNumber } from "libphonenumber-js";

/** Returns E.164 like "+919425645642" or null if invalid */
export function toE164(phone, defaultCountry = "IN") {
  try {
    const p = parsePhoneNumber(String(phone), defaultCountry);
    if (!p || !p.isValid()) return null;
    return p.number; // E.164
  } catch {
    return null;
  }
}
