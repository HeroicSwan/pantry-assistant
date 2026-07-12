import { describe, expect, it } from "vitest";
import {
  calculateSmsSegments,
  canAdvanceProviderStatus,
  canTransitionCampaign,
  deduplicateRecipients,
  deterministicUuid,
  evaluateSmsRecipientEligibility,
  isRetryEligible,
  isWithinQuietHours,
  normalizePhoneNumber,
  parseInboundIntent,
  renderMessageTemplate,
} from "@/domains/messaging/policy";

describe("messaging policy", () => {
  it("normalizes US phone numbers and rejects ambiguous values", () => {
    expect(normalizePhoneNumber("(202) 555-0142")).toBe("+12025550142");
    expect(normalizePhoneNumber("123")).toBeNull();
  });

  it("requires current consent and enforces opt-out before sending", () => {
    const base = { phoneNumber: "+12025550142", consentId: "consent", householdStatus: "active", contactActive: true, contactOrganizationId: "org", expectedOrganizationId: "org" };
    expect(evaluateSmsRecipientEligibility({ ...base, consentStatus: "consented" }).eligible).toBe(true);
    expect(evaluateSmsRecipientEligibility({ ...base, consentStatus: "opted_out" }).exclusionReason).toBe("opted_out");
  });

  it("deduplicates normalized recipient numbers", () => {
    const rows = deduplicateRecipients([{ phoneNumber: "202-555-0142" }, { phoneNumber: "+1 202 555 0142" }]);
    expect(rows.map((row) => row.duplicate)).toEqual([false, true]);
  });

  it("renders declared placeholders and reports missing values", () => {
    const rendered = renderMessageTemplate("Hello {{name}}. Pickup: {{time}}", { name: "Harbor family" });
    expect(rendered.body).toContain("Harbor family");
    expect(rendered.missingVariables).toEqual(["time"]);
  });

  it("calculates GSM and Unicode message segments", () => {
    expect(calculateSmsSegments("A".repeat(161)).segments).toBe(2);
    expect(calculateSmsSegments("🙂".repeat(36))).toMatchObject({ encoding: "UCS-2", segments: 2 });
  });

  it("recognizes compliance commands before appointment language", () => {
    expect(parseInboundIntent(" cancel ")).toBe("stop");
    expect(parseInboundIntent("yes")).toBe("confirm");
    expect(parseInboundIntent("cannot attend")).toBe("cancellation_intent");
  });

  it("handles quiet hours that cross midnight", () => {
    expect(isWithinQuietHours(new Date("2026-01-01T04:00:00Z"), "22:00", "07:00", "America/New_York")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T18:00:00Z"), "22:00", "07:00", "America/New_York")).toBe(false);
  });

  it("does not downgrade terminal delivery states", () => {
    expect(canAdvanceProviderStatus("sent", "delivered")).toBe(true);
    expect(canAdvanceProviderStatus("delivered", "sent")).toBe(false);
    expect(canAdvanceProviderStatus("failed", "delivered")).toBe(false);
  });

  it("bounds retries and refuses opted-out or permanent failures", () => {
    expect(isRetryEligible({ status: "failed", attemptCount: 1, retryLimit: 3, providerErrorCode: "TIMEOUT", consentStatus: "consented" })).toBe(true);
    expect(isRetryEligible({ status: "failed", attemptCount: 1, retryLimit: 3, providerErrorCode: "21610", consentStatus: "consented" })).toBe(false);
    expect(isRetryEligible({ status: "failed", attemptCount: 1, retryLimit: 3, providerErrorCode: "TIMEOUT", consentStatus: "opted_out" })).toBe(false);
  });

  it("enforces campaign approval transitions", () => {
    expect(canTransitionCampaign("draft", "awaiting_approval")).toBe(true);
    expect(canTransitionCampaign("draft", "sending")).toBe(false);
  });

  it("creates stable UUID idempotency keys", () => {
    expect(deterministicUuid("campaign:phone")).toBe(deterministicUuid("campaign:phone"));
    expect(deterministicUuid("campaign:phone")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
