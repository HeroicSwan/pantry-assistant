import { createHash } from "node:crypto";

export const STOP_COMMANDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
export const START_COMMANDS = new Set(["START", "UNSTOP"]);
export const HELP_COMMANDS = new Set(["HELP", "INFO"]);
export const CONFIRM_COMMANDS = new Set(["C", "CONFIRM", "YES", "Y"]);
export const CANCELLATION_INTENTS = new Set(["CANNOT ATTEND", "CAN'T ATTEND", "CANT ATTEND"]);

export type InboundIntent = "stop" | "start" | "help" | "confirm" | "cancellation_intent" | "unknown";

export function normalizeInboundText(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function parseInboundIntent(value: string): InboundIntent {
  const normalized = normalizeInboundText(value);
  if (STOP_COMMANDS.has(normalized)) return "stop";
  if (START_COMMANDS.has(normalized)) return "start";
  if (HELP_COMMANDS.has(normalized)) return "help";
  if (CONFIRM_COMMANDS.has(normalized)) return "confirm";
  if (CANCELLATION_INTENTS.has(normalized)) return "cancellation_intent";
  return "unknown";
}

export function normalizePhoneNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function maskPhoneNumber(value: string | null | undefined) {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return "Unavailable";
  return `${normalized.slice(0, Math.max(2, normalized.length - 7))}•••${normalized.slice(-4)}`;
}

export type RecipientEligibilityInput = {
  phoneNumber?: string | null;
  consentId?: string | null;
  consentStatus?: string | null;
  householdStatus?: string | null;
  contactActive?: boolean;
  contactArchived?: boolean;
  contactOrganizationId?: string | null;
  expectedOrganizationId: string;
  contactLocationId?: string | null;
  expectedLocationId?: string | null;
  duplicate?: boolean;
  appointmentStatus?: string | null;
  alreadySent?: boolean;
  quietHours?: boolean;
  preferredLanguage?: string | null;
};

export type RecipientExclusionReason =
  | "missing_number"
  | "invalid_number"
  | "no_consent"
  | "opted_out"
  | "revoked"
  | "household_archived"
  | "contact_archived"
  | "wrong_organization"
  | "wrong_location"
  | "duplicate_number"
  | "appointment_cancelled"
  | "message_already_sent"
  | "quiet_hours";

export type RecipientEligibility = {
  eligible: boolean;
  normalizedPhoneNumber: string | null;
  consentId: string | null;
  preferredLanguage: string;
  exclusionReason: RecipientExclusionReason | null;
  warning: string | null;
};

export function evaluateSmsRecipientEligibility(input: RecipientEligibilityInput): RecipientEligibility {
  const normalizedPhoneNumber = normalizePhoneNumber(input.phoneNumber);
  let exclusionReason: RecipientExclusionReason | null = null;
  if (!input.phoneNumber) exclusionReason = "missing_number";
  else if (!normalizedPhoneNumber) exclusionReason = "invalid_number";
  else if (input.contactOrganizationId && input.contactOrganizationId !== input.expectedOrganizationId) exclusionReason = "wrong_organization";
  else if (input.expectedLocationId && input.contactLocationId && input.contactLocationId !== input.expectedLocationId) exclusionReason = "wrong_location";
  else if (input.householdStatus && input.householdStatus !== "active") exclusionReason = "household_archived";
  else if (input.contactActive === false || input.contactArchived) exclusionReason = "contact_archived";
  else if (!input.consentId || !input.consentStatus || input.consentStatus === "unknown") exclusionReason = "no_consent";
  else if (input.consentStatus === "opted_out") exclusionReason = "opted_out";
  else if (input.consentStatus === "revoked") exclusionReason = "revoked";
  else if (input.consentStatus !== "consented") exclusionReason = "invalid_number";
  else if (input.appointmentStatus && ["cancelled", "completed", "no_show", "rescheduled"].includes(input.appointmentStatus)) exclusionReason = "appointment_cancelled";
  else if (input.alreadySent) exclusionReason = "message_already_sent";
  else if (input.duplicate) exclusionReason = "duplicate_number";
  else if (input.quietHours) exclusionReason = "quiet_hours";
  return {
    eligible: exclusionReason === null,
    normalizedPhoneNumber,
    consentId: input.consentId ?? null,
    preferredLanguage: input.preferredLanguage?.trim() || "en",
    exclusionReason,
    warning: normalizedPhoneNumber && input.phoneNumber !== normalizedPhoneNumber ? "Phone number was normalized to E.164." : null,
  };
}

export function deduplicateRecipients<T extends { phoneNumber: string | null | undefined }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.map((row) => {
    const phone = normalizePhoneNumber(row.phoneNumber);
    const duplicate = phone ? seen.has(phone) : false;
    if (phone && !duplicate) seen.add(phone);
    return { ...row, normalizedPhoneNumber: phone, duplicate };
  });
}

const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""),
);
const GSM_EXTENDED = new Set("^{}\\[~]|€".split(""));

export function calculateSmsSegments(body: string) {
  let gsmLength = 0;
  let isGsm = true;
  for (const character of body) {
    if (GSM_BASIC.has(character)) gsmLength += 1;
    else if (GSM_EXTENDED.has(character)) gsmLength += 2;
    else {
      isGsm = false;
      break;
    }
  }
  const encoding = isGsm ? "GSM-7" : "UCS-2";
  const units = isGsm ? gsmLength : body.length;
  const singleLimit = isGsm ? 160 : 70;
  const multipartLimit = isGsm ? 153 : 67;
  return {
    encoding,
    characters: body.length,
    segments: units === 0 ? 0 : units <= singleLimit ? 1 : Math.ceil(units / multipartLimit),
  };
}

export function renderMessageTemplate(template: string, variables: Record<string, string | number | null | undefined>) {
  const missing = new Set<string>();
  const used = new Set<string>();
  const body = template.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g, (_match, name: string) => {
    used.add(name);
    const value = variables[name];
    if (value === undefined || value === null || String(value).trim() === "") {
      missing.add(name);
      return `{{${name}}}`;
    }
    return String(value);
  });
  return { body, missingVariables: [...missing], usedVariables: [...used], ...calculateSmsSegments(body) };
}

function minutesFromClock(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function isWithinQuietHours(date: Date, start: string | null | undefined, end: string | null | undefined, timezone: string) {
  if (!start || !end) return false;
  const startMinutes = minutesFromClock(start);
  const endMinutes = minutesFromClock(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return false;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const current = hour * 60 + minute;
  return startMinutes < endMinutes ? current >= startMinutes && current < endMinutes : current >= startMinutes || current < endMinutes;
}

const STATUS_RANK: Record<string, number> = {
  draft: 0,
  scheduled: 1,
  queued: 2,
  accepted: 3,
  sending: 4,
  sent: 5,
  undelivered: 6,
  failed: 6,
  delivered: 7,
  cancelled: 7,
  excluded: 7,
};
const TERMINAL_STATUSES = new Set(["delivered", "undelivered", "failed", "cancelled", "excluded"]);

export function canAdvanceProviderStatus(current: string, incoming: string) {
  if (!(incoming in STATUS_RANK) || !(current in STATUS_RANK)) return false;
  if (current === incoming) return true;
  if (TERMINAL_STATUSES.has(current)) return false;
  return STATUS_RANK[incoming] >= STATUS_RANK[current];
}

const NON_RETRYABLE_PROVIDER_CODES = new Set(["21211", "21408", "21610", "21612", "21614", "21617", "21621", "21630"]);
const RETRYABLE_PROVIDER_CODES = new Set(["20429", "30001", "30002", "30003", "30005", "30006", "30008", "NETWORK_ERROR", "TIMEOUT", "RATE_LIMIT"]);

export function isRetryEligible(input: { status: string; attemptCount: number; retryLimit: number; providerErrorCode?: string | null; consentStatus?: string | null }) {
  if (!new Set(["failed", "undelivered"]).has(input.status)) return false;
  if (input.attemptCount >= input.retryLimit || input.consentStatus !== "consented") return false;
  if (input.providerErrorCode && NON_RETRYABLE_PROVIDER_CODES.has(input.providerErrorCode)) return false;
  return !input.providerErrorCode || RETRYABLE_PROVIDER_CODES.has(input.providerErrorCode);
}

export function retryDelaySeconds(attemptCount: number) {
  return Math.min(3600, 60 * 2 ** Math.max(0, attemptCount));
}

const CAMPAIGN_TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(["awaiting_approval", "cancelled"]),
  awaiting_approval: new Set(["approved", "draft", "cancelled"]),
  approved: new Set(["scheduled", "sending", "cancelled"]),
  scheduled: new Set(["sending", "cancelled"]),
  sending: new Set(["partially_sent", "sent", "failed", "cancelled"]),
  partially_sent: new Set(["sending", "sent", "failed", "cancelled"]),
  failed: new Set(["sending", "cancelled"]),
};

export function canTransitionCampaign(current: string, target: string) {
  return CAMPAIGN_TRANSITIONS[current]?.has(target) ?? false;
}

export function deterministicUuid(namespace: string) {
  const bytes = Buffer.from(createHash("sha256").update(namespace).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
