import { describe, expect, it } from "vitest";
import {
  adjustmentMayPost,
  classifyAdjustmentRisk,
  countStateAllows,
  transferCompletionStatus,
  transferStateAllows,
} from "@/domains/inventory/operations-policy";

describe("inventory operations policy", () => {
  it("classifies adjustments from server-side absolute and percentage thresholds", () => {
    expect(classifyAdjustmentRisk(3, 100)).toBe("normal");
    expect(classifyAdjustmentRisk(25, 1000)).toBe("high");
    expect(classifyAdjustmentRisk(5, 20)).toBe("high");
  });

  it("requires a distinct approver with elevated permission for high-risk adjustments", () => {
    expect(adjustmentMayPost({ risk: "normal", requesterId: "a", hasStandardPermission: true, hasLargePermission: false })).toBe(true);
    expect(adjustmentMayPost({ risk: "high", requesterId: "a", approverId: "a", hasStandardPermission: true, hasLargePermission: true })).toBe(false);
    expect(adjustmentMayPost({ risk: "high", requesterId: "a", approverId: "b", hasStandardPermission: true, hasLargePermission: true })).toBe(true);
  });

  it("enforces transfer and cycle-count state machines", () => {
    expect(transferStateAllows("requested", "approve")).toBe(true);
    expect(transferStateAllows("draft", "dispatch")).toBe(false);
    expect(countStateAllows("counting", "submit")).toBe(true);
    expect(countStateAllows("submitted", "enter")).toBe(false);
  });

  it("derives partial and full receipt states", () => {
    expect(transferCompletionStatus(10, 4)).toBe("partially_received");
    expect(transferCompletionStatus(10, 10)).toBe("received");
  });
});
