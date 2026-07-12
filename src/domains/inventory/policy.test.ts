import { describe, expect, it } from "vitest";
import {
  canReverse,
  compareFefo,
  isExpiredOn,
  isSignValid,
  lotAvailability,
  resolveBaseQuantity,
  transactionSign,
} from "@/domains/inventory/policy";

describe("resolveBaseQuantity", () => {
  it("multiplies whole quantities by an integer factor", () => {
    expect(resolveBaseQuantity("4", "12", "reject")).toEqual({ base: "48", roundingDelta: "0" });
  });

  it("handles decimal factors exactly within base precision", () => {
    expect(resolveBaseQuantity("2.5", "1.5", "reject")).toEqual({ base: "3.75", roundingDelta: "0" });
  });

  it("rejects a quantity that cannot be represented exactly under the reject policy", () => {
    expect(() => resolveBaseQuantity("1", "0.3333333", "reject")).toThrow("ROUNDING_REQUIRED");
  });

  it("floors, ceilings, and half-ups to six base decimals", () => {
    expect(resolveBaseQuantity("1", "0.12345678", "floor").base).toBe("0.123456");
    expect(resolveBaseQuantity("1", "0.12345678", "ceiling").base).toBe("0.123457");
    expect(resolveBaseQuantity("1", "0.1234565", "half_up").base).toBe("0.123457");
  });

  it("rejects zero and negative input quantities", () => {
    expect(() => resolveBaseQuantity("0", "12", "reject")).toThrow("INVALID_QUANTITY");
    expect(() => resolveBaseQuantity("-1", "12", "reject")).toThrow("INVALID_QUANTITY");
  });
});

describe("transaction sign rules", () => {
  it("classifies types", () => {
    expect(transactionSign("donation_received")).toBe("positive");
    expect(transactionSign("spoilage")).toBe("negative");
    expect(transactionSign("reversal")).toBe("reversal");
  });

  it("validates the delta direction", () => {
    expect(isSignValid("opening_balance", 10)).toBe(true);
    expect(isSignValid("opening_balance", -10)).toBe(false);
    expect(isSignValid("spoilage", -3)).toBe(true);
    expect(isSignValid("spoilage", 3)).toBe(false);
    expect(isSignValid("manual_positive_adjustment", 0)).toBe(false);
  });
});

describe("compareFefo", () => {
  it("orders by expiration ascending with unknown expiry last, then received date, then id", () => {
    const lots = [
      { expirationDate: null, receivedDate: "2026-01-01", lotId: "d" },
      { expirationDate: "2026-03-01", receivedDate: "2026-01-01", lotId: "b" },
      { expirationDate: "2026-02-01", receivedDate: "2026-01-05", lotId: "a" },
      { expirationDate: "2026-03-01", receivedDate: "2026-01-01", lotId: "c" },
    ];
    expect(lots.slice().sort(compareFefo).map((lot) => lot.lotId)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("lotAvailability", () => {
  it("excludes expired physical stock from valid and available", () => {
    expect(lotAvailability({ physicalOnHand: 30, isExpired: true, lotStatus: "active" })).toEqual({
      physicalOnHand: 30,
      expiredQuantity: 30,
      validOnHand: 0,
      available: 0,
    });
  });

  it("counts active non-expired stock as available", () => {
    expect(lotAvailability({ physicalOnHand: 48, isExpired: false, lotStatus: "active" })).toEqual({
      physicalOnHand: 48,
      expiredQuantity: 0,
      validOnHand: 48,
      available: 48,
    });
  });

  it("treats archived lots as unavailable", () => {
    expect(lotAvailability({ physicalOnHand: 5, isExpired: false, lotStatus: "archived" }).available).toBe(0);
  });
});

describe("isExpiredOn", () => {
  it("is expired only strictly before the local date", () => {
    expect(isExpiredOn("2026-07-10", "2026-07-11")).toBe(true);
    expect(isExpiredOn("2026-07-11", "2026-07-11")).toBe(false);
    expect(isExpiredOn(null, "2026-07-11")).toBe(false);
  });
});

describe("canReverse", () => {
  it("blocks reversing a reversal and blocks double reversal", () => {
    expect(canReverse({ isReversal: true, alreadyReversed: false })).toEqual({ ok: false, reason: "CANNOT_REVERSE_REVERSAL" });
    expect(canReverse({ isReversal: false, alreadyReversed: true })).toEqual({ ok: false, reason: "ALREADY_REVERSED" });
    expect(canReverse({ isReversal: false, alreadyReversed: false })).toEqual({ ok: true });
  });
});
