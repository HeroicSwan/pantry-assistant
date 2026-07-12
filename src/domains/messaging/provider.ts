import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { deterministicUuid, normalizePhoneNumber } from "@/domains/messaging/policy";

export type SendSmsInput = {
  to: string;
  body: string;
  from?: string | null;
  messagingServiceSid?: string | null;
  idempotencyKey: string;
};

export type SendSmsResult = {
  provider: "simulation" | "twilio";
  providerMessageId: string | null;
  status: "queued" | "accepted" | "sent" | "delivered" | "failed";
  errorCode?: string | null;
  errorMessage?: string | null;
  simulated: boolean;
};

export type SmsStatusEvent = {
  providerEventId: string;
  providerMessageId: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  payload: Record<string, string>;
};

export type InboundSmsEvent = {
  providerMessageId: string;
  from: string;
  to: string;
  body: string;
  payload: Record<string, string>;
};

export interface SmsProvider {
  sendMessage(input: SendSmsInput): Promise<SendSmsResult>;
  validateWebhook(request: Request): Promise<boolean>;
  parseStatusWebhook(request: Request): Promise<SmsStatusEvent>;
  parseInboundWebhook(request: Request): Promise<InboundSmsEvent>;
}

async function requestParameters(request: Request) {
  const form = await request.clone().formData();
  const entries = [...form.entries()].map(([key, value]) => [key, String(value)] as const);
  return { entries, values: Object.fromEntries(entries) };
}

export function externallyVisibleWebhookUrl(request: Request) {
  const configuredBase = process.env.TWILIO_WEBHOOK_BASE_URL?.trim();
  if (!configuredBase) return request.url;
  const incoming = new URL(request.url);
  const base = new URL(configuredBase);
  const basePath = base.pathname.replace(/\/$/, "");
  base.pathname = `${basePath}${incoming.pathname}`;
  base.search = incoming.search;
  base.hash = "";
  return base.toString();
}

export function createTwilioSignature(url: string, entries: ReadonlyArray<readonly [string, string]>, authToken: string) {
  const value = [...entries]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .reduce((result, [key, fieldValue]) => `${result}${key}${fieldValue}`, url);
  return createHmac("sha1", authToken).update(value, "utf8").digest("base64");
}

export async function validateTwilioWebhookRequest(request: Request, authToken = process.env.TWILIO_AUTH_TOKEN) {
  const provided = request.headers.get("x-twilio-signature");
  if (!authToken || !provided) return false;
  const { entries } = await requestParameters(request);
  const expected = createTwilioSignature(externallyVisibleWebhookUrl(request), entries, authToken);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeTwilioPayload(values: Record<string, string>) {
  const allowed = ["MessageSid", "SmsSid", "SmsStatus", "MessageStatus", "ErrorCode", "ErrorMessage", "From", "To", "Body", "NumMedia"];
  return Object.fromEntries(allowed.flatMap((key) => (values[key] === undefined ? [] : [[key, values[key]]])));
}

export class SimulationSmsProvider implements SmsProvider {
  async sendMessage(input: SendSmsInput): Promise<SendSmsResult> {
    const marker = input.body.match(/\[simulate:(queued|accepted|sent|delivered|failed)]/i)?.[1]?.toLowerCase();
    const failed = marker === "failed" || input.to.endsWith("0000");
    return {
      provider: "simulation",
      providerMessageId: `SIM${deterministicUuid(input.idempotencyKey).replace(/-/g, "").toUpperCase()}`,
      status: failed ? "failed" : (marker as SendSmsResult["status"] | undefined) ?? "delivered",
      errorCode: failed ? "SIMULATED_FAILURE" : null,
      errorMessage: failed ? "Deterministic simulation failure." : null,
      simulated: true,
    };
  }

  async validateWebhook() {
    return false;
  }

  async parseStatusWebhook(request: Request): Promise<SmsStatusEvent> {
    const { values } = await requestParameters(request);
    const providerMessageId = values.MessageSid ?? values.SmsSid ?? "";
    const status = (values.MessageStatus ?? values.SmsStatus ?? "").toLowerCase();
    return {
      providerEventId: deterministicUuid(`simulation-status:${providerMessageId}:${status}:${values.ErrorCode ?? ""}`),
      providerMessageId,
      status,
      errorCode: values.ErrorCode ?? null,
      errorMessage: values.ErrorMessage ?? null,
      payload: safeTwilioPayload(values),
    };
  }

  async parseInboundWebhook(request: Request): Promise<InboundSmsEvent> {
    const { values } = await requestParameters(request);
    return { providerMessageId: values.MessageSid ?? values.SmsSid ?? "", from: values.From ?? "", to: values.To ?? "", body: values.Body ?? "", payload: safeTwilioPayload(values) };
  }
}

export class TwilioSmsProvider implements SmsProvider {
  constructor(
    private readonly credentials = {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      from: process.env.TWILIO_PHONE_NUMBER,
    },
  ) {}

  async sendMessage(input: SendSmsInput): Promise<SendSmsResult> {
    const { accountSid, authToken } = this.credentials;
    if (!accountSid || !authToken) return { provider: "twilio", providerMessageId: null, status: "failed", errorCode: "CONFIGURATION_MISSING", errorMessage: "Twilio credentials are not configured.", simulated: false };
    const to = normalizePhoneNumber(input.to);
    if (!to) return { provider: "twilio", providerMessageId: null, status: "failed", errorCode: "INVALID_NUMBER", errorMessage: "The recipient number is invalid.", simulated: false };
    const form = new URLSearchParams({ To: to, Body: input.body });
    const serviceSid = input.messagingServiceSid ?? this.credentials.messagingServiceSid;
    const from = input.from ?? this.credentials.from;
    if (serviceSid) form.set("MessagingServiceSid", serviceSid);
    else if (from) form.set("From", from);
    else return { provider: "twilio", providerMessageId: null, status: "failed", errorCode: "SENDER_MISSING", errorMessage: "A Twilio sender is not configured.", simulated: false };
    try {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      const payload = (await response.json().catch(() => ({}))) as { sid?: string; status?: string; code?: number | string; message?: string };
      if (!response.ok) return { provider: "twilio", providerMessageId: payload.sid ?? null, status: "failed", errorCode: String(payload.code ?? response.status), errorMessage: payload.message ?? "Twilio rejected the message.", simulated: false };
      const status = ["queued", "accepted", "sent", "delivered"].includes(payload.status ?? "") ? (payload.status as SendSmsResult["status"]) : "accepted";
      return { provider: "twilio", providerMessageId: payload.sid ?? null, status, errorCode: null, errorMessage: null, simulated: false };
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return { provider: "twilio", providerMessageId: null, status: "failed", errorCode: timeout ? "TIMEOUT" : "NETWORK_ERROR", errorMessage: timeout ? "Twilio request timed out." : "Twilio could not be reached.", simulated: false };
    }
  }

  validateWebhook(request: Request) {
    return validateTwilioWebhookRequest(request, this.credentials.authToken);
  }

  async parseStatusWebhook(request: Request): Promise<SmsStatusEvent> {
    const { values } = await requestParameters(request);
    const providerMessageId = values.MessageSid ?? values.SmsSid ?? "";
    const status = (values.MessageStatus ?? values.SmsStatus ?? "").toLowerCase();
    return {
      providerEventId: values.EventSid ?? deterministicUuid(`twilio-status:${providerMessageId}:${status}:${values.ErrorCode ?? ""}`),
      providerMessageId,
      status,
      errorCode: values.ErrorCode ?? null,
      errorMessage: values.ErrorMessage ?? null,
      payload: safeTwilioPayload(values),
    };
  }

  async parseInboundWebhook(request: Request): Promise<InboundSmsEvent> {
    const { values } = await requestParameters(request);
    return { providerMessageId: values.MessageSid ?? values.SmsSid ?? "", from: values.From ?? "", to: values.To ?? "", body: values.Body ?? "", payload: safeTwilioPayload(values) };
  }
}

export function providerForMode(mode: string): SmsProvider {
  return mode === "live" || mode === "twilio_test" ? new TwilioSmsProvider() : new SimulationSmsProvider();
}
