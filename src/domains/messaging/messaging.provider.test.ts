import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTwilioSignature,
  genericWebhookSecretFor,
  providerForMode,
  SMS_PROVIDER_IDS,
  SimulationSmsProvider,
  validateTwilioWebhookRequest,
} from "@/domains/messaging/provider";

afterEach(() => vi.unstubAllEnvs());

describe("SMS providers", () => {
  it("never contacts a real provider in simulation mode", async () => {
    const provider = new SimulationSmsProvider();
    const result = await provider.sendMessage({
      to: "+12025550142",
      body: "Reminder",
      idempotencyKey: "one",
    });
    expect(result).toMatchObject({
      provider: "simulation",
      status: "delivered",
      simulated: true,
    });
  });

  it("supports deterministic simulated failures", async () => {
    const provider = new SimulationSmsProvider();
    const result = await provider.sendMessage({
      to: "+12025550000",
      body: "Reminder",
      idempotencyKey: "two",
    });
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "SIMULATED_FAILURE",
    });
  });

  it("validates Twilio form signatures against the exact URL", async () => {
    const url = "https://pantry.example.test/api/webhooks/twilio/inbound";
    const body = new URLSearchParams({
      From: "+12025550142",
      To: "+12025550199",
      Body: "STOP",
      MessageSid: "SM123",
    });
    const entries = [...body.entries()] as Array<[string, string]>;
    const signature = createTwilioSignature(url, entries, "test-token");
    const request = new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      body,
    });
    expect(await validateTwilioWebhookRequest(request, "test-token")).toBe(
      true,
    );
  });

  it("rejects invalid webhook signatures", async () => {
    const request = new Request(
      "https://pantry.example.test/api/webhooks/twilio/status",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": "bad",
        },
        body: "MessageSid=SM123&MessageStatus=sent",
      },
    );
    expect(await validateTwilioWebhookRequest(request, "test-token")).toBe(
      false,
    );
  });

  it("registers ten provider adapters that fail safely when credentials are absent", async () => {
    for (const name of [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "VONAGE_API_KEY",
      "VONAGE_API_SECRET",
      "PLIVO_AUTH_ID",
      "PLIVO_AUTH_TOKEN",
      "TELNYX_API_KEY",
      "TELNYX_MESSAGING_PROFILE_ID",
      "SINCH_SERVICE_PLAN_ID",
      "SINCH_API_TOKEN",
      "INFOBIP_BASE_URL",
      "INFOBIP_API_KEY",
      "BANDWIDTH_API_TOKEN",
      "BANDWIDTH_API_SECRET",
      "BANDWIDTH_APPLICATION_ID",
      "BIRD_ACCESS_KEY",
      "BIRD_WORKSPACE_ID",
      "BIRD_CHANNEL_ID",
      "AWS_REGION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AZURE_COMMUNICATION_CONNECTION_STRING",
    ])
      vi.stubEnv(name, "");
    expect(SMS_PROVIDER_IDS).toHaveLength(10);
    for (const provider of SMS_PROVIDER_IDS) {
      const result = await providerForMode("live", provider).sendMessage({
        to: "+12025550142",
        body: "test",
        from: "+12025550199",
        idempotencyKey: provider,
      });
      expect(result).toMatchObject({
        provider,
        status: "failed",
        errorCode: "CONFIGURATION_MISSING",
      });
    }
  });

  it("uses a distinct generic webhook secret for each non-Twilio provider", () => {
    vi.stubEnv("SMS_WEBHOOK_SECRET_VONAGE", "vonage-secret");
    vi.stubEnv("SMS_WEBHOOK_SECRET", "legacy-shared-secret");
    expect(genericWebhookSecretFor("vonage")).toBe("vonage-secret");
    expect(genericWebhookSecretFor("plivo")).toBeUndefined();
  });
});
