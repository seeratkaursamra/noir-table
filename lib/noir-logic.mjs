/**
 * Pure reservation helpers — shared by app.js (browser) and Vitest (Node).
 * Keep booking rules in sync with the UI by importing these everywhere possible.
 */

export function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t || "");
  if (!m) return 0;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return h * 60 + Number(m[2]);
}

export function byDateTime(a, b) {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return parseTime(a.time) - parseTime(b.time);
}

/** Customer-facing booking ref, e.g. r_abc123 → R_ABC-123X */
export function shortId(id) {
  if (!id) return "—";
  const clean = String(id).replace(/-/g, "").toUpperCase();
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
}

/** ISO date + "8:00 PM" → local Date at that wall-clock on that calendar day */
export function parseSlotToDate(iso, slot) {
  const m = slot.match(/(\d+):(\d+)\s*(AM|PM)/i);
  let h = m ? Number(m[1]) % 12 : 19;
  if (m && m[3].toUpperCase() === "PM") h += 12;
  const min = m ? Number(m[2]) : 0;
  const d = new Date(`${iso}T00:00:00`);
  d.setHours(h, min, 0, 0);
  return d;
}

/** Public reservation form — phone is required and must look reachable */
export function isPublicPhoneValid(phone) {
  return /^[0-9()+\-\s]{7,}$/.test(String(phone || "").trim());
}

/** Staff modal — phone optional; if present, same format rule as public */
export function bookingPhoneErrorMessage(phone) {
  const p = String(phone || "").trim();
  if (!p) return null;
  if (!/^[0-9()+\-\s]{7,}$/.test(p)) return "Please enter a valid phone number.";
  return null;
}

export function buildEventReservationNotes(eventName, userNotes) {
  const u = String(userNotes || "").trim();
  return u ? `Event: ${eventName} — ${u}` : `Event: ${eventName}`;
}

/**
 * Which time strings are unavailable on `iso` because an existing row holds the slot.
 * Rows with status in `excludeStatuses` free the slot (cancelled / no-show).
 */
export function takenSlotTimesForDate(iso, reservations, excludeStatuses = ["cancelled", "no-show"]) {
  if (!iso) return new Set();
  return new Set(
    reservations
      .filter(r => r.date === iso && !excludeStatuses.includes(r.status))
      .map(r => r.time)
  );
}
