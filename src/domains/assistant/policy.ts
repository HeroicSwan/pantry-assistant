import { createHash } from "node:crypto";
import type { PermissionKey } from "@/lib/auth/access";

// Full read-tool registry from docs/08-ai-assistant-design.md. Every tool returns minimized,
// permission-filtered, capped data -- never raw table access, never contact/sensitive fields.
export const READ_TOOL_NAMES = [
  "get_inventory_summary",
  "search_inventory_items",
  "get_inventory_item_details",
  "get_inventory_lot_history",
  "get_inventory_transaction_history",
  "get_shortage_forecast",
  "get_category_forecast",
  "get_expiring_inventory",
  "get_active_alerts",
  "get_upcoming_appointments",
  "get_pickup_counts",
  "get_household_pickup_status",
  "get_sms_delivery_summary",
  "get_recent_donations",
  "get_operational_metrics",
] as const;

// Stores a typed, reviewable preview. Creating a proposal never mutates domain state or sends
// anything. Confirming one always re-runs the ordinary, already-existing domain command with a
// fresh permission check -- the assistant is never itself the authorization boundary.
export const PROPOSAL_TOOL_NAMES = [
  "propose_alert_acknowledgement",
  "draft_sms_message",
  "draft_bulk_announcement",
  "create_inventory_adjustment_proposal",
  "create_reservation_proposal",
  "create_donation_needs_report",
  "create_pickup_reschedule_proposal",
] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
export type ProposalToolName = (typeof PROPOSAL_TOOL_NAMES)[number];
export type AssistantToolName = ReadToolName | ProposalToolName;

// Every proposal tool requires assistant.propose_actions plus this domain-specific permission.
export const PROPOSAL_TOOL_PERMISSIONS: Record<ProposalToolName, PermissionKey> = {
  propose_alert_acknowledgement: "alert.view",
  draft_sms_message: "assistant.draft_message",
  draft_bulk_announcement: "assistant.draft_message",
  create_inventory_adjustment_proposal: "inventory.adjust",
  create_reservation_proposal: "reservation.create",
  create_donation_needs_report: "donation.view",
  create_pickup_reschedule_proposal: "assistant.propose_reschedule",
};

// risk_level recorded on the stored proposal; confirmation requires the matching confirm.* permission.
export const PROPOSAL_RISK_LEVEL: Record<ProposalToolName, "low" | "medium" | "high"> = {
  propose_alert_acknowledgement: "low",
  draft_sms_message: "low",
  draft_bulk_announcement: "medium",
  create_inventory_adjustment_proposal: "medium",
  create_reservation_proposal: "medium",
  create_donation_needs_report: "low",
  create_pickup_reschedule_proposal: "medium",
};

// Domain permission independently re-checked at confirmation time, right before the real domain
// command runs. This is the single source of truth shared by the service layer and the UI so
// confirm buttons are never shown for a permission the confirm step would actually reject.
export const PROPOSAL_CONFIRM_PERMISSION: Record<ProposalToolName, PermissionKey> = {
  propose_alert_acknowledgement: "alert.acknowledge",
  draft_sms_message: "message.draft",
  draft_bulk_announcement: "message.draft",
  create_inventory_adjustment_proposal: "inventory.adjust",
  create_reservation_proposal: "reservation.create",
  create_donation_needs_report: "donation.view",
  create_pickup_reschedule_proposal: "assistant.propose_reschedule",
};

export function confirmGatePermission(actionType: ProposalToolName): PermissionKey {
  return PROPOSAL_RISK_LEVEL[actionType] === "high" ? "assistant.confirm_high_risk" : "assistant.confirm_low_risk";
}

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
        "I cannot perform that action directly. Inventory changes, reservations, reschedules, and messages go through a reviewable proposal, never a direct instruction.",
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

// Defense-in-depth: even a correctly scoped, permission-checked tool must never serialize one of
// these field names in its output. This is checked against every read-tool and proposal-preview
// payload before it can reach a message or the model.
const BANNED_OUTPUT_FIELDS = [
  "phone_number",
  "phonenumber",
  "email_address",
  "emailaddress",
  "operational_notes",
  "sensitive_notes",
  "sensitivenotes",
  "dietary",
  "allergen",
  "consent",
  "date_of_birth",
  "dateofbirth",
  "ssn",
  "password",
  "database_url",
  "auth_token",
  "api_key",
];

export function toolOutputIsMinimized(value: unknown): boolean {
  const serialized = JSON.stringify(value).toLowerCase();
  return !BANNED_OUTPUT_FIELDS.some((field) => serialized.includes(field));
}

// --- Ollama tool-calling schemas ------------------------------------------------------------
// OpenAI-compatible `tools` entries sent to the local model. These describe only the tool
// surface (name, description, JSON Schema for arguments) -- never database schema, credentials,
// or anything about how a tool is implemented server-side.

export type OllamaToolSchema = {
  type: "function";
  function: {
    name: AssistantToolName;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties: false;
    };
  };
};

const uuidProp = { type: "string", description: "A UUID." } as const;

export const TOOL_JSON_SCHEMAS: Record<AssistantToolName, OllamaToolSchema> = {
  get_inventory_summary: {
    type: "function",
    function: {
      name: "get_inventory_summary",
      description: "Aggregate canonical inventory balances for the active location.",
      parameters: { type: "object", properties: { categoryId: uuidProp }, additionalProperties: false },
    },
  },
  search_inventory_items: {
    type: "function",
    function: {
      name: "search_inventory_items",
      description: "Search the item catalog by name for the active location. Returns id, name, category, base unit, and on-hand summary only.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Search text, 1-80 characters." } }, required: ["query"], additionalProperties: false },
    },
  },
  get_inventory_item_details: {
    type: "function",
    function: {
      name: "get_inventory_item_details",
      description: "Detail for one inventory item by exact id: category, base unit, unit conversions, and balance summary at the active location.",
      parameters: { type: "object", properties: { itemId: uuidProp }, required: ["itemId"], additionalProperties: false },
    },
  },
  get_inventory_lot_history: {
    type: "function",
    function: {
      name: "get_inventory_lot_history",
      description: "Immutable ledger transaction history for one inventory lot by exact id.",
      parameters: { type: "object", properties: { lotId: uuidProp }, required: ["lotId"], additionalProperties: false },
    },
  },
  get_inventory_transaction_history: {
    type: "function",
    function: {
      name: "get_inventory_transaction_history",
      description: "Recent immutable ledger transactions for one item at the active location, most recent first.",
      parameters: { type: "object", properties: { itemId: uuidProp, days: { type: "integer", minimum: 1, maximum: 90, description: "Lookback window in days, default 14." } }, required: ["itemId"], additionalProperties: false },
    },
  },
  get_shortage_forecast: {
    type: "function",
    function: {
      name: "get_shortage_forecast",
      description: "Latest deterministic shortage forecast for the active location.",
      parameters: { type: "object", properties: { horizonDays: { type: "integer", minimum: 1, maximum: 90, description: "Forecast horizon in days, default 30." } }, additionalProperties: false },
    },
  },
  get_category_forecast: {
    type: "function",
    function: {
      name: "get_category_forecast",
      description: "Deterministic forecast rolled up by inventory category for the active location.",
      parameters: { type: "object", properties: { horizonDays: { type: "integer", minimum: 1, maximum: 90 } }, additionalProperties: false },
    },
  },
  get_expiring_inventory: {
    type: "function",
    function: {
      name: "get_expiring_inventory",
      description: "Lots expiring within the requested number of days at the active location.",
      parameters: { type: "object", properties: { withinDays: { type: "integer", minimum: 1, maximum: 90, description: "Default 7." } }, additionalProperties: false },
    },
  },
  get_active_alerts: {
    type: "function",
    function: {
      name: "get_active_alerts",
      description: "Currently open or acknowledged operational alerts for the active location.",
      parameters: { type: "object", properties: { severity: { type: "string", enum: ["info", "warning", "critical"] }, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    },
  },
  get_upcoming_appointments: {
    type: "function",
    function: {
      name: "get_upcoming_appointments",
      description: "Upcoming pickup appointments at the active location: time, household display name, status only. No contact information.",
      parameters: { type: "object", properties: { withinDays: { type: "integer", minimum: 1, maximum: 30, description: "Default 3." } }, additionalProperties: false },
    },
  },
  get_pickup_counts: {
    type: "function",
    function: {
      name: "get_pickup_counts",
      description: "Aggregate pickup counts by status for the active location over a date range. Fully aggregate, no household detail.",
      parameters: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 90, description: "Default 7." } }, additionalProperties: false },
    },
  },
  get_household_pickup_status: {
    type: "function",
    function: {
      name: "get_household_pickup_status",
      description: "Minimal pickup status for exactly one household, identified by its exact id. This is not a search tool -- an id is required.",
      parameters: { type: "object", properties: { householdId: uuidProp }, required: ["householdId"], additionalProperties: false },
    },
  },
  get_sms_delivery_summary: {
    type: "function",
    function: {
      name: "get_sms_delivery_summary",
      description: "Aggregate SMS delivery counts (sent, delivered, failed) for the active location. Never message bodies or phone numbers.",
      parameters: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 90, description: "Default 7." } }, additionalProperties: false },
    },
  },
  get_recent_donations: {
    type: "function",
    function: {
      name: "get_recent_donations",
      description: "Recent donation records at the active location: donor name, item, quantity, date. No donor contact information.",
      parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    },
  },
  get_operational_metrics: {
    type: "function",
    function: {
      name: "get_operational_metrics",
      description: "Dashboard-style aggregate operational metrics for the active location (today's pickups, active reservations, expiring counts, open alerts).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  propose_alert_acknowledgement: {
    type: "function",
    function: {
      name: "propose_alert_acknowledgement",
      description: "Create a reviewable, expiring proposal to acknowledge one open alert. Executes nothing by itself.",
      parameters: { type: "object", properties: { alertId: uuidProp, reason: { type: "string", minLength: 3, maxLength: 500 } }, required: ["alertId", "reason"], additionalProperties: false },
    },
  },
  draft_sms_message: {
    type: "function",
    function: {
      name: "draft_sms_message",
      description: "Store a draft individual SMS message body for staff review. Never sends anything.",
      parameters: { type: "object", properties: { body: { type: "string", minLength: 3, maxLength: 480 }, purpose: { type: "string", maxLength: 200 } }, required: ["body"], additionalProperties: false },
    },
  },
  draft_bulk_announcement: {
    type: "function",
    function: {
      name: "draft_bulk_announcement",
      description: "Store a draft bulk announcement as a message campaign in draft status. Never sends anything; staff must approve and send separately.",
      parameters: { type: "object", properties: { name: { type: "string", minLength: 2, maxLength: 120 }, body: { type: "string", minLength: 3, maxLength: 480 } }, required: ["name", "body"], additionalProperties: false },
    },
  },
  create_inventory_adjustment_proposal: {
    type: "function",
    function: {
      name: "create_inventory_adjustment_proposal",
      description: "Propose a manual inventory adjustment for one lot, in that lot's base unit. Creates only a reviewable proposal; posting the ledger entry requires separate confirmation.",
      parameters: { type: "object", properties: { lotId: uuidProp, direction: { type: "string", enum: ["positive", "negative"] }, quantity: { type: "string", description: "Positive decimal quantity in the item's base unit, as a string." }, reasonCode: { type: "string" }, reason: { type: "string", minLength: 3, maxLength: 280 } }, required: ["lotId", "direction", "quantity", "reasonCode", "reason"], additionalProperties: false },
    },
  },
  create_reservation_proposal: {
    type: "function",
    function: {
      name: "create_reservation_proposal",
      description: "Propose reserving inventory for one existing appointment's allocation. Creates only a reviewable proposal.",
      parameters: { type: "object", properties: { appointmentId: uuidProp }, required: ["appointmentId"], additionalProperties: false },
    },
  },
  create_donation_needs_report: {
    type: "function",
    function: {
      name: "create_donation_needs_report",
      description: "Generate a read-only donation-needs report from current shortage forecast data. No domain state changes.",
      parameters: { type: "object", properties: { horizonDays: { type: "integer", minimum: 1, maximum: 90 } }, additionalProperties: false },
    },
  },
  create_pickup_reschedule_proposal: {
    type: "function",
    function: {
      name: "create_pickup_reschedule_proposal",
      description: "Propose rescheduling one appointment to a new start/end time. Creates only a reviewable proposal.",
      parameters: { type: "object", properties: { appointmentId: uuidProp, scheduledStartAt: { type: "string", description: "ISO 8601 datetime." }, scheduledEndAt: { type: "string", description: "ISO 8601 datetime." } }, required: ["appointmentId", "scheduledStartAt", "scheduledEndAt"], additionalProperties: false },
    },
  },
};
