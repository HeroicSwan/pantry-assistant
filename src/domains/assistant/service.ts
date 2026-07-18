import "server-only";

import { sql } from "drizzle-orm";
import { getAssistantProvider } from "@/domains/assistant/provider";
import {
  PROPOSAL_CONFIRM_PERMISSION,
  PROPOSAL_RISK_LEVEL,
  PROPOSAL_TOOL_PERMISSIONS,
  READ_TOOL_NAMES,
  confirmGatePermission,
  isProposalExpired,
  proposalExpiresAt,
  stableFingerprint,
  toolOutputIsMinimized,
  type ProposalToolName,
  type ReadToolName,
} from "@/domains/assistant/policy";
import {
  acknowledgeAlertProposalInputSchema,
  assistantPromptSchema,
  conversationTitleSchema,
  donationNeedsReportInputSchema,
  draftBulkAnnouncementInputSchema,
  draftSmsMessageInputSchema,
  inventoryAdjustmentProposalInputSchema,
  pickupRescheduleProposalInputSchema,
  proposalIdSchema,
  reservationProposalInputSchema,
  type AcknowledgeAlertProposalInput,
  type DonationNeedsReportInput,
  type DraftBulkAnnouncementInput,
  type DraftSmsMessageInput,
  type InventoryAdjustmentProposalInput,
  type PickupRescheduleProposalInput,
  type ReservationProposalInput,
} from "@/domains/assistant/schemas";
import {
  ASSISTANT_TOOL_REGISTRY,
  executeReadTool,
  type AssistantToolContext,
  type ToolResultEnvelope,
} from "@/domains/assistant/tools";
import { transitionAlert } from "@/domains/forecasting/service";
import { latestDonationNeeds } from "@/domains/forecasting/queries";
import { recordAdjustment } from "@/domains/inventory/service";
import { createMessageCampaign } from "@/domains/messaging/service";
import { createReservation, rescheduleAppointment } from "@/domains/pickups/service";
import { db, pool } from "@/lib/database/client";
import { hasLocationPermission } from "@/lib/database/authorization";
import { DomainError } from "@/lib/errors";

type Scope = {
  actorId: string;
  organizationId: string;
  locationId: string;
  requestId: string;
};

type AlertState = { id: string; status: string; updated_at: string };

async function requireScope(scope: Scope, permission = "assistant.use") {
  const [assistantAllowed, operationAllowed] = await Promise.all([
    hasLocationPermission(db, scope.actorId, scope.locationId, "assistant.use"),
    permission === "assistant.use"
      ? Promise.resolve(true)
      : hasLocationPermission(db, scope.actorId, scope.locationId, permission),
  ]);
  if (!assistantAllowed || !operationAllowed) throw new DomainError("FORBIDDEN");
  const location = await db.execute<{ id: string }>(sql`
    select id from pantry_locations
    where id = ${scope.locationId}::uuid
      and organization_id = ${scope.organizationId}::uuid
      and status <> 'archived'
    limit 1
  `);
  if (!location.rows[0]) throw new DomainError("NOT_FOUND");
}

async function requireConversation(scope: Scope, conversationId: string) {
  const result = await db.execute<{ id: string }>(sql`
    select id from ai_conversations
    where id = ${conversationId}::uuid
      and organization_id = ${scope.organizationId}::uuid
      and pantry_location_id = ${scope.locationId}::uuid
      and user_id = ${scope.actorId}::uuid
      and archived_at is null
      and status = 'active'
    limit 1
  `);
  if (!result.rows[0]) throw new DomainError("NOT_FOUND");
}

async function audit(scope: Scope, action: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  await db.execute(sql`
    insert into audit_logs(organization_id, location_id, actor_user_id, action, entity_type, entity_id, source, request_id, metadata)
    values (${scope.organizationId}::uuid, ${scope.locationId}::uuid, ${scope.actorId}::uuid, ${action}, ${entityType}, ${entityId}::uuid, 'application', ${scope.requestId}::uuid, ${JSON.stringify(metadata)}::jsonb)
  `);
}

function safeToolResponse(toolName: ReadToolName, result: ToolResultEnvelope) {
  if (!toolOutputIsMinimized(result)) throw new DomainError("FORBIDDEN");
  const d = result.data as Record<string, unknown>;
  switch (toolName) {
    case "get_inventory_summary":
      return `Observed inventory facts loaded for ${result.location.name}: ${(d.itemCount as number)} scoped item balance(s) as of ${result.asOf}. Quantities remain separated by item and base unit; no unlike units were summed.`;
    case "search_inventory_items":
      return `Found ${(d.itemCount as number)} item(s) matching "${d.query as string}".`;
    case "get_inventory_item_details":
      return `Loaded detail for one item, including its unit conversions and current balance.`;
    case "get_inventory_lot_history":
      return `Loaded the immutable transaction history for one lot.`;
    case "get_inventory_transaction_history":
      return `Loaded ${(d.transactionCount as number)} ledger transaction(s) for one item.`;
    case "get_shortage_forecast": {
      const items = (d.items as unknown[]) ?? [];
      return d.snapshot
        ? `The latest deterministic forecast contains ${items.length} scoped shortage or watch result(s) in the requested horizon. These are estimates, not inventory truth; review the structured confidence and basis.`
        : "No completed forecast snapshot exists for this location, so I cannot infer a shortage forecast.";
    }
    case "get_category_forecast": {
      const categories = (d.categories as unknown[]) ?? [];
      return d.snapshot ? `Forecast rolled up into ${categories.length} categor(y/ies) with watch, shortage, or urgent items.` : "No completed forecast snapshot exists for this location.";
    }
    case "get_expiring_inventory":
      return `Found ${(d.lotCount as number)} lot(s) expiring within ${d.withinDays as number} day(s).`;
    case "get_active_alerts":
      return `There are ${((d.alerts as unknown[]) ?? []).length} active scoped alert(s). Alert text is treated as record data, never as instructions.`;
    case "get_upcoming_appointments":
      return `Found ${(d.appointmentCount as number)} upcoming appointment(s) within ${d.withinDays as number} day(s). Household display name only; no contact information.`;
    case "get_pickup_counts":
      return `Loaded pickup counts by status for a ${d.days as number}-day window.`;
    case "get_household_pickup_status":
      return `Loaded minimal pickup status for one household by exact id. No contact information or notes were returned.`;
    case "get_sms_delivery_summary":
      return `Loaded aggregate SMS delivery counts for a ${d.days as number}-day window. No message bodies or phone numbers were returned.`;
    case "get_recent_donations":
      return `Loaded ${(d.donationCount as number)} recent donation record(s). Donor contact information was never returned.`;
    case "get_operational_metrics":
      return `Loaded current operational metrics for the selected location.`;
    default:
      return "Scoped result loaded.";
  }
}

async function recordToolRun(input: {
  scope: Scope;
  conversationId: string;
  toolName: string;
  inputSnapshot: unknown;
  outputSnapshot?: unknown;
  status: "completed" | "failed" | "denied";
  errorCode?: string;
  startedAt: Date;
}) {
  const result = await db.execute<{ id: string }>(sql`
    insert into ai_tool_runs(conversation_id, organization_id, pantry_location_id, user_id, tool_name, input_snapshot, output_snapshot, status, error_code, started_at, completed_at)
    values (${input.conversationId}::uuid, ${input.scope.organizationId}::uuid, ${input.scope.locationId}::uuid, ${input.scope.actorId}::uuid, ${input.toolName},
      ${JSON.stringify(input.inputSnapshot)}::jsonb, ${input.outputSnapshot === undefined ? null : JSON.stringify(input.outputSnapshot)}::jsonb,
      ${input.status}, ${input.errorCode ?? null}, ${input.startedAt.toISOString()}::timestamptz, now())
    returning id
  `);
  return result.rows[0];
}

export async function createConversation(scope: Scope, title: string) {
  await requireScope(scope);
  const parsedTitle = conversationTitleSchema.parse(title);
  const result = await db.execute<{ id: string }>(sql`
    insert into ai_conversations(organization_id, pantry_location_id, user_id, title)
    values (${scope.organizationId}::uuid, ${scope.locationId}::uuid, ${scope.actorId}::uuid, ${parsedTitle})
    returning id
  `);
  await audit(scope, "assistant.conversation_created", "ai_conversation", result.rows[0].id);
  return result.rows[0];
}

export async function runAssistantTurn(scope: Scope, conversationId: string, rawPrompt: string) {
  await requireScope(scope);
  await requireConversation(scope, conversationId);
  const rate = await db.execute<{ request_count: number }>(sql`
    insert into ai_rate_limit_windows(user_id, organization_id, pantry_location_id, window_start, request_count)
    values (${scope.actorId}::uuid, ${scope.organizationId}::uuid, ${scope.locationId}::uuid, to_timestamp(floor(extract(epoch from now()) / 300) * 300), 1)
    on conflict(user_id, organization_id, pantry_location_id, window_start)
    do update set request_count = ai_rate_limit_windows.request_count + 1, updated_at = now()
    returning request_count
  `);
  if ((rate.rows[0]?.request_count ?? 0) > 30) throw new DomainError("ASSISTANT_RATE_LIMITED");
  const prompt = assistantPromptSchema.parse(rawPrompt);
  const provider = getAssistantProvider();
  const decision = await provider.respond({ prompt, allowedTools: READ_TOOL_NAMES });
  const storedPrompt = decision.kind === "refusal" ? "[Request blocked by the assistant safety policy.]" : prompt;
  await db.execute(sql`
    insert into ai_messages(conversation_id, organization_id, role, content)
    values (${conversationId}::uuid, ${scope.organizationId}::uuid, 'user', ${storedPrompt})
  `);
  if (decision.kind !== "tool_call") {
    await db.execute(sql`
      insert into ai_messages(conversation_id, organization_id, role, content, model)
      values (${conversationId}::uuid, ${scope.organizationId}::uuid, 'assistant', ${decision.message}, ${provider.name})
    `);
    await db.execute(sql`update ai_conversations set updated_at = now() where id = ${conversationId}::uuid`);
    return { response: decision.message, toolResult: null };
  }

  const startedAt = new Date();
  const toolContext: AssistantToolContext = scope;
  try {
    const result = await executeReadTool(decision.toolName, toolContext, decision.input);
    const toolRun = await recordToolRun({ scope, conversationId, toolName: decision.toolName, inputSnapshot: decision.input, outputSnapshot: result, status: "completed", startedAt });
    const response = safeToolResponse(decision.toolName, result);
    await db.execute(sql`
      insert into ai_messages(conversation_id, organization_id, role, content, model, token_usage)
      values (${conversationId}::uuid, ${scope.organizationId}::uuid, 'assistant', ${response}, ${provider.name}, ${JSON.stringify({ providerTokens: 0, toolRunId: toolRun.id })}::jsonb)
    `);
    await db.execute(sql`update ai_conversations set updated_at = now() where id = ${conversationId}::uuid`);
    return { response, toolResult: result };
  } catch (error) {
    await recordToolRun({
      scope,
      conversationId,
      toolName: decision.toolName,
      inputSnapshot: decision.input,
      status: error instanceof DomainError && error.message === "FORBIDDEN" ? "denied" : "failed",
      errorCode: error instanceof Error ? error.message : "ASSISTANT_TOOL_FAILED",
      startedAt,
    });
    throw error;
  }
}

// --- Generic proposal creation -------------------------------------------------------------
// Every proposal is a stored, expiring preview. Creating one never mutates domain state.
// `payload` is what the confirming user sees; `stateSnapshot` (if given) is fingerprinted so a
// later confirm can detect that the underlying record changed since the proposal was made.

async function insertProposal(input: {
  scope: Scope;
  conversationId: string;
  actionType: ProposalToolName;
  payload: Record<string, unknown>;
  stateSnapshot: unknown;
  idempotencyKey: string;
}) {
  const stateFingerprint = stableFingerprint(input.stateSnapshot);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<{ id: string; expires_at: string; payload_snapshot: unknown; proposed_by: string; conversation_id: string }>(
      `insert into ai_action_proposals(
        conversation_id, organization_id, pantry_location_id, proposed_by, action_type,
        payload_snapshot, state_fingerprint, risk_level, expires_at, idempotency_key
      ) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
      on conflict(organization_id,idempotency_key) do nothing
      returning id,expires_at::text,payload_snapshot,proposed_by,conversation_id`,
      [
        input.conversationId,
        input.scope.organizationId,
        input.scope.locationId,
        input.scope.actorId,
        input.actionType,
        JSON.stringify(input.payload),
        stateFingerprint,
        PROPOSAL_RISK_LEVEL[input.actionType],
        proposalExpiresAt(),
        input.idempotencyKey,
      ],
    );
    const proposal =
      inserted.rows[0] ??
      (
        await client.query<{ id: string; expires_at: string; payload_snapshot: unknown; proposed_by: string; conversation_id: string }>(
          `select id,expires_at::text,payload_snapshot,proposed_by,conversation_id from ai_action_proposals where organization_id=$1 and idempotency_key=$2`,
          [input.scope.organizationId, input.idempotencyKey],
        )
      ).rows[0];
    if (proposal && (proposal.proposed_by !== input.scope.actorId || proposal.conversation_id !== input.conversationId || stableFingerprint(proposal.payload_snapshot) !== stableFingerprint(input.payload))) {
      throw new DomainError("CONFLICT");
    }
    await client.query("commit");
    if (!proposal) throw new DomainError("CONFLICT");

    await recordToolRun({ scope: input.scope, conversationId: input.conversationId, toolName: input.actionType, inputSnapshot: input.payload, outputSnapshot: { kind: "proposal", proposalId: proposal.id, expiresAt: proposal.expires_at, executed: false }, status: "completed", startedAt: new Date() });
    await audit(input.scope, "assistant.proposal_created", "ai_action_proposal", proposal.id, { actionType: input.actionType, riskLevel: PROPOSAL_RISK_LEVEL[input.actionType] });
    return proposal;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function requireProposalPermission(scope: Scope, actionType: ProposalToolName) {
  await requireScope(scope, "assistant.propose_actions");
  const domainPermission = PROPOSAL_TOOL_PERMISSIONS[actionType];
  const allowed = await hasLocationPermission(db, scope.actorId, scope.locationId, domainPermission);
  if (!allowed) throw new DomainError("FORBIDDEN");
}

async function currentAlertState(scope: Scope, alertId: string) {
  const result = await db.execute<AlertState>(sql`
    select id, status::text, updated_at::text from operational_alerts
    where id = ${alertId}::uuid and organization_id = ${scope.organizationId}::uuid and pantry_location_id = ${scope.locationId}::uuid
    limit 1
  `);
  return result.rows[0] ?? null;
}

export async function createAlertAcknowledgementProposal(scope: Scope, conversationId: string, values: AcknowledgeAlertProposalInput) {
  await requireConversation(scope, conversationId);
  await requireProposalPermission(scope, "propose_alert_acknowledgement");
  const parsed = acknowledgeAlertProposalInputSchema.parse(values);
  const alert = await currentAlertState(scope, parsed.alertId);
  if (!alert) throw new DomainError("NOT_FOUND");
  if (alert.status !== "open") throw new DomainError("CONFLICT");
  return insertProposal({
    scope,
    conversationId,
    actionType: "propose_alert_acknowledgement",
    payload: { alertId: parsed.alertId, target: "acknowledged", reason: parsed.reason, expectedState: alert, preview: "Acknowledge this alert only. Inventory, forecasts, appointments, and messages are unchanged." },
    stateSnapshot: alert,
    idempotencyKey: parsed.idempotencyKey,
  });
}

export async function createDraftSmsMessageProposal(scope: Scope, conversationId: string, values: DraftSmsMessageInput) {
  await requireConversation(scope, conversationId);
  await requireProposalPermission(scope, "draft_sms_message");
  const parsed = draftSmsMessageInputSchema.parse(values);
  return insertProposal({
    scope,
    conversationId,
    actionType: "draft_sms_message",
    payload: { body: parsed.body, purpose: parsed.purpose ?? null, preview: "This is a draft only. Nothing is sent. Use the Messages workflow to actually send this to a household." },
    stateSnapshot: { body: parsed.body },
    idempotencyKey: parsed.idempotencyKey,
  });
}

export async function createDraftBulkAnnouncementProposal(scope: Scope, conversationId: string, values: DraftBulkAnnouncementInput) {
  await requireConversation(scope, conversationId);
  await requireProposalPermission(scope, "draft_bulk_announcement");
  const parsed = draftBulkAnnouncementInputSchema.parse(values);
  return insertProposal({
    scope,
    conversationId,
    actionType: "draft_bulk_announcement",
    payload: { name: parsed.name, body: parsed.body, preview: "Confirming creates a DRAFT message campaign only. It still requires separate manager approval and an explicit send action before anything reaches a household." },
    stateSnapshot: { name: parsed.name, body: parsed.body },
    idempotencyKey: parsed.idempotencyKey,
  });
}

async function currentLotState(scope: Scope, lotId: string) {
  const result = await db.execute<{ id: string; status: string; physical_on_hand: string | null; base_unit_id: string; base_unit_abbreviation: string }>(sql`
    select l.id, l.status::text, b.physical_on_hand::text, i.base_unit_id, u.abbreviation as base_unit_abbreviation
    from inventory_lots l
    join inventory_items i on i.id = l.inventory_item_id
    join units_of_measure u on u.id = i.base_unit_id
    left join inventory_lot_balances b on b.inventory_lot_id = l.id
    where l.id = ${lotId}::uuid and l.organization_id = ${scope.organizationId}::uuid and l.pantry_location_id = ${scope.locationId}::uuid
    limit 1
  `);
  return result.rows[0] ?? null;
}

export async function createInventoryAdjustmentProposal(scope: Scope, conversationId: string, values: InventoryAdjustmentProposalInput) {
  await requireConversation(scope, conversationId);
  await requireProposalPermission(scope, "create_inventory_adjustment_proposal");
  const parsed = inventoryAdjustmentProposalInputSchema.parse(values);
  const lot = await currentLotState(scope, parsed.lotId);
  if (!lot) throw new DomainError("NOT_FOUND");
  return insertProposal({
    scope,
    conversationId,
    actionType: "create_inventory_adjustment_proposal",
    // unitId is resolved here from the lot's item base unit -- never accepted from the caller or model.
    payload: { lotId: parsed.lotId, direction: parsed.direction, quantity: parsed.quantity, unitId: lot.base_unit_id, unitAbbreviation: lot.base_unit_abbreviation, reasonCode: parsed.reasonCode, reason: parsed.reason, expectedLotState: lot, preview: `Confirming posts one immutable inventory transaction for this lot, in ${lot.base_unit_abbreviation}.` },
    stateSnapshot: lot,
    idempotencyKey: parsed.idempotencyKey,
  });
}

async function currentAppointmentState(scope: Scope, appointmentId: string) {
  const result = await db.execute<{ id: string; status: string; scheduled_start_at: string; scheduled_end_at: string }>(sql`
    select id, status::text, scheduled_start_at::text, scheduled_end_at::text from appointments
    where id = ${appointmentId}::uuid and organization_id = ${scope.organizationId}::uuid and pantry_location_id = ${scope.locationId}::uuid
    limit 1
  `);
  return result.rows[0] ?? null;
}

export async function createReservationProposal(scope: Scope, conversationId: string, values: ReservationProposalInput) {
  await requireConversation(scope, conversationId);
  await requireProposalPermission(scope, "create_reservation_proposal");
  const parsed = reservationProposalInputSchema.parse(values);
  const appointment = await currentAppointmentState(scope, parsed.appointmentId);
  if (!appointment) throw new DomainError("NOT_FOUND");
  return insertProposal({
    scope,
    conversationId,
    actionType: "create_reservation_proposal",
    payload: { appointmentId: parsed.appointmentId, expectedAppointmentState: appointment, preview: "Confirming reserves inventory against this appointment's allocation using FEFO. Physical stock is unchanged; only availability is reduced." },
    stateSnapshot: appointment,
    idempotencyKey: parsed.idempotencyKey,
  });
}

export async function createDonationNeedsReportProposal(scope: Scope, conversationId: string, values: DonationNeedsReportInput) {
  await requireConversation(scope, conversationId);
  await requireProposalPermission(scope, "create_donation_needs_report");
  const parsed = donationNeedsReportInputSchema.parse(values);
  const snapshot = await latestDonationNeeds(scope.organizationId, scope.locationId);
  return insertProposal({
    scope,
    conversationId,
    actionType: "create_donation_needs_report",
    payload: { horizonDays: parsed.horizonDays, snapshot: snapshot ?? null, preview: "This report is read-only. Confirming re-reads the latest recommendations; it never changes inventory or forecasts." },
    stateSnapshot: snapshot ?? { none: true },
    idempotencyKey: parsed.idempotencyKey,
  });
}

export async function createPickupRescheduleProposal(scope: Scope, conversationId: string, values: PickupRescheduleProposalInput) {
  await requireConversation(scope, conversationId);
  await requireProposalPermission(scope, "create_pickup_reschedule_proposal");
  const parsed = pickupRescheduleProposalInputSchema.parse(values);
  const appointment = await currentAppointmentState(scope, parsed.appointmentId);
  if (!appointment) throw new DomainError("NOT_FOUND");
  return insertProposal({
    scope,
    conversationId,
    actionType: "create_pickup_reschedule_proposal",
    payload: { appointmentId: parsed.appointmentId, scheduledStartAt: parsed.scheduledStartAt, scheduledEndAt: parsed.scheduledEndAt, expectedAppointmentState: appointment, preview: "Confirming reschedules this appointment. The original reservation, if any, is released and a new one is attempted at the new time." },
    stateSnapshot: appointment,
    idempotencyKey: parsed.idempotencyKey,
  });
}

// --- Confirmation: dispatches to the ordinary, already-existing domain command --------------
// The stored proposal is never itself authorization. Every branch re-checks permission through
// the real domain service, which independently re-validates state before writing anything.

type ProposalRow = {
  id: string;
  action_type: ProposalToolName;
  status: string;
  expires_at: string;
  state_fingerprint: string;
  payload_snapshot: Record<string, unknown>;
  execution_result: Record<string, unknown> | null;
  confirmed_at: string | null;
};

async function executeConfirmedProposal(scope: Scope, proposal: ProposalRow): Promise<Record<string, unknown>> {
  switch (proposal.action_type) {
    case "propose_alert_acknowledgement": {
      const payload = proposal.payload_snapshot as { alertId: string; reason: string };
      const result = await transitionAlert(scope.actorId, scope.organizationId, scope.locationId, payload.alertId, "acknowledged", payload.reason, scope.requestId);
      return { alertId: result.id, status: result.status };
    }
    case "draft_sms_message": {
      // Reviewed only. Never sends. Staff copy the draft into the real Messages workflow themselves.
      const payload = proposal.payload_snapshot as { body: string };
      return { reviewed: true, bodyLength: payload.body.length, sent: false };
    }
    case "draft_bulk_announcement": {
      const payload = proposal.payload_snapshot as { name: string; body: string };
      const result = await createMessageCampaign(scope.actorId, scope.organizationId, scope.locationId, { name: payload.name, campaignType: "assistant_drafted", body: payload.body, audience: {}, idempotencyKey: proposal.id }, scope.requestId);
      return { campaignId: result.id, status: "draft", sent: false };
    }
    case "create_inventory_adjustment_proposal": {
      const payload = proposal.payload_snapshot as { lotId: string; direction: "positive" | "negative"; quantity: string; unitId: string; reasonCode: string; reason: string };
      const result = await recordAdjustment(scope.actorId, scope.organizationId, { lotId: payload.lotId, direction: payload.direction, quantity: payload.quantity, unitId: payload.unitId, reasonCode: payload.reasonCode, reason: payload.reason }, scope.requestId);
      // High-risk adjustments return a pending approval request instead of an immediately posted
      // transaction; the assistant never bypasses that separate human-approval chain.
      return "physicalDelta" in result
        ? { posted: true, transactionId: result.id, physicalDelta: result.physicalDelta }
        : { posted: false, adjustmentRequestId: result.id, status: "pending_approval" };
    }
    case "create_reservation_proposal": {
      const payload = proposal.payload_snapshot as { appointmentId: string };
      const result = await createReservation(scope.actorId, scope.organizationId, payload.appointmentId, { idempotencyKey: proposal.id }, scope.requestId);
      return { reservationId: result.reservation?.id ?? null, conflicts: result.conflicts.length };
    }
    case "create_donation_needs_report": {
      const snapshot = await latestDonationNeeds(scope.organizationId, scope.locationId);
      return { snapshot: snapshot ?? null };
    }
    case "create_pickup_reschedule_proposal": {
      const payload = proposal.payload_snapshot as { appointmentId: string; scheduledStartAt: string; scheduledEndAt: string };
      const result = await rescheduleAppointment(scope.actorId, scope.organizationId, payload.appointmentId, { scheduledStartAt: new Date(payload.scheduledStartAt), scheduledEndAt: new Date(payload.scheduledEndAt) }, scope.requestId);
      return { replacementAppointmentId: result.replacement.id };
    }
    default:
      throw new DomainError("NOT_FOUND");
  }
}

// Re-fetches the live record a proposal was made against, in the exact shape it was fingerprinted
// in at proposal time, so confirmation can detect the record changed underneath the proposal.
// Action types with no mutable backing record (drafts, read-only reports) return null: skip.
async function currentStateSnapshot(scope: Scope, proposal: ProposalRow): Promise<unknown> {
  switch (proposal.action_type) {
    case "propose_alert_acknowledgement": {
      const payload = proposal.payload_snapshot as { alertId: string };
      return currentAlertState(scope, payload.alertId);
    }
    case "create_inventory_adjustment_proposal": {
      const payload = proposal.payload_snapshot as { lotId: string };
      return currentLotState(scope, payload.lotId);
    }
    case "create_reservation_proposal":
    case "create_pickup_reschedule_proposal": {
      const payload = proposal.payload_snapshot as { appointmentId: string };
      return currentAppointmentState(scope, payload.appointmentId);
    }
    default:
      return null;
  }
}

export async function confirmProposal(scope: Scope, rawProposalId: string) {
  const proposalId = proposalIdSchema.parse(rawProposalId);

  const client = await pool.connect();
  let proposal: ProposalRow;
  try {
    await client.query("begin");
    const result = await client.query<ProposalRow>(
      `select id,action_type,status,expires_at::text,state_fingerprint,payload_snapshot,execution_result,confirmed_at::text
       from ai_action_proposals where id=$1 and organization_id=$2 and pantry_location_id=$3 for update`,
      [proposalId, scope.organizationId, scope.locationId],
    );
    proposal = result.rows[0];
    if (!proposal) throw new DomainError("NOT_FOUND");
    if (proposal.status === "executed") {
      await client.query("commit");
      return proposal.execution_result;
    }
    if (["rejected", "expired", "stale", "failed"].includes(proposal.status)) throw new DomainError("CONFLICT");
    if (isProposalExpired(proposal.expires_at)) {
      await client.query(`update ai_action_proposals set status='expired',updated_at=now() where id=$1`, [proposal.id]);
      await client.query("commit");
      throw new DomainError("CONFLICT");
    }
    if (proposal.status === "confirmed" && proposal.confirmed_at && Date.now() - new Date(proposal.confirmed_at).getTime() < 30_000) {
      await client.query("commit");
      throw new DomainError("CONFLICT");
    }
    const freshState = await currentStateSnapshot(scope, proposal);
    if (freshState !== null && stableFingerprint(freshState) !== proposal.state_fingerprint) {
      await client.query(`update ai_action_proposals set status='stale',updated_at=now() where id=$1`, [proposal.id]);
      await client.query("commit");
      throw new DomainError("CONFLICT");
    }
    await client.query(`update ai_action_proposals set status='confirmed',confirmed_by=$2,confirmed_at=now(),updated_at=now() where id=$1`, [proposal.id, scope.actorId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  // Independent, fresh authorization for the actual write -- the confirmed proposal row above is
  // a reference, never the authorization itself.
  const requiredPermission = PROPOSAL_CONFIRM_PERMISSION[proposal.action_type];
  await requireScope(scope, confirmGatePermission(proposal.action_type));
  const canExecute = await hasLocationPermission(db, scope.actorId, scope.locationId, requiredPermission);
  if (!canExecute) {
    await db.execute(sql`update ai_action_proposals set status='failed',rejection_reason='Confirming actor lost required permission.',updated_at=now() where id=${proposal.id}::uuid and status='confirmed'`);
    throw new DomainError("FORBIDDEN");
  }

  try {
    const executionResult = await executeConfirmedProposal(scope, proposal);
    await db.execute(sql`
      update ai_action_proposals set status='executed', executed_at=now(), execution_result=${JSON.stringify(executionResult)}::jsonb, updated_at=now()
      where id=${proposal.id}::uuid and status='confirmed'
    `);
    await audit(scope, "assistant.proposal_executed", "ai_action_proposal", proposal.id, { actionType: proposal.action_type });
    return executionResult;
  } catch (error) {
    await db.execute(sql`update ai_action_proposals set status='failed', rejection_reason='Trusted domain command failed.', updated_at=now() where id=${proposal.id}::uuid and status='confirmed'`);
    throw error;
  }
}

export function getRegisteredAssistantTools() {
  return Object.entries(ASSISTANT_TOOL_REGISTRY).map(([name, definition]) => ({
    name,
    class: definition.class,
    requiredPermission: definition.requiredPermission,
    description: definition.description,
  }));
}
