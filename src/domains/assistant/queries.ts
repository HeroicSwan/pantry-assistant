import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/database/client";

export async function listAssistantConversations(
  actorId: string,
  organizationId: string,
  locationId: string,
) {
  const result = await db.execute<{
    id: string;
    title: string;
    status: string;
    created_at: string;
    updated_at: string;
    message_count: number;
  }>(sql`
    select c.id, c.title, c.status, c.created_at::text, c.updated_at::text,
      count(m.id)::integer as message_count
    from ai_conversations c
    left join ai_messages m on m.conversation_id = c.id and m.organization_id = c.organization_id
    where c.user_id = ${actorId}::uuid
      and c.organization_id = ${organizationId}::uuid
      and c.pantry_location_id = ${locationId}::uuid
      and c.archived_at is null
    group by c.id
    order by c.updated_at desc
    limit 30
  `);
  return result.rows;
}

export async function getAssistantConversation(
  actorId: string,
  organizationId: string,
  locationId: string,
  conversationId: string,
) {
  const conversationResult = await db.execute<{
    id: string;
    title: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>(sql`
    select id, title, status, created_at::text, updated_at::text
    from ai_conversations
    where id = ${conversationId}::uuid
      and user_id = ${actorId}::uuid
      and organization_id = ${organizationId}::uuid
      and pantry_location_id = ${locationId}::uuid
      and archived_at is null
    limit 1
  `);
  const conversation = conversationResult.rows[0];
  if (!conversation) return null;

  const [messages, toolRuns, proposals] = await Promise.all([
    db.execute<{
      id: string;
      role: string;
      content: string;
      model: string | null;
      created_at: string;
    }>(sql`
      select id, role, content, model, created_at::text
      from ai_messages
      where conversation_id = ${conversationId}::uuid
        and organization_id = ${organizationId}::uuid
      order by created_at, id
      limit 100
    `),
    db.execute<{
      id: string;
      tool_name: string;
      output_snapshot: unknown;
      status: string;
      error_code: string | null;
      completed_at: string | null;
    }>(sql`
      select id, tool_name, output_snapshot, status, error_code, completed_at::text
      from ai_tool_runs
      where conversation_id = ${conversationId}::uuid
        and organization_id = ${organizationId}::uuid
        and pantry_location_id = ${locationId}::uuid
        and user_id = ${actorId}::uuid
      order by created_at desc
      limit 50
    `),
    db.execute<{
      id: string;
      action_type: string;
      payload_snapshot: Record<string, unknown>;
      risk_level: string;
      status: string;
      expires_at: string;
      execution_result: Record<string, unknown> | null;
      rejection_reason: string | null;
      created_at: string;
    }>(sql`
      select id, action_type, payload_snapshot, risk_level, status,
        expires_at::text, execution_result, rejection_reason, created_at::text
      from ai_action_proposals
      where conversation_id = ${conversationId}::uuid
        and organization_id = ${organizationId}::uuid
        and pantry_location_id = ${locationId}::uuid
        and proposed_by = ${actorId}::uuid
      order by created_at desc
      limit 30
    `),
  ]);

  return {
    conversation,
    messages: messages.rows,
    toolRuns: toolRuns.rows,
    proposals: proposals.rows.map((proposal) => ({
      ...proposal,
      displayStatus:
        proposal.status === "pending" &&
        new Date(proposal.expires_at).getTime() <= Date.now()
          ? "expired"
          : proposal.status,
    })),
  };
}

export async function listOpenAlertsForAssistant(
  organizationId: string,
  locationId: string,
) {
  const result = await db.execute<{
    id: string;
    title: string;
    severity: string;
    updated_at: string;
  }>(sql`
    select id, left(title, 160) as title, severity::text, updated_at::text
    from operational_alerts
    where organization_id = ${organizationId}::uuid
      and pantry_location_id = ${locationId}::uuid
      and status = 'open'
    order by case severity when 'critical' then 1 when 'warning' then 2 else 3 end,
      last_detected_at desc
    limit 50
  `);
  return result.rows;
}
