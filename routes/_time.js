// tiny helpers (no deps) for local day math in Asia/Kolkata (UTC+5:30)
export const tzOffsetMin = 5 * 60 + 30;

export function toDayKey(date = new Date()) {
  const d = new Date(date.getTime() + tzOffsetMin * 60000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function localMinutes(date) {
  // minutes since midnight in OFFICE_TZ
  const d = new Date(date.getTime() + tzOffsetMin * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function clampToOfficeWindow(date, startMin, endMin) {
  const d = new Date(date.getTime() + tzOffsetMin * 60000);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const clamped = Math.min(Math.max(minutes, startMin), endMin);
  const deltaMin = clamped - minutes;
  return new Date(
    date.getTime() + (deltaMin - tzOffsetMin) * 60000 + tzOffsetMin * 60000
  );
}
