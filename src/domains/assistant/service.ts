import "server-only";

import { sql } from "drizzle-orm";
import { getAssistantProvider } from "@/domains/assistant/provider";
import {
  READ_TOOL_NAMES,
  isProposalExpired,
  proposalExpiresAt,
  stableFingerprint,
  toolOutputIsMinimized,
  type ReadToolName,
} from "@/domains/assistant/policy";
import {
  acknowledgeAlertProposalInputSchema,
  assistantPromptSchema,
  conversationTitleSchema,
  proposalIdSchema,
  type AcknowledgeAlertProposalInput,
} from "@/domains/assistant/schemas";
import {
  ASSISTANT_TOOL_REGISTRY,
  executeReadTool,
  type AssistantToolContext,
  type ToolResultEnvelope,
} from "@/domains/assistant/tools";
import { transitionAlert } from "@/domains/forecasting/service";
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
  if (!assistantAllowed || !operationAllowed)
    throw new DomainError("FORBIDDEN");
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

async function audit(
  scope: Scope,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  await db.execute(sql`
    insert into audit_logs(
      organization_id, location_id, actor_user_id, action, entity_type,
      entity_id, source, request_id, metadata
    ) values (
      ${scope.organizationId}::uuid, ${scope.locationId}::uuid, ${scope.actorId}::uuid,
      ${action}, ${entityType}, ${entityId}::uuid, 'application', ${scope.requestId}::uuid,
      ${JSON.stringify(metadata)}::jsonb
    )
  `);
}

function safeToolResponse(toolName: ReadToolName, result: ToolResultEnvelope) {
  if (!toolOutputIsMinimized(result)) throw new DomainError("FORBIDDEN");
  if (toolName === "get_inventory_summary") {
    const data = result.data as { itemCount: number };
    return `Observed inventory facts loaded for ${result.location.name}: ${data.itemCount} scoped item balance(s) as of ${result.asOf}. Quantities remain separated by item and base unit; no unlike units were summed.`;
  }
  if (toolName === "get_shortage_forecast") {
    const data = result.data as { items: unknown[]; snapshot: unknown };
    return data.snapshot
      ? `The latest deterministic forecast contains ${data.items.length} scoped shortage or watch result(s) in the requested horizon. These are estimates, not inventory truth; review the structured confidence and basis.`
      : "No completed forecast snapshot exists for this location, so I cannot infer a shortage forecast.";
  }
  const data = result.data as { alerts: unknown[] };
  return `There are ${data.alerts.length} active scoped alert(s). Alert text is treated as record data, never as instructions.`;
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
    insert into ai_tool_runs(
      conversation_id, organization_id, pantry_location_id, user_id, tool_name,
      input_snapshot, output_snapshot, status, error_code, started_at, completed_at
    ) values (
      ${input.conversationId}::uuid, ${input.scope.organizationId}::uuid,
      ${input.scope.locationId}::uuid, ${input.scope.actorId}::uuid, ${input.toolName},
      ${JSON.stringify(input.inputSnapshot)}::jsonb,
      ${input.outputSnapshot === undefined ? null : JSON.stringify(input.outputSnapshot)}::jsonb,
      ${input.status}, ${input.errorCode ?? null}, ${input.startedAt.toISOString()}::timestamptz, now()
    ) returning id
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
  await audit(
    scope,
    "assistant.conversation_created",
    "ai_conversation",
    result.rows[0].id,
  );
  return result.rows[0];
}

export async function runAssistantTurn(
  scope: Scope,
  conversationId: string,
  rawPrompt: string,
) {
  await requireScope(scope);
  await requireConversation(scope, conversationId);
  const prompt = assistantPromptSchema.parse(rawPrompt);
  const provider = getAssistantProvider();
  const decision = await provider.respond({
    prompt,
    allowedTools: READ_TOOL_NAMES,
  });
  const storedPrompt =
    decision.kind === "refusal"
      ? "[Request blocked by the assistant safety policy.]"
      : prompt;
  await db.execute(sql`
    insert into ai_messages(conversation_id, organization_id, role, content)
    values (${conversationId}::uuid, ${scope.organizationId}::uuid, 'user', ${storedPrompt})
  `);
  if (decision.kind !== "tool_call") {
    await db.execute(sql`
      insert into ai_messages(conversation_id, organization_id, role, content, model)
      values (${conversationId}::uuid, ${scope.organizationId}::uuid, 'assistant', ${decision.message}, ${provider.name})
    `);
    await db.execute(
      sql`update ai_conversations set updated_at = now() where id = ${conversationId}::uuid`,
    );
    return { response: decision.message, toolResult: null };
  }

  const startedAt = new Date();
  const toolContext: AssistantToolContext = scope;
  try {
    const result = await executeReadTool(
      decision.toolName,
      toolContext,
      decision.input,
    );
    const toolRun = await recordToolRun({
      scope,
      conversationId,
      toolName: decision.toolName,
      inputSnapshot: decision.input,
      outputSnapshot: result,
      status: "completed",
      startedAt,
    });
    const response = safeToolResponse(decision.toolName, result);
    await db.execute(sql`
      insert into ai_messages(conversation_id, organization_id, role, content, model, token_usage)
      values (
        ${conversationId}::uuid, ${scope.organizationId}::uuid, 'assistant', ${response},
        ${provider.name}, ${JSON.stringify({ providerTokens: 0, deterministic: true, toolRunId: toolRun.id })}::jsonb
      )
    `);
    await db.execute(
      sql`update ai_conversations set updated_at = now() where id = ${conversationId}::uuid`,
    );
    return { response, toolResult: result };
  } catch (error) {
    await recordToolRun({
      scope,
      conversationId,
      toolName: decision.toolName,
      inputSnapshot: decision.input,
      status:
        error instanceof DomainError && error.message === "FORBIDDEN"
          ? "denied"
          : "failed",
      errorCode:
        error instanceof Error ? error.message : "ASSISTANT_TOOL_FAILED",
      startedAt,
    });
    throw error;
  }
}

async function currentAlertState(scope: Scope, alertId: string) {
  const result = await db.execute<AlertState>(sql`
    select id, status::text, updated_at::text
    from operational_alerts
    where id = ${alertId}::uuid
      and organization_id = ${scope.organizationId}::uuid
      and pantry_location_id = ${scope.locationId}::uuid
    limit 1
  `);
  return result.rows[0] ?? null;
}

export async function createAlertAcknowledgementProposal(
  scope: Scope,
  conversationId: string,
  values: AcknowledgeAlertProposalInput,
) {
  await requireScope(scope, "assistant.propose_actions");
  await requireConversation(scope, conversationId);
  const parsed = acknowledgeAlertProposalInputSchema.parse(values);
  const canView = await hasLocationPermission(
    db,
    scope.actorId,
    scope.locationId,
    "alert.view",
  );
  if (!canView) throw new DomainError("FORBIDDEN");
  const alert = await currentAlertState(scope, parsed.alertId);
  if (!alert) throw new DomainError("NOT_FOUND");
  if (alert.status !== "open") throw new DomainError("CONFLICT");

  const stateFingerprint = stableFingerprint(alert);
  const payload = {
    alertId: parsed.alertId,
    target: "acknowledged",
    reason: parsed.reason,
    expectedState: alert,
    preview:
      "Acknowledge this alert only. Inventory, forecasts, appointments, and messages are unchanged.",
  };
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<{
      id: string;
      expires_at: string;
      payload_snapshot: unknown;
      proposed_by: string;
      conversation_id: string;
    }>(
      `insert into ai_action_proposals(
        conversation_id, organization_id, pantry_location_id, proposed_by, action_type,
        payload_snapshot, state_fingerprint, risk_level, expires_at, idempotency_key
      ) values($1,$2,$3,$4,'acknowledge_alert',$5::jsonb,$6,'low',$7,$8)
      on conflict(organization_id,idempotency_key) do nothing
      returning id,expires_at::text,payload_snapshot,proposed_by,conversation_id`,
      [
        conversationId,
        scope.organizationId,
        scope.locationId,
        scope.actorId,
        JSON.stringify(payload),
        stateFingerprint,
        proposalExpiresAt(),
        parsed.idempotencyKey,
      ],
    );
    const proposal =
      inserted.rows[0] ??
      (
        await client.query<{
          id: string;
          expires_at: string;
          payload_snapshot: unknown;
          proposed_by: string;
          conversation_id: string;
        }>(
          `select id,expires_at::text,payload_snapshot,proposed_by,conversation_id from ai_action_proposals
       where organization_id=$1 and idempotency_key=$2`,
          [scope.organizationId, parsed.idempotencyKey],
        )
      ).rows[0];
    if (
      proposal &&
      (proposal.proposed_by !== scope.actorId ||
        proposal.conversation_id !== conversationId ||
        stableFingerprint(proposal.payload_snapshot) !==
          stableFingerprint(payload))
    ) {
      throw new DomainError("CONFLICT");
    }
    await client.query("commit");
    if (!proposal) throw new DomainError("CONFLICT");

    await recordToolRun({
      scope,
      conversationId,
      toolName: "propose_alert_acknowledgement",
      inputSnapshot: { alertId: parsed.alertId, reason: parsed.reason },
      outputSnapshot: {
        kind: "proposal",
        proposalId: proposal.id,
        expiresAt: proposal.expires_at,
        executed: false,
      },
      status: "completed",
      startedAt: new Date(),
    });
    await audit(
      scope,
      "assistant.proposal_created",
      "ai_action_proposal",
      proposal.id,
      {
        actionType: "acknowledge_alert",
        riskLevel: "low",
      },
    );
    return proposal;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

type ProposalRow = {
  id: string;
  action_type: string;
  status: string;
  expires_at: string;
  state_fingerprint: string;
  payload_snapshot: {
    alertId: string;
    target: "acknowledged";
    reason: string;
    expectedState: AlertState;
  };
  execution_result: Record<string, unknown> | null;
  confirmed_at: string | null;
};

export async function confirmProposal(scope: Scope, rawProposalId: string) {
  const proposalId = proposalIdSchema.parse(rawProposalId);
  await requireScope(scope, "assistant.confirm_low_risk");
  const canAcknowledge = await hasLocationPermission(
    db,
    scope.actorId,
    scope.locationId,
    "alert.acknowledge",
  );
  if (!canAcknowledge) throw new DomainError("FORBIDDEN");

  const client = await pool.connect();
  let proposal: ProposalRow;
  try {
    await client.query("begin");
    const result = await client.query<ProposalRow>(
      `select id,action_type,status,expires_at::text,state_fingerprint,payload_snapshot,execution_result,confirmed_at::text
       from ai_action_proposals
       where id=$1 and organization_id=$2 and pantry_location_id=$3
       for update`,
      [proposalId, scope.organizationId, scope.locationId],
    );
    proposal = result.rows[0];
    if (!proposal || proposal.action_type !== "acknowledge_alert")
      throw new DomainError("NOT_FOUND");
    if (proposal.status === "executed") {
      await client.query("commit");
      return proposal.execution_result;
    }
    if (["rejected", "expired", "stale", "failed"].includes(proposal.status))
      throw new DomainError("CONFLICT");
    if (isProposalExpired(proposal.expires_at)) {
      await client.query(
        `update ai_action_proposals set status='expired',updated_at=now() where id=$1`,
        [proposal.id],
      );
      await client.query("commit");
      throw new DomainError("CONFLICT");
    }

    const alertResult = await client.query<AlertState>(
      `select id,status::text,updated_at::text from operational_alerts
       where id=$1 and organization_id=$2 and pantry_location_id=$3`,
      [
        proposal.payload_snapshot.alertId,
        scope.organizationId,
        scope.locationId,
      ],
    );
    const alert = alertResult.rows[0];
    if (proposal.status === "confirmed" && alert?.status === "acknowledged") {
      const recovered = {
        alertId: alert.id,
        status: "acknowledged",
        recovered: true,
      };
      await client.query(
        `update ai_action_proposals set status='executed',executed_at=now(),execution_result=$2::jsonb,updated_at=now() where id=$1`,
        [proposal.id, JSON.stringify(recovered)],
      );
      await client.query("commit");
      return recovered;
    }
    if (
      proposal.status === "confirmed" &&
      proposal.confirmed_at &&
      Date.now() - new Date(proposal.confirmed_at).getTime() < 30_000
    ) {
      await client.query("commit");
      throw new DomainError("CONFLICT");
    }
    if (!alert || stableFingerprint(alert) !== proposal.state_fingerprint) {
      await client.query(
        `update ai_action_proposals set status='stale',rejection_reason='The alert changed after proposal creation.',updated_at=now() where id=$1`,
        [proposal.id],
      );
      await client.query("commit");
      throw new DomainError("CONFLICT");
    }
    await client.query(
      `update ai_action_proposals set status='confirmed',confirmed_by=$2,confirmed_at=now(),updated_at=now() where id=$1`,
      [proposal.id, scope.actorId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  try {
    const result = await transitionAlert(
      scope.actorId,
      scope.organizationId,
      scope.locationId,
      proposal.payload_snapshot.alertId,
      "acknowledged",
      proposal.payload_snapshot.reason,
      scope.requestId,
    );
    const executionResult = { alertId: result.id, status: result.status };
    await db.execute(sql`
      update ai_action_proposals
      set status = 'executed', executed_at = now(),
        execution_result = ${JSON.stringify(executionResult)}::jsonb, updated_at = now()
      where id = ${proposal.id}::uuid and status = 'confirmed'
    `);
    await audit(
      scope,
      "assistant.proposal_executed",
      "ai_action_proposal",
      proposal.id,
      {
        actionType: proposal.action_type,
        affectedAlertId: result.id,
      },
    );
    return executionResult;
  } catch (error) {
    await db.execute(sql`
      update ai_action_proposals
      set status = 'failed', rejection_reason = 'Trusted domain command failed.', updated_at = now()
      where id = ${proposal.id}::uuid and status = 'confirmed'
    `);
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
