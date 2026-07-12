import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { hasLocationPermission } from "@/lib/database/authorization";
import { DomainError } from "@/lib/errors";

async function requireView(actorId: string, organizationId: string, locationId: string, permission = "message.view") {
  const [allowed, scope] = await Promise.all([
    hasLocationPermission(db, actorId, locationId, permission),
    db.execute<{ valid: boolean }>(sql`select exists(select 1 from pantry_locations where id=${locationId} and organization_id=${organizationId} and status<>'archived') valid`),
  ]);
  if (!allowed || !scope.rows[0]?.valid) throw new DomainError("FORBIDDEN");
}

export async function messagingDashboard(actorId: string, organizationId: string, locationId: string) {
  await requireView(actorId, organizationId, locationId);
  const [messages, inbound, campaigns] = await Promise.all([
    db.execute<{ scheduled: number; sent: number; delivered: number; failed: number; undelivered: number; opt_outs: number }>(sql`
      select count(*) filter(where status='scheduled')::int scheduled,count(*) filter(where status='sent')::int sent,
        count(*) filter(where status='delivered')::int delivered,count(*) filter(where status='failed')::int failed,
        count(*) filter(where status='undelivered')::int undelivered,
        (select count(*)::int from sms_consents c where c.organization_id=${organizationId} and c.status='opted_out' and c.effective_at>=now()-interval '30 days') opt_outs
      from sms_messages where organization_id=${organizationId} and pantry_location_id=${locationId} and created_at>=now()-interval '30 days'
    `),
    db.execute<{ confirmations: number; awaiting_review: number }>(sql`select count(*) filter(where normalized_command in('C','CONFIRM','YES','Y'))::int confirmations,count(*) filter(where processing_status='review_required')::int awaiting_review from inbound_messages where organization_id=${organizationId} and pantry_location_id=${locationId} and received_at>=now()-interval '30 days'`),
    db.execute<{ awaiting_approval: number }>(sql`select count(*) filter(where status='awaiting_approval')::int awaiting_approval from message_campaigns where organization_id=${organizationId} and pantry_location_id=${locationId}`),
  ]);
  return { ...(messages.rows[0] ?? { scheduled: 0, sent: 0, delivered: 0, failed: 0, undelivered: 0, opt_outs: 0 }), ...(inbound.rows[0] ?? { confirmations: 0, awaiting_review: 0 }), ...(campaigns.rows[0] ?? { awaiting_approval: 0 }) };
}

export async function listMessageTemplates(actorId: string, organizationId: string, locationId: string) {
  await requireView(actorId, organizationId, locationId, "message.template.view");
  const result = await db.execute<{ id: string; name: string; template_type: string; language: string; body: string; status: string; variables: string[]; is_system_template: boolean; created_at: string }>(sql`select id,name,template_type,language,body,status,variables,is_system_template,created_at::text from message_templates where organization_id=${organizationId} and (pantry_location_id=${locationId} or pantry_location_id is null) and archived_at is null order by name,language`);
  return result.rows;
}

export async function listMessageCampaigns(actorId: string, organizationId: string, locationId: string) {
  await requireView(actorId, organizationId, locationId);
  const result = await db.execute<{ id: string; name: string; campaign_type: string; status: string; scheduled_for: string | null; approved_at: string | null; created_at: string; total: number; delivered: number; failed: number }>(sql`
    select c.id,c.name,c.campaign_type,c.status,c.scheduled_for::text,c.approved_at::text,c.created_at::text,
      count(m.id)::int total,count(m.id) filter(where m.status='delivered')::int delivered,count(m.id) filter(where m.status in('failed','undelivered','excluded'))::int failed
    from message_campaigns c left join sms_messages m on m.campaign_id=c.id where c.organization_id=${organizationId} and c.pantry_location_id=${locationId}
    group by c.id order by c.created_at desc limit 100
  `);
  return result.rows;
}

export async function getMessageCampaign(actorId: string, organizationId: string, locationId: string, campaignId: string) {
  await requireView(actorId, organizationId, locationId);
  const result = await db.execute<Record<string, unknown>>(sql`select * from message_campaigns where id=${campaignId} and organization_id=${organizationId} and pantry_location_id=${locationId}`);
  if (!result.rows[0]) return null;
  const exclusions = await db.execute<{ exclusion_reason: string; total: number }>(sql`select exclusion_reason,count(*)::int total from message_recipient_exclusions where campaign_id=${campaignId} group by exclusion_reason order by exclusion_reason`);
  return { campaign: result.rows[0], exclusions: exclusions.rows };
}

export async function listMessageHistory(actorId: string, organizationId: string, locationId: string, status?: string) {
  await requireView(actorId, organizationId, locationId, "message.view_delivery");
  const result = await db.execute<{ id: string; message_type: string; status: string; to_phone_number: string; body_snapshot: string; provider: string; attempt_count: number; scheduled_for: string | null; sent_at: string | null; delivered_at: string | null; failed_at: string | null; provider_error_code: string | null; provider_error_message: string | null; created_at: string }>(sql`select id,message_type,status,to_phone_number,body_snapshot,provider,attempt_count,scheduled_for::text,sent_at::text,delivered_at::text,failed_at::text,provider_error_code,provider_error_message,created_at::text from sms_messages where organization_id=${organizationId} and pantry_location_id=${locationId} and (${status ?? ""}='' or status=${status ?? ""}) order by created_at desc limit 200`);
  return result.rows;
}

export async function listInboundMessages(actorId: string, organizationId: string, locationId: string) {
  await requireView(actorId, organizationId, locationId, "message.view_inbound");
  const result = await db.execute<{ id: string; from_phone_number: string; body: string; normalized_command: string | null; processing_status: string; linked_appointment_id: string | null; received_at: string; household_display_name: string | null }>(sql`select i.id,i.from_phone_number,i.body,i.normalized_command,i.processing_status,i.linked_appointment_id,i.received_at::text,h.display_name household_display_name from inbound_messages i left join households h on h.id=i.household_id and h.organization_id=i.organization_id where i.organization_id=${organizationId} and i.pantry_location_id=${locationId} order by i.received_at desc limit 200`);
  return result.rows;
}

export async function getMessagingSettings(actorId: string, organizationId: string, locationId: string) {
  await requireView(actorId, organizationId, locationId, "message.settings.view");
  const result = await db.execute<Record<string, unknown>>(sql`select id,provider,sending_mode,default_from_number,default_language,quiet_hours_start::text,quiet_hours_end::text,reminder_hours_before,retry_limit,simulation_recipient,help_response,is_enabled,updated_at::text from sms_settings where organization_id=${organizationId} and pantry_location_id=${locationId}`);
  return result.rows[0] ?? null;
}

export async function listMessagingContacts(actorId: string, organizationId: string, locationId: string) {
  await requireView(actorId, organizationId, locationId, "message.send_individual");
  const result = await db.execute<{ id: string; name: string; display_name: string; phone_normalized: string | null; consent_status: string | null; preferred_language: string }>(sql`
    select hc.id,hc.name,h.display_name,hc.phone_normalized,sc.status::text consent_status,coalesce(hc.preferred_language,h.preferred_language,'en') preferred_language
    from household_contacts hc join households h on h.id=hc.household_id and h.organization_id=hc.organization_id
    left join lateral(select status from sms_consents c where c.organization_id=h.organization_id and c.household_id=h.id and c.phone_normalized=hc.phone_normalized and (c.household_contact_id=hc.id or c.household_contact_id is null) order by c.effective_at desc,c.created_at desc limit 1) sc on true
    where h.organization_id=${organizationId} and h.status='active' and h.default_pantry_location_id=${locationId} and hc.is_active and hc.archived_at is null
    order by h.display_name,hc.name
  `);
  return result.rows;
}
