import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { deterministicUuid, normalizePhoneNumber } from "@/domains/messaging/policy";

export const SMS_PROVIDER_IDS = ["twilio", "vonage", "plivo", "telnyx", "sinch", "infobip", "bandwidth", "bird", "aws_sns", "azure_communication_services"] as const;
export type SmsProviderId = (typeof SMS_PROVIDER_IDS)[number];

export type SendSmsInput = {
  to: string;
  body: string;
  from?: string | null;
  messagingServiceSid?: string | null;
  idempotencyKey: string;
};

export type SendSmsResult = {
  provider: "simulation" | SmsProviderId;
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

export function validateGenericWebhookRequest(request: Request, secret = process.env.SMS_WEBHOOK_SECRET) {
  const provided = request.headers.get("x-pantry-webhook-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !provided) return false;
  const left = Buffer.from(provided); const right = Buffer.from(secret);
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

function failed(provider: SmsProviderId, errorCode: string, errorMessage: string): SendSmsResult {
  return { provider, providerMessageId: null, status: "failed", errorCode, errorMessage, simulated: false };
}

function accepted(provider: SmsProviderId, providerMessageId: string | null, status: SendSmsResult["status"] = "accepted"): SendSmsResult {
  return { provider, providerMessageId, status, errorCode: null, errorMessage: null, simulated: false };
}

async function jsonResponse(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

async function fetchProvider(provider: SmsProviderId, url: string, init: RequestInit, messageField: (payload: Record<string, unknown>) => string | null, statusField?: (payload: Record<string, unknown>) => SendSmsResult["status"]) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    const payload = await jsonResponse(response);
    if (!response.ok) return failed(provider, String(payload.code ?? payload.errorCode ?? response.status), String(payload.message ?? payload.error ?? "Provider rejected the message."));
    return accepted(provider, messageField(payload), statusField?.(payload) ?? "accepted");
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return failed(provider, timeout ? "TIMEOUT" : "NETWORK_ERROR", timeout ? "SMS provider request timed out." : "SMS provider could not be reached.");
  }
}

function requireSender(input: SendSmsInput, provider: SmsProviderId) {
  const sender = input.from?.trim();
  return sender ? sender : failed(provider, "SENDER_MISSING", "A sender is required for this SMS provider.");
}

class VonageSmsProvider implements SmsProvider {
  async sendMessage(input: SendSmsInput) {
    const apiKey = process.env.VONAGE_API_KEY; const apiSecret = process.env.VONAGE_API_SECRET; const sender = requireSender(input, "vonage");
    if (!apiKey || !apiSecret) return failed("vonage", "CONFIGURATION_MISSING", "Vonage credentials are not configured.");
    if (typeof sender !== "string") return sender;
    const form = new URLSearchParams({ api_key: apiKey, api_secret: apiSecret, from: sender, to: normalizePhoneNumber(input.to) ?? input.to, text: input.body });
    return fetchProvider("vonage", "https://rest.nexmo.com/sms/json", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form }, (payload) => String((payload.messages as Array<Record<string, unknown>> | undefined)?.[0]?.["message-id"] ?? null), (payload) => String((payload.messages as Array<Record<string, unknown>> | undefined)?.[0]?.status ?? "0") === "0" ? "accepted" : "failed");
  }
  validateWebhook() { return Promise.resolve(false); }
  async parseStatusWebhook(request: Request) { return parseGenericStatus(request, "vonage"); }
  async parseInboundWebhook(request: Request) { return parseGenericInbound(request); }
}

class PlivoSmsProvider implements SmsProvider {
  async sendMessage(input: SendSmsInput) {
    const authId = process.env.PLIVO_AUTH_ID; const authToken = process.env.PLIVO_AUTH_TOKEN; const sender = requireSender(input, "plivo");
    if (!authId || !authToken) return failed("plivo", "CONFIGURATION_MISSING", "Plivo credentials are not configured.");
    if (typeof sender !== "string") return sender;
    return fetchProvider("plivo", "https://api.plivo.com/v1/Account/" + encodeURIComponent(authId) + "/Message/", { method: "POST", headers: { authorization: "Basic " + Buffer.from(authId + ":" + authToken).toString("base64"), "content-type": "application/json" }, body: JSON.stringify({ src: sender, dst: normalizePhoneNumber(input.to) ?? input.to, text: input.body }) }, (payload) => String((payload.message_uuid as string[] | undefined)?.[0] ?? (payload.message as string | undefined) ?? null));
  }
  validateWebhook() { return Promise.resolve(false); }
  async parseStatusWebhook(request: Request) { return parseGenericStatus(request, "plivo"); }
  async parseInboundWebhook(request: Request) { return parseGenericInbound(request); }
}

class TelnyxSmsProvider implements SmsProvider {
  async sendMessage(input: SendSmsInput) {
    const apiKey = process.env.TELNYX_API_KEY; const profile = process.env.TELNYX_MESSAGING_PROFILE_ID; const sender = requireSender(input, "telnyx");
    if (!apiKey || !profile) return failed("telnyx", "CONFIGURATION_MISSING", "Telnyx credentials are not configured.");
    if (typeof sender !== "string") return sender;
    return fetchProvider("telnyx", "https://api.telnyx.com/v2/messages", { method: "POST", headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" }, body: JSON.stringify({ from: sender, to: normalizePhoneNumber(input.to) ?? input.to, text: input.body, messaging_profile_id: profile }) }, (payload) => String((payload.data as Record<string, unknown> | undefined)?.id ?? null));
  }
  validateWebhook() { return Promise.resolve(false); }
  async parseStatusWebhook(request: Request) { return parseGenericStatus(request, "telnyx"); }
  async parseInboundWebhook(request: Request) { return parseGenericInbound(request); }
}

class SinchSmsProvider implements SmsProvider {
  async sendMessage(input: SendSmsInput) {
    const plan = process.env.SINCH_SERVICE_PLAN_ID; const token = process.env.SINCH_API_TOKEN; const sender = requireSender(input, "sinch");
    if (!plan || !token) return failed("sinch", "CONFIGURATION_MISSING", "Sinch credentials are not configured.");
    if (typeof sender !== "string") return sender;
    return fetchProvider("sinch", "https://us.sms.api.sinch.com/xms/v1/" + encodeURIComponent(plan) + "/batches", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ from: sender, to: [normalizePhoneNumber(input.to) ?? input.to], body: input.body }) }, (payload) => String(payload.id ?? null));
  }
  validateWebhook() { return Promise.resolve(false); }
  async parseStatusWebhook(request: Request) { return parseGenericStatus(request, "sinch"); }
  async parseInboundWebhook(request: Request) { return parseGenericInbound(request); }
}

class InfobipSmsProvider implements SmsProvider {
  async sendMessage(input: SendSmsInput) {
    const base = process.env.INFOBIP_BASE_URL; const apiKey = process.env.INFOBIP_API_KEY; const sender = requireSender(input, "infobip");
    if (!base || !apiKey) return failed("infobip", "CONFIGURATION_MISSING", "Infobip credentials are not configured.");
    if (typeof sender !== "string") return sender;
    return fetchProvider("infobip", base.replace(/\/$/, "") + "/sms/2/text/advanced", { method: "POST", headers: { authorization: "App " + apiKey, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ from: sender, destinations: [{ to: normalizePhoneNumber(input.to) ?? input.to }], text: input.body }] }) }, (payload) => String(((payload.messages as Array<Record<string, unknown>> | undefined)?.[0]?.messageId as string | undefined) ?? null));
  }
  validateWebhook() { return Promise.resolve(false); }
  async parseStatusWebhook(request: Request) { return parseGenericStatus(request, "infobip"); }
  async parseInboundWebhook(request: Request) { return parseGenericInbound(request); }
}

class BandwidthSmsProvider implements SmsProvider {
  async sendMessage(input: SendSmsInput) {
    const token = process.env.BANDWIDTH_API_TOKEN; const secret = process.env.BANDWIDTH_API_SECRET; const applicationId = process.env.BANDWIDTH_APPLICATION_ID; const sender = requireSender(input, "bandwidth");
    if (!token || !secret || !applicationId) return failed("bandwidth", "CONFIGURATION_MISSING", "Bandwidth credentials are not configured.");
    if (typeof sender !== "string") return sender;
    return fetchProvider("bandwidth", "https://messaging.bandwidth.com/api/v2/messages", { method: "POST", headers: { authorization: "Basic " + Buffer.from(token + ":" + secret).toString("base64"), "content-type": "application/json" }, body: JSON.stringify({ from: sender, to: [normalizePhoneNumber(input.to) ?? input.to], text: input.body, applicationId }) }, (payload) => String(payload.id ?? null));
  }
  validateWebhook() { return Promise.resolve(false); }
  async parseStatusWebhook(request: Request) { return parseGenericStatus(request, "bandwidth"); }
  async parseInboundWebhook(request: Request) { return parseGenericInbound(request); }
}

class BirdSmsProvider implements SmsProvider {
  async sendMessage(input: SendSmsInput) {
    const accessKey = process.env.BIRD_ACCESS_KEY; const workspaceId = process.env.BIRD_WORKSPACE_ID; const channelId = process.env.BIRD_CHANNEL_ID;
    if (!accessKey || !workspaceId || !channelId) return failed("bird", "CONFIGURATION_MISSING", "Bird credentials are not configured.");
    return fetchProvider("bird", "https://api.bird.com/workspaces/" + encodeURIComponent(workspaceId) + "/channels/" + encodeURIComponent(channelId) + "/messages", { method: "POST", headers: { authorization: "AccessKey " + accessKey, "content-type": "application/json" }, body: JSON.stringify({ receiver: { contacts: [{ identifier: normalizePhoneNumber(input.to) ?? input.to }] }, body: { type: "text", text: { text: input.body } } }) }, (payload) => String(payload.id ?? null));
  }
  validateWebhook() { return Promise.resolve(false); }
  async parseStatusWebhook(request: Request) { return parseGenericStatus(request, "bird"); }
  async parseInboundWebhook(request: Request) { return parseGenericInbound(request); }
}

class AwsSnsSmsProvider implements SmsProvider {
  async sendMessage(input: SendSmsInput) {
    const region = process.env.AWS_REGION; const accessKeyId = process.env.AWS_ACCESS_KEY_ID; const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!region || !accessKeyId || !secretAccessKey) return failed("aws_sns", "CONFIGURATION_MISSING", "AWS SNS credentials are not configured.");
    try {
      const client = new SNSClient({ region, credentials: { accessKeyId, secretAccessKey } });
      const result = await client.send(new PublishCommand({ PhoneNumber: normalizePhoneNumber(input.to) ?? input.to, Message: input.body, MessageAttributes: process.env.AWS_SNS_SENDER_ID ? { "AWS.SNS.SMS.SenderID": { DataType: "String", StringValue: process.env.AWS_SNS_SENDER_ID } } : undefined }));
      return accepted("aws_sns", result.MessageId ?? null);
    } catch (error) { return failed("aws_sns", "PROVIDER_ERROR", error instanceof Error ? error.message : "AWS SNS rejected the message."); }
  }
  validateWebhook() { return Promise.resolve(false); }
  async parseStatusWebhook(request: Request) { return parseGenericStatus(request, "aws_sns"); }
  async parseInboundWebhook(request: Request) { return parseGenericInbound(request); }
}

class AzureCommunicationSmsProvider implements SmsProvider {
  async sendMessage(input: SendSmsInput) {
    const connection = process.env.AZURE_COMMUNICATION_CONNECTION_STRING; const sender = requireSender(input, "azure_communication_services");
    if (!connection) return failed("azure_communication_services", "CONFIGURATION_MISSING", "Azure Communication Services credentials are not configured.");
    if (typeof sender !== "string") return sender;
    const endpoint = connection.match(/endpoint=([^;]+)/i)?.[1]; const accessKey = connection.match(/accesskey=([^;]+)/i)?.[1];
    if (!endpoint || !accessKey) return failed("azure_communication_services", "CONFIGURATION_INVALID", "Azure Communication Services connection string is invalid.");
    const url = new URL(endpoint.replace(/\/$/, "") + "/sms?api-version=2026-01-23"); const body = JSON.stringify({ from: sender, smsRecipients: [{ to: normalizePhoneNumber(input.to) ?? input.to }], message: input.body }); const date = new Date().toUTCString(); const contentHash = createHash("sha256").update(body).digest("base64"); const host = url.host; const signed = "POST\n" + url.pathname + url.search + "\n" + date + ";" + host + ";x-ms-content-sha256:" + contentHash; const signature = createHmac("sha256", Buffer.from(accessKey, "base64")).update(signed).digest("base64");
    return fetchProvider("azure_communication_services", url.toString(), { method: "POST", headers: { "content-type": "application/json", "x-ms-date": date, "x-ms-content-sha256": contentHash, host, authorization: "HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=" + signature }, body }, (payload) => String(payload.id ?? null));
  }
  validateWebhook() { return Promise.resolve(false); }
  async parseStatusWebhook(request: Request) { return parseGenericStatus(request, "azure_communication_services"); }
  async parseInboundWebhook(request: Request) { return parseGenericInbound(request); }
}

async function parseGenericJson(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const { values } = await requestParameters(request);
  return values;
}

async function parseGenericStatus(request: Request, provider: SmsProviderId): Promise<SmsStatusEvent> {
  const values = await parseGenericJson(request); const providerMessageId = String(values.messageId ?? values.id ?? values.MessageSid ?? values.message_id ?? ""); const status = String(values.status ?? values.messageStatus ?? values.MessageStatus ?? "").toLowerCase();
  return { providerEventId: String(values.eventId ?? values.event_id ?? deterministicUuid(provider + ":" + providerMessageId + ":" + status)), providerMessageId, status, errorCode: values.errorCode ? String(values.errorCode) : null, errorMessage: values.errorMessage ? String(values.errorMessage) : null, payload: Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string").slice(0, 30).map(([key, value]) => [key, String(value)])) };
}

async function parseGenericInbound(request: Request): Promise<InboundSmsEvent> {
  const values = await parseGenericJson(request); return { providerMessageId: String(values.messageId ?? values.id ?? values.MessageSid ?? ""), from: String(values.from ?? values.source ?? values.From ?? ""), to: String(values.to ?? values.destination ?? values.To ?? ""), body: String(values.body ?? values.text ?? values.message ?? values.Body ?? ""), payload: Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string").slice(0, 30).map(([key, value]) => [key, String(value)])) };
}

export function providerHasCredentials(provider: SmsProviderId) {
  switch (provider) {
    case "twilio": return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    case "vonage": return Boolean(process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET);
    case "plivo": return Boolean(process.env.PLIVO_AUTH_ID && process.env.PLIVO_AUTH_TOKEN);
    case "telnyx": return Boolean(process.env.TELNYX_API_KEY && process.env.TELNYX_MESSAGING_PROFILE_ID);
    case "sinch": return Boolean(process.env.SINCH_SERVICE_PLAN_ID && process.env.SINCH_API_TOKEN);
    case "infobip": return Boolean(process.env.INFOBIP_BASE_URL && process.env.INFOBIP_API_KEY);
    case "bandwidth": return Boolean(process.env.BANDWIDTH_API_TOKEN && process.env.BANDWIDTH_API_SECRET && process.env.BANDWIDTH_APPLICATION_ID);
    case "bird": return Boolean(process.env.BIRD_ACCESS_KEY && process.env.BIRD_WORKSPACE_ID && process.env.BIRD_CHANNEL_ID);
    case "aws_sns": return Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    case "azure_communication_services": return Boolean(process.env.AZURE_COMMUNICATION_CONNECTION_STRING);
  }
}

export function providerForMode(mode: string, provider = "twilio"): SmsProvider {
  if (mode !== "live") return new SimulationSmsProvider();
  switch (provider as SmsProviderId) {
    case "vonage": return new VonageSmsProvider();
    case "plivo": return new PlivoSmsProvider();
    case "telnyx": return new TelnyxSmsProvider();
    case "sinch": return new SinchSmsProvider();
    case "infobip": return new InfobipSmsProvider();
    case "bandwidth": return new BandwidthSmsProvider();
    case "bird": return new BirdSmsProvider();
    case "aws_sns": return new AwsSnsSmsProvider();
    case "azure_communication_services": return new AzureCommunicationSmsProvider();
    case "twilio": default: return new TwilioSmsProvider();
  }
}
