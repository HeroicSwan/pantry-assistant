// @vitest-environment node

import { config } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });
const developmentUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
if (!developmentUrl || !testUrl) throw new Error("Native PostgreSQL test environment is incomplete.");
const parsed = new URL(testUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test") || testUrl === developmentUrl) throw new Error("Integration tests require the distinct local *_test database.");
process.env.DATABASE_URL = testUrl;

const pool = new Pool({ connectionString: testUrl, max: 3 });
const ids = {
  harbor: "20000000-0000-4000-8000-000000000001",
  downtown: "30000000-0000-4000-8000-000000000001",
  admin: "10000000-0000-4000-8000-000000000001",
  household: crypto.randomUUID(),
  contact: crypto.randomUUID(),
  consent: crypto.randomUUID(),
};
const phone = "+12025550142";
const pantryPhone = "+12025550199";

describe.sequential("consent-first messaging", () => {
  afterAll(async () => pool.end());

  beforeAll(async () => {
    const { saveMessagingSettings } = await import("@/domains/messaging/service");
    await saveMessagingSettings(ids.admin, ids.harbor, ids.downtown, { sendingMode: "simulation", defaultFromNumber: pantryPhone, defaultLanguage: "en", reminderHoursBefore: 24, retryLimit: 3, helpResponse: "Reply STOP to opt out. Contact Harbor Pantry for help.", isEnabled: true }, crypto.randomUUID());
    await pool.query("insert into households(id,organization_id,household_number,status,display_name,preferred_language,household_size,default_pantry_location_id,created_by) values($1,$2,$3,'active',$4,'en',2,$5,$6)", [ids.household, ids.harbor, `MSG-${ids.household.slice(0, 8)}`, "Messaging Integration Household", ids.downtown, ids.admin]);
    await pool.query("insert into household_contacts(id,organization_id,household_id,contact_type,name,phone_number,phone_normalized,is_active,created_by) values($1,$2,$3,'primary',$4,$5,$5,true,$6)", [ids.contact, ids.harbor, ids.household, "Messaging Contact", phone, ids.admin]);
    await pool.query("insert into sms_consents(id,organization_id,household_id,household_contact_id,phone_normalized,status,consent_source,recorded_by) values($1,$2,$3,$4,$5,'consented','verbal',$6)", [ids.consent, ids.harbor, ids.household, ids.contact, phone, ids.admin]);
  });

  it("sends through simulation and deduplicates the logical message", async () => {
    const { sendIndividualMessage } = await import("@/domains/messaging/service");
    const idempotencyKey = crypto.randomUUID();
    const first = await sendIndividualMessage(ids.admin, ids.harbor, ids.downtown, { contactId: ids.contact, body: "Your pantry appointment is tomorrow.", language: "en", idempotencyKey, confirmed: true }, crypto.randomUUID());
    const duplicate = await sendIndividualMessage(ids.admin, ids.harbor, ids.downtown, { contactId: ids.contact, body: "Your pantry appointment is tomorrow.", language: "en", idempotencyKey, confirmed: true }, crypto.randomUUID());
    expect(duplicate.id).toBe(first.id);
    const messages = await pool.query<{ status: string; provider: string }>("select status,provider from sms_messages where organization_id=$1 and idempotency_key=$2", [ids.harbor, idempotencyKey]);
    expect(messages.rowCount).toBe(1);
    expect(messages.rows[0]).toMatchObject({ status: "delivered", provider: "simulation" });
    const events = await pool.query("select 1 from sms_events where sms_message_id=$1 and event_type='send_attempt'", [first.id]);
    expect(events.rowCount).toBe(1);
  });

  it("processes STOP idempotently and blocks every future send", async () => {
    const { processInboundWebhook, sendIndividualMessage } = await import("@/domains/messaging/service");
    const event = { providerMessageId: `SM${crypto.randomUUID().replaceAll("-", "")}`, from: phone, to: pantryPhone, body: " STOP ", payload: { MessageSid: "redacted" } };
    const first = await processInboundWebhook(event);
    const duplicate = await processInboundWebhook(event);
    expect(first).toMatchObject({ intent: "stop", duplicate: false, matched: true });
    expect(duplicate).toMatchObject({ intent: "stop", duplicate: true, matched: true });
    const latest = await pool.query<{ status: string }>("select status::text from sms_consents where organization_id=$1 and household_contact_id=$2 order by effective_at desc,created_at desc limit 1", [ids.harbor, ids.contact]);
    expect(latest.rows[0]?.status).toBe("opted_out");
    await expect(sendIndividualMessage(ids.admin, ids.harbor, ids.downtown, { contactId: ids.contact, body: "This must not send.", idempotencyKey: crypto.randomUUID(), confirmed: true }, crypto.randomUUID())).rejects.toMatchObject({ message: "MESSAGE_RECIPIENT_INELIGIBLE" });
  });

  it("stores status history without allowing stale events to downgrade delivery", async () => {
    const { processStatusWebhook } = await import("@/domains/messaging/service");
    const messageId = crypto.randomUUID();
    const providerId = `SM${crypto.randomUUID().replaceAll("-", "")}`;
    await pool.query("insert into sms_messages(id,organization_id,pantry_location_id,household_id,household_contact_id,consent_id,direction,message_type,status,to_phone_number,body_snapshot,provider,provider_message_id,idempotency_key,created_by) values($1,$2,$3,$4,$5,$6,'outbound','individual_message','sent',$7,'Status ordering test','twilio',$8,$9,$10)", [messageId, ids.harbor, ids.downtown, ids.household, ids.contact, ids.consent, phone, providerId, crypto.randomUUID(), ids.admin]);
    await processStatusWebhook({ providerEventId: "EV-delivered-" + messageId, providerMessageId: providerId, status: "delivered", errorCode: null, errorMessage: null, payload: { MessageStatus: "delivered" } });
    await processStatusWebhook({ providerEventId: "EV-sent-" + messageId, providerMessageId: providerId, status: "sent", errorCode: null, errorMessage: null, payload: { MessageStatus: "sent" } });
    const message = await pool.query<{ status: string }>("select status from sms_messages where id=$1", [messageId]);
    const events = await pool.query("select 1 from sms_events where sms_message_id=$1", [messageId]);
    expect(message.rows[0]?.status).toBe("delivered");
    expect(events.rowCount).toBe(2);
  });
});
