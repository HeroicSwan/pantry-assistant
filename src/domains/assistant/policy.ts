import { createHash } from "node:crypto";

export const READ_TOOL_NAMES = [
  "get_inventory_summary",
  "get_shortage_forecast",
  "get_active_alerts",
] as const;

export const PROPOSAL_TOOL_NAMES = ["propose_alert_acknowledgement"] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
export type ProposalToolName = (typeof PROPOSAL_TOOL_NAMES)[number];
export type AssistantToolName = ReadToolName | ProposalToolName;

const injectionSignals = [
  /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous\s+|prior\s+|system\s+)?(?:rules|instructions|prompts?)/i,
  /reveal (the )?(system|developer|hidden) (prompt|instructions?)/i,
  /(?:run|execute) (?:arbitrary )?(?:sql|shell|code)/i,
  /(?:list|export|show|send).*\b(?:phone|email|contact|password|secret)/i,
  /(?:another|other) organi[sz]ation/i,
  /bypass (?:permission|consent|authorization|approval)/i,
];

const prohibitedActionSignals = [
  /\b(?:send|text|message)\b.*\b(?:household|everyone|all|bulk)\b/i,
  /\b(?:delete|merge|archive)\b.*\bhousehold/i,
  /\b(?:change|grant|remove)\b.*\b(?:role|permission)\b/i,
  /\b(?:adjust|remove|add|transfer)\b.*\b(?:inventory|stock)\b/i,
];

export type PromptSafetyAssessment = {
  safe: boolean;
  code:
    "allowed" | "prompt_injection" | "unsupported_action" | "sensitive_data";
  message?: string;
};

export function assessPromptSafety(prompt: string): PromptSafetyAssessment {
  if (injectionSignals.some((signal) => signal.test(prompt))) {
    return {
      safe: false,
      code: "prompt_injection",
      message:
        "I cannot follow instructions that request hidden policy, unrestricted data, or authorization bypasses.",
    };
  }
  if (prohibitedActionSignals.some((signal) => signal.test(prompt))) {
    return {
      safe: false,
      code: "unsupported_action",
      message:
        "I cannot perform that action. Inventory changes and messages require their normal reviewed workflows.",
    };
  }
  if (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(prompt) ||
    /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(prompt)
  ) {
    return {
      safe: false,
      code: "sensitive_data",
      message:
        "Remove phone numbers and email addresses before asking an operational question.",
    };
  }
  return { safe: true, code: "allowed" };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function stableFingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function proposalExpiresAt(now = new Date(), minutes = 15) {
  return new Date(now.getTime() + minutes * 60_000);
}

export function isProposalExpired(expiresAt: Date | string, now = new Date()) {
  return new Date(expiresAt).getTime() <= now.getTime();
}

export function maskIdentifier(value: string) {
  return value.length <= 8 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function toolOutputIsMinimized(value: unknown): boolean {
  const serialized = JSON.stringify(value).toLowerCase();
  return ![
    "phone_number",
    "email_address",
    "operational_notes",
    "dietary",
    "password",
    "database_url",
    "auth_token",
  ].some((field) => serialized.includes(field));
}
