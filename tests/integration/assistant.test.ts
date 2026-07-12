// @vitest-environment node
import { config } from "dotenv";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });
const developmentUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
if (!developmentUrl || !testUrl)
  throw new Error("Native PostgreSQL test environment is incomplete.");
const parsed = new URL(testUrl);
if (
  !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
  !parsed.pathname.endsWith("_test") ||
  testUrl === developmentUrl
) {
  throw new Error(
    "Integration tests require the distinct local *_test database.",
  );
}
process.env.DATABASE_URL = testUrl;
const pool = new Pool({ connectionString: testUrl, max: 3 });

const ids = {
  harbor: "20000000-0000-4000-8000-000000000001",
  downtown: "30000000-0000-4000-8000-000000000001",
  admin: "10000000-0000-4000-8000-000000000001",
  unrelated: "10000000-0000-4000-8000-000000000007",
};

function scope(actorId = ids.admin) {
  return {
    actorId,
    organizationId: ids.harbor,
    locationId: ids.downtown,
    requestId: crypto.randomUUID(),
  };
}

async function createAlert(suffix: string) {
  const result = await pool.query<{ id: string }>(
    `insert into operational_alerts(
      organization_id,pantry_location_id,alert_type,severity,fingerprint,title,summary,source_type,details
    ) values($1,$2,'low_stock','warning',$3,$4,'Assistant integration test signal','test','{}'::jsonb)
    returning id`,
    [
      ids.harbor,
      ids.downtown,
      `assistant-test-${suffix}-${crypto.randomUUID()}`,
      `Assistant test ${suffix}`,
    ],
  );
  return result.rows[0]!.id;
}

describe.sequential("controlled assistant integration", () => {
  afterAll(async () => pool.end());

  it("runs a scoped factual tool and stores immutable minimized telemetry", async () => {
    const { createConversation, runAssistantTurn } =
      await import("@/domains/assistant/service");
    const conversation = await createConversation(
      scope(),
      "Integration inventory query",
    );
    const result = await runAssistantTurn(
      scope(),
      conversation.id,
      "How much inventory is available?",
    );
    expect(result.toolResult).toMatchObject({
      kind: "observed_fact",
      location: { id: ids.downtown },
    });
    expect(JSON.stringify(result.toolResult)).not.toContain("phone_number");
    const run = await pool.query<{
      id: string;
      tool_name: string;
      status: string;
    }>(
      "select id,tool_name,status from ai_tool_runs where conversation_id=$1",
      [conversation.id],
    );
    expect(run.rows[0]).toMatchObject({
      tool_name: "get_inventory_summary",
      status: "completed",
    });
    await expect(
      pool.query("update ai_tool_runs set status='tampered' where id=$1", [
        run.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ message: "APPEND_ONLY_RECORD" });
  });

  it("marks a proposal stale when canonical state changes", async () => {
    const {
      createAlertAcknowledgementProposal,
      createConversation,
      confirmProposal,
    } = await import("@/domains/assistant/service");
    const conversation = await createConversation(
      scope(),
      "Stale proposal test",
    );
    const alertId = await createAlert("stale");
    const proposal = await createAlertAcknowledgementProposal(
      scope(),
      conversation.id,
      {
        alertId,
        reason: "Reviewed for stale-state testing.",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    await pool.query(
      "update operational_alerts set summary='Changed after proposal',updated_at=now()+interval '1 second' where id=$1",
      [alertId],
    );
    await expect(confirmProposal(scope(), proposal.id)).rejects.toMatchObject({
      message: "CONFLICT",
    });
    const state = await pool.query<{ status: string }>(
      "select status from ai_action_proposals where id=$1",
      [proposal.id],
    );
    expect(state.rows[0]!.status).toBe("stale");
  });

  it("executes one confirmed low-risk action and makes retries idempotent", async () => {
    const {
      createAlertAcknowledgementProposal,
      createConversation,
      confirmProposal,
    } = await import("@/domains/assistant/service");
    const conversation = await createConversation(
      scope(),
      "Idempotent proposal test",
    );
    const alertId = await createAlert("execute");
    const proposal = await createAlertAcknowledgementProposal(
      scope(),
      conversation.id,
      {
        alertId,
        reason: "Reviewed through the assistant confirmation screen.",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    const simultaneous = await Promise.allSettled([
      confirmProposal(scope(), proposal.id),
      confirmProposal(scope(), proposal.id),
    ]);
    expect(simultaneous.some((result) => result.status === "fulfilled")).toBe(
      true,
    );
    const final = await confirmProposal(scope(), proposal.id);
    expect(final).toMatchObject({ alertId, status: "acknowledged" });
    const events = await pool.query<{ count: string }>(
      "select count(*)::text from operational_alert_events where operational_alert_id=$1 and to_status='acknowledged'",
      [alertId],
    );
    expect(Number(events.rows[0]!.count)).toBe(1);
  });

  it("rejects reuse of an idempotency key for a different proposal", async () => {
    const { createAlertAcknowledgementProposal, createConversation } =
      await import("@/domains/assistant/service");
    const conversation = await createConversation(
      scope(),
      "Idempotency collision test",
    );
    const firstAlertId = await createAlert("collision-one");
    const secondAlertId = await createAlert("collision-two");
    const idempotencyKey = crypto.randomUUID();
    await createAlertAcknowledgementProposal(scope(), conversation.id, {
      alertId: firstAlertId,
      reason: "First proposal payload.",
      idempotencyKey,
    });
    await expect(
      createAlertAcknowledgementProposal(scope(), conversation.id, {
        alertId: secondAlertId,
        reason: "Different proposal payload.",
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ message: "CONFLICT" });
    const count = await pool.query<{ count: string }>(
      "select count(*)::text from ai_action_proposals where organization_id=$1 and idempotency_key=$2",
      [ids.harbor, idempotencyKey],
    );
    expect(Number(count.rows[0]!.count)).toBe(1);
  });

  it("denies cross-organization use without revealing records", async () => {
    const { createConversation } = await import("@/domains/assistant/service");
    await expect(
      createConversation(scope(ids.unrelated), "Forbidden conversation"),
    ).rejects.toMatchObject({ message: "FORBIDDEN" });
  });
});
