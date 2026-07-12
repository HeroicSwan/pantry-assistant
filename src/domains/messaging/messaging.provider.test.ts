import { describe, expect, it } from "vitest";
import { createTwilioSignature, SimulationSmsProvider, validateTwilioWebhookRequest } from "@/domains/messaging/provider";

describe("SMS providers", () => {
  it("never contacts a real provider in simulation mode", async () => {
    const provider = new SimulationSmsProvider();
    const result = await provider.sendMessage({ to: "+12025550142", body: "Reminder", idempotencyKey: "one" });
    expect(result).toMatchObject({ provider: "simulation", status: "delivered", simulated: true });
  });

  it("supports deterministic simulated failures", async () => {
    const provider = new SimulationSmsProvider();
    const result = await provider.sendMessage({ to: "+12025550000", body: "Reminder", idempotencyKey: "two" });
    expect(result).toMatchObject({ status: "failed", errorCode: "SIMULATED_FAILURE" });
  });

  it("validates Twilio form signatures against the exact URL", async () => {
    const url = "https://pantry.example.test/api/webhooks/twilio/inbound";
    const body = new URLSearchParams({ From: "+12025550142", To: "+12025550199", Body: "STOP", MessageSid: "SM123" });
    const entries = [...body.entries()] as Array<[string, string]>;
    const signature = createTwilioSignature(url, entries, "test-token");
    const request = new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature }, body });
    expect(await validateTwilioWebhookRequest(request, "test-token")).toBe(true);
  });

  it("rejects invalid webhook signatures", async () => {
    const request = new Request("https://pantry.example.test/api/webhooks/twilio/status", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "bad" }, body: "MessageSid=SM123&MessageStatus=sent" });
    expect(await validateTwilioWebhookRequest(request, "test-token")).toBe(false);
  });
});
