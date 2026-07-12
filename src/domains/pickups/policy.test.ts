import { describe, expect, it } from "vitest";
import {
  applySizeMultiplier,
  canTransitionAppointment,
  canTransitionReservation,
  cancellationEligible,
  checkInEligible,
  namesSimilar,
  noShowEligible,
  normalizeEmail,
  normalizePhone,
  planFefoAllocation,
  rangesOverlap,
  remainingReserved,
  rescheduleEligible,
  scoreHouseholdDuplicate,
  selectSizeRule,
  substitutionConflicts,
  validateHouseholdCounts,
} from "@/domains/pickups/policy";

describe("appointment state machine", () => {
  it("allows the documented transitions", () => {
    expect(canTransitionAppointment("scheduled", "confirmed")).toBe(true);
    expect(canTransitionAppointment("confirmed", "arrived")).toBe(true);
    expect(canTransitionAppointment("arrived", "completed")).toBe(true);
    expect(canTransitionAppointment("partially_completed", "completed")).toBe(true);
    expect(canTransitionAppointment("no_show", "arrived")).toBe(true);
  });

  it("blocks invalid transitions", () => {
    expect(canTransitionAppointment("cancelled", "completed")).toBe(false);
    expect(canTransitionAppointment("completed", "scheduled")).toBe(false);
    expect(canTransitionAppointment("rescheduled", "completed")).toBe(false);
    expect(canTransitionAppointment("draft", "completed")).toBe(false);
  });
});

describe("reservation state machine", () => {
  it("allows release, expiry, and fulfillment from active", () => {
    expect(canTransitionReservation("active", "released")).toBe(true);
    expect(canTransitionReservation("active", "expired")).toBe(true);
    expect(canTransitionReservation("partially_fulfilled", "fulfilled")).toBe(true);
  });

  it("terminal states are terminal", () => {
    expect(canTransitionReservation("fulfilled", "active")).toBe(false);
    expect(canTransitionReservation("released", "active")).toBe(false);
    expect(canTransitionReservation("expired", "fulfilled")).toBe(false);
  });
});

describe("normalization", () => {
  it("normalizes US phone formats to E.164", () => {
    expect(normalizePhone("(202) 555-0173")).toBe("+12025550173");
    expect(normalizePhone("1-202-555-0173")).toBe("+12025550173");
    expect(normalizePhone("+12025550173")).toBe("+12025550173");
  });

  it("rejects implausible phone numbers", () => {
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("normalizes email case and rejects invalid addresses", () => {
    expect(normalizeEmail(" Rivera@Example.TEST ")).toBe("rivera@example.test");
    expect(normalizeEmail("nope")).toBeNull();
  });
});

describe("household counts", () => {
  it("accepts consistent counts and rejects overflow or zero size", () => {
    expect(validateHouseholdCounts({ householdSize: 4, adultCount: 2, childCount: 2 })).toBe(true);
    expect(validateHouseholdCounts({ householdSize: 2, adultCount: 2, childCount: 2 })).toBe(false);
    expect(validateHouseholdCounts({ householdSize: 0 })).toBe(false);
    expect(validateHouseholdCounts({ householdSize: 3, adultCount: -1 })).toBe(false);
  });
});

describe("duplicate detection", () => {
  it("scores explainable signals deterministically", () => {
    const result = scoreHouseholdDuplicate({ samePhone: true, sameEmail: false, sameExternalReference: false, similarName: true });
    expect(result.score).toBe(80);
    expect(result.signals.map((signal) => signal.reason)).toEqual(["Shared phone number", "Similar display name"]);
  });

  it("compares names by shared meaningful tokens", () => {
    expect(namesSimilar("Rivera Household", "Rivera Family Household")).toBe(true);
    expect(namesSimilar("Nguyen Household", "Jackson Household")).toBe(false);
  });
});

describe("size rules", () => {
  const rules = [
    { id: "a", minimumHouseholdSize: 1, maximumHouseholdSize: 2, quantityMultiplier: "1" },
    { id: "b", minimumHouseholdSize: 3, maximumHouseholdSize: 4, quantityMultiplier: "1.5" },
    { id: "c", minimumHouseholdSize: 5, maximumHouseholdSize: null, quantityMultiplier: "2" },
  ];

  it("selects the covering rule", () => {
    expect(selectSizeRule(rules, 1)?.id).toBe("a");
    expect(selectSizeRule(rules, 4)?.id).toBe("b");
    expect(selectSizeRule(rules, 9)?.id).toBe("c");
  });

  it("returns null when no rule matches", () => {
    expect(selectSizeRule(rules.slice(0, 1), 5)).toBeNull();
  });

  it("detects overlapping ranges including unbounded maxima", () => {
    expect(rangesOverlap({ minimumHouseholdSize: 1, maximumHouseholdSize: 3 }, { minimumHouseholdSize: 3, maximumHouseholdSize: 5 })).toBe(true);
    expect(rangesOverlap({ minimumHouseholdSize: 1, maximumHouseholdSize: 2 }, { minimumHouseholdSize: 3, maximumHouseholdSize: null })).toBe(false);
    expect(rangesOverlap({ minimumHouseholdSize: 4, maximumHouseholdSize: null }, { minimumHouseholdSize: 6, maximumHouseholdSize: null })).toBe(true);
  });

  it("multiplies with fixed precision and ceiling rounding to whole units", () => {
    expect(applySizeMultiplier("3", "1.5")).toBe("5"); // 4.5 rounds up
    expect(applySizeMultiplier("4", "1.5")).toBe("6"); // exact
    expect(applySizeMultiplier("2", "1")).toBe("2");
    expect(() => applySizeMultiplier("0", "1.5")).toThrow("INVALID_QUANTITY");
  });
});

describe("FEFO reservation planning", () => {
  it("allocates earliest-expiring lots first and spans multiple lots", () => {
    const { allocations, shortage } = planFefoAllocation(
      [
        { lotId: "late", expirationDate: "2026-12-01", receivedDate: "2026-07-01", availableQuantity: 10 },
        { lotId: "early", expirationDate: "2026-08-01", receivedDate: "2026-07-01", availableQuantity: 4 },
        { lotId: "none", expirationDate: null, receivedDate: "2026-06-01", availableQuantity: 10 },
      ],
      6,
    );
    expect(allocations).toEqual([
      { lotId: "early", quantity: 4 },
      { lotId: "late", quantity: 2 },
    ]);
    expect(shortage).toBe(0);
  });

  it("reports the exact shortage when stock is insufficient", () => {
    const { allocations, shortage } = planFefoAllocation(
      [{ lotId: "only", expirationDate: null, receivedDate: "2026-07-01", availableQuantity: 3 }],
      8,
    );
    expect(allocations).toEqual([{ lotId: "only", quantity: 3 }]);
    expect(shortage).toBe(5);
  });
});

describe("substitution restrictions", () => {
  it("blocks critical restriction matches and allows informational ones", () => {
    expect(substitutionConflicts([{ valueCode: "nut_free", severity: "critical" }], "Mixed nut trail packs").blocked).toBe(true);
    expect(substitutionConflicts([{ valueCode: "no_pork", severity: "critical" }], "Canned pork and beans").blocked).toBe(true);
    expect(substitutionConflicts([{ valueCode: "vegetarian", severity: "info" }], "Canned beef stew").blocked).toBe(false);
  });
});

describe("eligibility rules", () => {
  it("check-in requires scheduled or confirmed", () => {
    expect(checkInEligible("scheduled")).toBe(true);
    expect(checkInEligible("confirmed")).toBe(true);
    expect(checkInEligible("cancelled")).toBe(false);
    expect(checkInEligible("no_show")).toBe(false);
  });

  it("no-show requires the window to have ended", () => {
    const end = new Date("2026-07-11T17:00:00Z");
    expect(noShowEligible("scheduled", end, new Date("2026-07-11T17:01:00Z"))).toBe(true);
    expect(noShowEligible("scheduled", end, new Date("2026-07-11T12:00:00Z"))).toBe(false);
    expect(noShowEligible("arrived", end, new Date("2026-07-11T18:00:00Z"))).toBe(false);
  });

  it("cancellation and reschedule follow status", () => {
    expect(cancellationEligible("arrived")).toBe(true);
    expect(cancellationEligible("completed")).toBe(false);
    expect(rescheduleEligible("confirmed")).toBe(true);
    expect(rescheduleEligible("arrived")).toBe(false);
  });
});

describe("remaining reserved", () => {
  it("nets fulfilled and released and floors at zero", () => {
    expect(remainingReserved({ reserved: 10, fulfilled: 4, released: 2 })).toBe(4);
    expect(remainingReserved({ reserved: 5, fulfilled: 5, released: 0 })).toBe(0);
    expect(remainingReserved({ reserved: 3, fulfilled: 2, released: 2 })).toBe(0);
  });
});
