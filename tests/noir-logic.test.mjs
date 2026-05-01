import { describe, it, expect } from "vitest";
import {
  parseTime,
  byDateTime,
  shortId,
  parseSlotToDate,
  isPublicPhoneValid,
  bookingPhoneErrorMessage,
  buildEventReservationNotes,
  takenSlotTimesForDate,
} from "../js/lib/noir-logic.mjs";

describe("parseTime", () => {
  it("parses AM and PM", () => {
    expect(parseTime("12:00 AM")).toBe(0);
    expect(parseTime("12:30 AM")).toBe(30);
    expect(parseTime("12:00 PM")).toBe(12 * 60);
    expect(parseTime("7:30 PM")).toBe(19 * 60 + 30);
    expect(parseTime("11:00 PM")).toBe(23 * 60);
  });
  it("returns 0 for non-matching strings", () => {
    expect(parseTime("")).toBe(0);
    expect(parseTime("not a time")).toBe(0);
  });
});

describe("byDateTime", () => {
  it("sorts by date then clock", () => {
    const rows = [
      { date: "2026-05-02", time: "9:00 PM" },
      { date: "2026-05-02", time: "7:30 PM" },
      { date: "2026-05-01", time: "11:00 PM" },
    ];
    const sorted = [...rows].sort(byDateTime);
    expect(sorted.map(r => `${r.date} ${r.time}`)).toEqual([
      "2026-05-01 11:00 PM",
      "2026-05-02 7:30 PM",
      "2026-05-02 9:00 PM",
    ]);
  });
});

describe("shortId", () => {
  it("formats ids and handles empty", () => {
    expect(shortId("r_abc123")).toBe("R_AB-C123");
    expect(shortId("")).toBe("—");
  });
});

describe("parseSlotToDate", () => {
  it("combines ISO date with slot label", () => {
    const d = parseSlotToDate("2026-06-06", "8:00 PM");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June
    expect(d.getDate()).toBe(6);
    expect(d.getHours()).toBe(20);
    expect(d.getMinutes()).toBe(0);
  });
});

describe("isPublicPhoneValid", () => {
  it("requires length and allowed chars", () => {
    expect(isPublicPhoneValid("(780) 555-0142")).toBe(true);
    expect(isPublicPhoneValid("")).toBe(false);
    expect(isPublicPhoneValid("—")).toBe(false);
    expect(isPublicPhoneValid("123")).toBe(false);
  });
});

describe("bookingPhoneErrorMessage", () => {
  it("allows empty (walk-ins)", () => {
    expect(bookingPhoneErrorMessage("")).toBeNull();
    expect(bookingPhoneErrorMessage("   ")).toBeNull();
  });
  it("rejects em-dash placeholder", () => {
    expect(bookingPhoneErrorMessage("—")).toBe("Please enter a valid phone number.");
  });
  it("accepts normal phones", () => {
    expect(bookingPhoneErrorMessage("(780) 555-0142")).toBeNull();
  });
});

describe("buildEventReservationNotes", () => {
  it("prefixes event name", () => {
    expect(buildEventReservationNotes("Wine Salon", "")).toBe("Event: Wine Salon");
    expect(buildEventReservationNotes("Wine Salon", "  window seat  ")).toBe(
      "Event: Wine Salon — window seat"
    );
  });
});

describe("takenSlotTimesForDate", () => {
  const list = [
    { date: "2026-05-02", time: "7:30 PM", status: "confirmed" },
    { date: "2026-05-02", time: "8:30 PM", status: "pending" },
    { date: "2026-05-02", time: "9:00 PM", status: "cancelled" },
    { date: "2026-05-02", time: "10:00 PM", status: "no-show" },
    { date: "2026-05-03", time: "7:30 PM", status: "confirmed" },
  ];

  it("returns taken slots excluding cancelled and no-show", () => {
    const taken = takenSlotTimesForDate("2026-05-02", list);
    expect(taken.has("7:30 PM")).toBe(true);
    expect(taken.has("8:30 PM")).toBe(true);
    expect(taken.has("9:00 PM")).toBe(false);
    expect(taken.has("10:00 PM")).toBe(false);
  });

  it("returns empty set for missing date", () => {
    expect(takenSlotTimesForDate("", list).size).toBe(0);
  });
});
