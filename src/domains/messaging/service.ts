import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { hasLocationPermission } from "@/lib/database/authorization";
import { DomainError } from "@/lib/errors";
import {
  calculateSmsSegments,
  canAdvanceProviderStatus,
  canTransitionCampaign,
  deduplicateRecipients,
  deterministicUuid,
  evaluateSmsRecipientEligibility,
  isRetryEligible,
  isWithinQuietHours,
  normalizeInboundText,
  normalizePhoneNumber,
  parseInboundIntent,
  renderMessageTemplate,
  retryDelaySeconds,
} from "@/domains/messaging/policy";
import { providerForMode, providerHasCredentials, type InboundSmsEvent, type SmsStatusEvent, type SmsProviderId } from "@/domains/messaging/provider";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Pick<typeof db, "execute">;

export type MessagingSettings = {
  id: string;
  organization_id: string;
  pantry_location_id: string;
  provider: string;
  sending_mode: string;
  default_from_number: string | null;
  default_language: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  reminder_hours_before: number;
  retry_limit: number;
  simulation_recipient: string | null;
  help_response: string;
  is_enabled: boolean;
  created_by: string;
  timezone: string;
};

type ContactRecipient = {
  contact_id: string;
  household_id: string;
  organization_id: string;
  household_status: string;
  default_pantry_location_id: string | null;
  contact_active: boolean;
  contact_archived_at: string | null;
  phone_number: string | null;
  phone_normalized: string | null;
  preferred_language: string | null;
  consent_id: string | null;
  consent_status: string | null;
  display_name: string;
  contact_name: string;
};

async function requireLocationScope(executor: Executor, actorId: string, organizationId: string, locationId: string, permission: string) {
  const [allowed, scope] = await Promise.all([
    hasLocationPermission(executor, actorId, locationId, permission),
    executor.execute<{ valid: boolean }>(sql`select exists(select 1 from pantry_locations where id=${locationId} and organization_id=${organizationId} and status<>'archived') valid`),
  ]);
  if (!allowed || !scope.rows[0]?.valid) throw new DomainError("FORBIDDEN");
}

async function requireAnyLocationPermission(executor: Executor, actorId: string, organizationId: string, locationId: string, permissions: string[]) {
  const scope = await executor.execute<{ valid: boolean }>(sql`select exists(select 1 from pantry_locations where id=${locationId} and organization_id=${organizationId} and status<>'archived') valid`);
  if (!scope.rows[0]?.valid) throw new DomainError("FORBIDDEN");
  for (const permission of permissions) if (await hasLocationPermission(executor, actorId, locationId, permission)) return;
  throw new DomainError("FORBIDDEN");
}

async function writeAudit(tx: Transaction, actorId: string, organizationId: string, locationId: string, action: string, entityType: string, entityId: string, requestId: string, values: Record<string, unknown> = {}) {
  const membership = await tx.execute<{ id: string }>(sql`select id from organization_memberships where user_id=${actorId} and organization_id=${organizationId} and status='active' and archived_at is null limit 1`);
  await tx.execute(sql`insert into audit_logs(organization_id,location_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,request_id,new_values) values(${organizationId},${locationId},${actorId},${membership.rows[0]?.id ?? null},${action},${entityType},${entityId},${requestId},${JSON.stringify(values)}::jsonb)`);
}

async function settingsFor(executor: Executor, organizationId: string, locationId: string) {
  const result = await executor.execute<MessagingSettings>(sql`
    select s.*,coalesce(l.timezone,o.timezone,'UTC') timezone
    from sms_settings s join pantry_locations l on l.id=s.pantry_location_id and l.organization_id=s.organization_id
    join organizations o on o.id=s.organization_id
    where s.organization_id=${organizationId} and s.pantry_location_id=${locationId}
  `);
  return result.rows[0] ?? null;
}

async function contactRecipient(executor: Executor, organizationId: string, contactId: string) {
  const result = await executor.execute<ContactRecipient>(sql`
    select hc.id contact_id,h.id household_id,h.organization_id,h.status household_status,h.default_pantry_location_id,
      hc.is_active contact_active,hc.archived_at::text contact_archived_at,hc.phone_number,hc.phone_normalized,
      coalesce(hc.preferred_language,h.preferred_language,'en') preferred_language,sc.id consent_id,sc.status::text consent_status,
      h.display_name,hc.name contact_name
    from household_contacts hc join households h on h.id=hc.household_id and h.organization_id=hc.organization_id
    left join lateral(select id,status from sms_consents c where c.organization_id=h.organization_id and c.household_id=h.id
      and c.phone_normalized=hc.phone_normalized and (c.household_contact_id=hc.id or c.household_contact_id is null)
      order by c.effective_at desc,c.created_at desc limit 1) sc on true
    where hc.id=${contactId} and hc.organization_id=${organizationId}
  `);
  return result.rows[0] ?? null;
}

export async function saveMessagingSettings(actorId: string, organizationId: string, locationId: string, values: {
  provider?: SmsProviderId;
  sendingMode: "disabled" | "simulation" | "live";
  defaultFromNumber?: string | null;
  defaultLanguage: string;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  reminderHoursBefore: number;
  retryLimit: number;
  helpResponse: string;
  isEnabled: boolean;
  confirmLive?: boolean;
}, requestId: string) {
  return db.transaction(async (tx) => {
    const provider = values.provider ?? "twilio";
    await requireLocationScope(tx, actorId, organizationId, locationId, "message.settings.manage");
    if (values.sendingMode === "live" && (!values.confirmLive || !providerHasCredentials(provider) || (!values.defaultFromNumber && provider !== "aws_sns"))) throw new DomainError("SMS_LIVE_CONFIGURATION_REQUIRED");
    if (values.reminderHoursBefore < 1 || values.reminderHoursBefore > 168 || values.retryLimit < 0 || values.retryLimit > 10) throw new DomainError("VALIDATION_ERROR");
    const from = values.defaultFromNumber ? normalizePhoneNumber(values.defaultFromNumber) : null;
    if (values.defaultFromNumber && !from) throw new DomainError("CONSENT_INVALID");
    const result = await tx.execute<{ id: string }>(sql`
      insert into sms_settings(organization_id,pantry_location_id,provider,sending_mode,default_from_number,default_language,quiet_hours_start,quiet_hours_end,reminder_hours_before,retry_limit,help_response,is_enabled,created_by)
      values(${organizationId},${locationId},${provider},${values.sendingMode},${from},${values.defaultLanguage},${values.quietHoursStart || null},${values.quietHoursEnd || null},${values.reminderHoursBefore},${values.retryLimit},${values.helpResponse},${values.isEnabled},${actorId})
      on conflict(organization_id,pantry_location_id) do update set provider=excluded.provider,sending_mode=excluded.sending_mode,default_from_number=excluded.default_from_number,
        default_language=excluded.default_language,quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,
        reminder_hours_before=excluded.reminder_hours_before,retry_limit=excluded.retry_limit,help_response=excluded.help_response,is_enabled=excluded.is_enabled,updated_at=now()
      returning id
    `);
    await writeAudit(tx, actorId, organizationId, locationId, "message.settings.updated", "sms_settings", result.rows[0].id, requestId, { provider, sendingMode: values.sendingMode, enabled: values.isEnabled });
    return result.rows[0];
  });
}

export async function createMessageTemplate(actorId: string, organizationId: string, locationId: string, values: { name: string; templateType: string; language: string; body: string }, requestId: string) {
  return db.transaction(async (tx) => {
    await requireLocationScope(tx, actorId, organizationId, locationId, "message.template.create");
    const rendered = renderMessageTemplate(values.body, {});
    if (!values.name.trim() || !values.body.trim() || rendered.segments > 10) throw new DomainError("VALIDATION_ERROR");
    const result = await tx.execute<{ id: string }>(sql`insert into message_templates(organization_id,pantry_location_id,name,template_type,language,body,variables,created_by) values(${organizationId},${locationId},${values.name.trim()},${values.templateType},${values.language},${values.body},${JSON.stringify(rendered.usedVariables)}::jsonb,${actorId}) returning id`);
    await writeAudit(tx, actorId, organizationId, locationId, "message.template.created", "message_template", result.rows[0].id, requestId, { name: values.name, templateType: values.templateType });
    return result.rows[0];
  });
}

export async function archiveMessageTemplate(actorId: string, organizationId: string, locationId: string, templateId: string, requestId: string) {
  return db.transaction(async (tx) => {
    await requireLocationScope(tx, actorId, organizationId, locationId, "message.template.archive");
    const result = await tx.execute<{ id: string }>(sql`update message_templates set status='archived',archived_at=now(),updated_at=now() where id=${templateId} and organization_id=${organizationId} and (pantry_location_id=${locationId} or pantry_location_id is null) and archived_at is null returning id`);
    if (!result.rows[0]) throw new DomainError("NOT_FOUND");
    await writeAudit(tx, actorId, organizationId, locationId, "message.template.archived", "message_template", templateId, requestId);
  });
}

export async function updateMessageTemplate(actorId: string, organizationId: string, locationId: string, templateId: string, values: { name: string; templateType: string; language: string; body: string }, requestId: string) {
  return db.transaction(async (tx) => {
    await requireLocationScope(tx, actorId, organizationId, locationId, "message.template.update");
    const rendered = renderMessageTemplate(values.body, {});
    if (!values.name.trim() || !values.body.trim() || rendered.segments > 10) throw new DomainError("VALIDATION_ERROR");
    const result = await tx.execute<{ id: string }>(sql`update message_templates set name=${values.name.trim()},template_type=${values.templateType},language=${values.language},body=${values.body},variables=${JSON.stringify(rendered.usedVariables)}::jsonb,updated_at=now() where id=${templateId} and organization_id=${organizationId} and pantry_location_id=${locationId} and is_system_template=false and archived_at is null returning id`);
    if (!result.rows[0]) throw new DomainError("NOT_FOUND");
    await writeAudit(tx, actorId, organizationId, locationId, "message.template.updated", "message_template", templateId, requestId, { name: values.name, templateType: values.templateType });
  });
}

export type IndividualMessageInput = {
  contactId: string;
  body?: string;
  templateId?: string | null;
  variables?: Record<string, string>;
  language?: string;
  scheduledFor?: Date | null;
  idempotencyKey: string;
};

export async function previewIndividualMessage(actorId: string, organizationId: string, locationId: string, input: IndividualMessageInput) {
  await requireAnyLocationPermission(db, actorId, organizationId, locationId, ["message.draft", "message.send_individual"]);
  const recipient = await contactRecipient(db, organizationId, input.contactId);
  if (!recipient) throw new DomainError("NOT_FOUND");
  const eligibility = evaluateSmsRecipientEligibility({
    phoneNumber: recipient.phone_normalized ?? recipient.phone_number,
    consentId: recipient.consent_id,
    consentStatus: recipient.consent_status,
    householdStatus: recipient.household_status,
    contactActive: recipient.contact_active,
    contactArchived: Boolean(recipient.contact_archived_at),
    contactOrganizationId: recipient.organization_id,
    expectedOrganizationId: organizationId,
    contactLocationId: recipient.default_pantry_location_id,
    expectedLocationId: locationId,
    preferredLanguage: recipient.preferred_language,
  });
  let templateBody = input.body ?? "";
  if (input.templateId) {
    const template = await db.execute<{ body: string; language: string }>(sql`select body,language from message_templates where id=${input.templateId} and organization_id=${organizationId} and (pantry_location_id=${locationId} or pantry_location_id is null) and status='active' and archived_at is null`);
    if (!template.rows[0]) throw new DomainError("NOT_FOUND");
    templateBody = template.rows[0].body;
  }
  const rendered = renderMessageTemplate(templateBody, input.variables ?? {});
  if (!rendered.body.trim() || rendered.missingVariables.length || rendered.segments > 10) throw new DomainError(rendered.missingVariables.length ? "MESSAGE_TEMPLATE_VARIABLE_MISSING" : "VALIDATION_ERROR");
  return { recipient, eligibility, body: rendered.body, language: input.language ?? eligibility.preferredLanguage, segments: rendered.segments, characters: rendered.characters, encoding: rendered.encoding };
}

export async function sendIndividualMessage(actorId: string, organizationId: string, locationId: string, input: IndividualMessageInput & { confirmed: boolean }, requestId: string) {
  if (!input.confirmed) throw new DomainError("MESSAGE_CONFIRMATION_REQUIRED");
  await requireLocationScope(db, actorId, organizationId, locationId, input.scheduledFor && input.scheduledFor > new Date() ? "message.schedule" : "message.send_individual");
  const preview = await previewIndividualMessage(actorId, organizationId, locationId, input);
  if (!preview.eligibility.eligible || !preview.eligibility.normalizedPhoneNumber) throw new DomainError("MESSAGE_RECIPIENT_INELIGIBLE");
  const settings = await settingsFor(db, organizationId, locationId);
  if (!settings || !settings.is_enabled || settings.sending_mode === "disabled") throw new DomainError("SMS_DISABLED");
  const scheduled = input.scheduledFor && input.scheduledFor > new Date();
  const result = await db.transaction(async (tx) => {
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into sms_messages(organization_id,pantry_location_id,household_id,household_contact_id,consent_id,direction,message_type,status,to_phone_number,from_phone_number,body_snapshot,language,scheduled_for,queued_at,provider,idempotency_key,created_by)
      values(${organizationId},${locationId},${preview.recipient.household_id},${preview.recipient.contact_id},${preview.eligibility.consentId},'outbound','individual_message',${scheduled ? "scheduled" : "queued"},${preview.eligibility.normalizedPhoneNumber},${settings.default_from_number},${preview.body},${preview.language},${input.scheduledFor ?? null},${scheduled ? null : new Date()},${settings.sending_mode === "simulation" ? "simulation" : settings.provider},${input.idempotencyKey},${actorId})
      on conflict(organization_id,idempotency_key) do nothing returning id
    `);
    const id = inserted.rows[0]?.id ?? (await tx.execute<{ id: string }>(sql`select id from sms_messages where organization_id=${organizationId} and idempotency_key=${input.idempotencyKey}`)).rows[0]?.id;
    if (!id) throw new DomainError("IDEMPOTENCY_CONFLICT");
    await writeAudit(tx, actorId, organizationId, locationId, scheduled ? "message.scheduled" : "message.queued", "sms_message", id, requestId, { segments: preview.segments, mode: settings.sending_mode });
    return { id, scheduled };
  });
  if (!result.scheduled) await dispatchMessage(result.id);
  return result;
}

async function claimMessageForDispatch(messageId: string) {
  return db.transaction(async (tx) => {
    const message = await tx.execute<Record<string, unknown>>(sql`
      select m.*,s.provider,s.sending_mode,s.default_from_number,s.quiet_hours_start::text,s.quiet_hours_end::text,s.retry_limit,s.is_enabled,mc.status campaign_status,
        coalesce(l.timezone,o.timezone,'UTC') timezone,h.status household_status,h.default_pantry_location_id,hc.is_active contact_active,hc.archived_at contact_archived_at,
        sc.id current_consent_id,sc.status::text current_consent_status
      from sms_messages m join sms_settings s on s.organization_id=m.organization_id and s.pantry_location_id=m.pantry_location_id
      join pantry_locations l on l.id=m.pantry_location_id join organizations o on o.id=m.organization_id
      left join message_campaigns mc on mc.id=m.campaign_id
      left join households h on h.id=m.household_id and h.organization_id=m.organization_id
      left join household_contacts hc on hc.id=m.household_contact_id
      left join lateral(select id,status from sms_consents c where c.organization_id=m.organization_id and c.phone_normalized=m.to_phone_number and (c.household_contact_id=m.household_contact_id or c.household_contact_id is null) order by c.effective_at desc,c.created_at desc limit 1) sc on true
      where m.id=${messageId} for update of m
    `);
    const row = message.rows[0];
    if (!row) throw new DomainError("NOT_FOUND");
    if (!["queued", "scheduled"].includes(String(row.status))) return null;
    if (row.scheduled_for && new Date(String(row.scheduled_for)) > new Date()) return null;
    if (row.campaign_status === "cancelled") {
      await tx.execute(sql`update sms_messages set status='cancelled',updated_at=now() where id=${messageId}`);
      return null;
    }
    if (!row.is_enabled || row.sending_mode === "disabled") {
      await tx.execute(sql`update sms_messages set status='failed',failed_at=now(),provider_error_code='SMS_DISABLED',provider_error_message='Messaging is disabled.',updated_at=now() where id=${messageId}`);
      return null;
    }
    const eligibility = evaluateSmsRecipientEligibility({ phoneNumber: String(row.to_phone_number), consentId: row.current_consent_id ? String(row.current_consent_id) : null, consentStatus: row.current_consent_status ? String(row.current_consent_status) : null, householdStatus: row.household_status ? String(row.household_status) : null, contactActive: row.contact_active === true, contactArchived: Boolean(row.contact_archived_at), contactOrganizationId: String(row.organization_id), expectedOrganizationId: String(row.organization_id), contactLocationId: row.default_pantry_location_id ? String(row.default_pantry_location_id) : null, expectedLocationId: String(row.pantry_location_id) });
    if (!eligibility.eligible || !eligibility.normalizedPhoneNumber) {
      await tx.execute(sql`update sms_messages set status='excluded',provider_error_code=${eligibility.exclusionReason},provider_error_message='Recipient failed send-time eligibility.',updated_at=now() where id=${messageId}`);
      return null;
    }
    if (isWithinQuietHours(new Date(), row.quiet_hours_start ? String(row.quiet_hours_start) : null, row.quiet_hours_end ? String(row.quiet_hours_end) : null, String(row.timezone))) {
      await tx.execute(sql`update sms_messages set status='scheduled',scheduled_for=now()+interval '30 minutes',updated_at=now() where id=${messageId}`);
      return null;
    }
    await tx.execute(sql`update sms_messages set status='sending',queued_at=coalesce(queued_at,now()),attempt_count=attempt_count+1,updated_at=now() where id=${messageId}`);
    return {
      organization_id: String(row.organization_id),
      pantry_location_id: String(row.pantry_location_id),
      provider: String(row.provider),
      sending_mode: String(row.sending_mode),
      to_phone_number: eligibility.normalizedPhoneNumber,
      body_snapshot: String(row.body_snapshot),
      default_from_number: row.default_from_number ? String(row.default_from_number) : null,
      idempotency_key: String(row.idempotency_key),
      attempt_count: Number(row.attempt_count) + 1,
    };
  });
}

export async function dispatchMessage(messageId: string) {
  const row = await claimMessageForDispatch(messageId);
  if (!row) return null;
  const mode = String(row.sending_mode);
  const result = await providerForMode(mode, String(row.provider)).sendMessage({ to: String(row.to_phone_number), body: String(row.body_snapshot), from: row.default_from_number ? String(row.default_from_number) : null, idempotencyKey: String(row.idempotency_key) });
  await db.transaction(async (tx) => {
    await tx.execute(sql`update sms_messages set status=${result.status},provider=${result.provider},provider_message_id=coalesce(${result.providerMessageId},provider_message_id),provider_error_code=${result.errorCode ?? null},provider_error_message=${result.errorMessage ?? null},sent_at=case when ${result.status} in('sent','delivered') then coalesce(sent_at,now()) else sent_at end,delivered_at=case when ${result.status}='delivered' then coalesce(delivered_at,now()) else delivered_at end,failed_at=case when ${result.status}='failed' then now() else null end,updated_at=now() where id=${messageId}`);
    await tx.execute(sql`insert into sms_events(organization_id,pantry_location_id,sms_message_id,provider_event_id,event_type,provider_status,payload_snapshot,processed_at) values(${String(row.organization_id)},${String(row.pantry_location_id)},${messageId},${deterministicUuid(`send:${messageId}:${row.attempt_count}`)},'send_attempt',${result.status},${JSON.stringify({ simulated: result.simulated, errorCode: result.errorCode ?? null })}::jsonb,now()) on conflict(organization_id,provider_event_id) do nothing`);
  });
  return result;
}

export async function retryFailedMessage(actorId: string, organizationId: string, locationId: string, messageId: string, requestId: string) {
  await requireLocationScope(db, actorId, organizationId, locationId, "message.retry_failed");
  const result = await db.execute<{ status: string; attempt_count: number; retry_limit: number; provider_error_code: string | null; consent_status: string | null }>(sql`
    select m.status,m.attempt_count,s.retry_limit,m.provider_error_code,sc.status::text consent_status
    from sms_messages m join sms_settings s on s.organization_id=m.organization_id and s.pantry_location_id=m.pantry_location_id
    left join lateral(select status from sms_consents c where c.organization_id=m.organization_id and c.phone_normalized=m.to_phone_number order by c.effective_at desc,c.created_at desc limit 1) sc on true
    where m.id=${messageId} and m.organization_id=${organizationId} and m.pantry_location_id=${locationId}
  `);
  const row = result.rows[0];
  if (!row) throw new DomainError("NOT_FOUND");
  if (!isRetryEligible({ status: row.status, attemptCount: row.attempt_count, retryLimit: row.retry_limit, providerErrorCode: row.provider_error_code, consentStatus: row.consent_status })) throw new DomainError("MESSAGE_RETRY_NOT_ALLOWED");
  await db.transaction(async (tx) => {
    await tx.execute(sql`update sms_messages set status='queued',scheduled_for=null,updated_at=now() where id=${messageId}`);
    await writeAudit(tx, actorId, organizationId, locationId, "message.retry_requested", "sms_message", messageId, requestId, { attemptCount: row.attempt_count });
  });
  return dispatchMessage(messageId);
}

export async function processStatusWebhook(event: SmsStatusEvent) {
  const message = await db.execute<{ id: string; organization_id: string; pantry_location_id: string; status: string }>(sql`select id,organization_id,pantry_location_id,status from sms_messages where provider='twilio' and provider_message_id=${event.providerMessageId} limit 1`);
  const row = message.rows[0];
  if (!row) return { found: false, updated: false };
  return db.transaction(async (tx) => {
    const inserted = await tx.execute<{ id: string }>(sql`insert into sms_events(organization_id,pantry_location_id,sms_message_id,provider_event_id,event_type,provider_status,payload_snapshot,received_at,processed_at) values(${row.organization_id},${row.pantry_location_id},${row.id},${event.providerEventId},'provider_status',${event.status},${JSON.stringify(event.payload)}::jsonb,now(),now()) on conflict(organization_id,provider_event_id) do nothing returning id`);
    if (!inserted.rows[0]) return { found: true, updated: false };
    const locked = await tx.execute<{ status: string }>(sql`select status from sms_messages where id=${row.id} for update`);
    const current = locked.rows[0]?.status ?? row.status;
    if (!canAdvanceProviderStatus(current, event.status)) return { found: true, updated: false };
    await tx.execute(sql`update sms_messages set status=${event.status},provider_error_code=${event.errorCode},provider_error_message=${event.errorMessage},sent_at=case when ${event.status} in('sent','delivered') then coalesce(sent_at,now()) else sent_at end,delivered_at=case when ${event.status}='delivered' then coalesce(delivered_at,now()) else delivered_at end,failed_at=case when ${event.status} in('failed','undelivered') then now() else failed_at end,updated_at=now() where id=${row.id}`);
    return { found: true, updated: true };
  });
}

export type CampaignAudience = {
  appointmentDate?: string | null;
  appointmentStatus?: string | null;
  preferredLanguage?: string | null;
  selectedHouseholdIds?: string[];
};

type AudienceRecipient = ContactRecipient & { appointment_status: string | null };

async function audienceRows(organizationId: string, locationId: string, audience: CampaignAudience) {
  const selected = audience.selectedHouseholdIds?.join(",") ?? "";
  const result = await db.execute<AudienceRecipient>(sql`
    select hc.id contact_id,h.id household_id,h.organization_id,h.status household_status,h.default_pantry_location_id,
      hc.is_active contact_active,hc.archived_at::text contact_archived_at,hc.phone_number,hc.phone_normalized,
      coalesce(hc.preferred_language,h.preferred_language,'en') preferred_language,sc.id consent_id,sc.status::text consent_status,
      h.display_name,hc.name contact_name,ap.status::text appointment_status
    from households h join household_contacts hc on hc.household_id=h.id and hc.organization_id=h.organization_id and hc.is_active and hc.archived_at is null
    left join lateral(select a.status,a.scheduled_start_at from appointments a where a.organization_id=h.organization_id and a.household_id=h.id and a.pantry_location_id=${locationId}
      and (${audience.appointmentDate ?? ""}='' or a.scheduled_start_at::date=${audience.appointmentDate ?? "1970-01-01"}::date)
      and (${audience.appointmentStatus ?? ""}='' or a.status::text=${audience.appointmentStatus ?? ""}) order by a.scheduled_start_at desc limit 1) ap on true
    left join lateral(select id,status from sms_consents c where c.organization_id=h.organization_id and c.household_id=h.id and c.phone_normalized=hc.phone_normalized and (c.household_contact_id=hc.id or c.household_contact_id is null) order by c.effective_at desc,c.created_at desc limit 1) sc on true
    where h.organization_id=${organizationId} and h.status='active'
      and (h.default_pantry_location_id=${locationId} or ap.status is not null)
      and (${audience.appointmentDate ?? ""}='' or ap.status is not null)
      and (${audience.preferredLanguage ?? ""}='' or coalesce(hc.preferred_language,h.preferred_language,'en')=${audience.preferredLanguage ?? ""})
      and (${selected}='' or h.id::text=any(string_to_array(${selected},',')))
    order by h.display_name,hc.contact_type,hc.created_at
  `);
  return result.rows;
}

export async function previewCampaignAudience(actorId: string, organizationId: string, locationId: string, audience: CampaignAudience) {
  await requireAnyLocationPermission(db, actorId, organizationId, locationId, ["message.draft", "message.send_bulk", "message.approve_bulk"]);
  const rows = deduplicateRecipients((await audienceRows(organizationId, locationId, audience)).map((row) => ({ ...row, phoneNumber: row.phone_normalized ?? row.phone_number })));
  const recipients = rows.map((row) => ({
    ...row,
    eligibility: evaluateSmsRecipientEligibility({
      phoneNumber: row.phoneNumber,
      consentId: row.consent_id,
      consentStatus: row.consent_status,
      householdStatus: row.household_status,
      contactActive: row.contact_active,
      contactArchived: Boolean(row.contact_archived_at),
      contactOrganizationId: row.organization_id,
      expectedOrganizationId: organizationId,
      contactLocationId: row.default_pantry_location_id,
      expectedLocationId: locationId,
      duplicate: row.duplicate,
      appointmentStatus: audience.appointmentDate ? row.appointment_status : null,
      preferredLanguage: row.preferred_language,
    }),
  }));
  const exclusions = recipients.filter((row) => !row.eligibility.eligible);
  const byReason = Object.fromEntries([...new Set(exclusions.map((row) => row.eligibility.exclusionReason ?? "other"))].map((reason) => [reason, exclusions.filter((row) => row.eligibility.exclusionReason === reason).length]));
  return { matched: recipients.length, eligible: recipients.filter((row) => row.eligibility.eligible), exclusions, byReason };
}

export async function createMessageCampaign(actorId: string, organizationId: string, locationId: string, values: { name: string; campaignType: string; body: string; templateId?: string | null; audience: CampaignAudience; scheduledFor?: Date | null; idempotencyKey: string }, requestId: string) {
  await requireLocationScope(db, actorId, organizationId, locationId, "message.draft");
  const segments = calculateSmsSegments(values.body);
  if (!values.name.trim() || !values.body.trim() || segments.segments > 10) throw new DomainError("VALIDATION_ERROR");
  return db.transaction(async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`insert into message_campaigns(organization_id,pantry_location_id,name,campaign_type,status,template_id,audience_definition,message_body_snapshot,scheduled_for,created_by,idempotency_key) values(${organizationId},${locationId},${values.name.trim()},${values.campaignType},'draft',${values.templateId ?? null},${JSON.stringify(values.audience)}::jsonb,${values.body},${values.scheduledFor ?? null},${actorId},${values.idempotencyKey}) on conflict(organization_id,idempotency_key) do nothing returning id`);
    const id = result.rows[0]?.id ?? (await tx.execute<{ id: string }>(sql`select id from message_campaigns where organization_id=${organizationId} and idempotency_key=${values.idempotencyKey}`)).rows[0]?.id;
    if (!id) throw new DomainError("IDEMPOTENCY_CONFLICT");
    await writeAudit(tx, actorId, organizationId, locationId, "message.campaign.created", "message_campaign", id, requestId, { name: values.name, segments: segments.segments });
    return { id };
  });
}

export async function transitionMessageCampaign(actorId: string, organizationId: string, locationId: string, campaignId: string, target: "awaiting_approval" | "approved" | "cancelled", reason: string | null, requestId: string) {
  const permission = target === "approved" ? "message.approve_bulk" : target === "cancelled" ? "message.cancel_scheduled" : "message.draft";
  return db.transaction(async (tx) => {
    await requireLocationScope(tx, actorId, organizationId, locationId, permission);
    const result = await tx.execute<{ status: string; created_by: string }>(sql`select status,created_by from message_campaigns where id=${campaignId} and organization_id=${organizationId} and pantry_location_id=${locationId} for update`);
    const campaign = result.rows[0];
    if (!campaign) throw new DomainError("NOT_FOUND");
    if (!canTransitionCampaign(campaign.status, target)) throw new DomainError("MESSAGE_CAMPAIGN_INVALID_STATE");
    if (target === "cancelled" && (!reason || reason.trim().length < 3)) throw new DomainError("REASON_REQUIRED");
    await tx.execute(sql`update message_campaigns set status=${target},approved_by=case when ${target}='approved' then ${actorId} else approved_by end,approved_at=case when ${target}='approved' then now() else approved_at end,cancelled_by=case when ${target}='cancelled' then ${actorId} else cancelled_by end,cancelled_at=case when ${target}='cancelled' then now() else cancelled_at end,cancellation_reason=case when ${target}='cancelled' then ${reason} else cancellation_reason end,updated_at=now() where id=${campaignId}`);
    if (target === "cancelled") await tx.execute(sql`update sms_messages set status='cancelled',updated_at=now() where campaign_id=${campaignId} and status in('draft','scheduled','queued','accepted')`);
    await writeAudit(tx, actorId, organizationId, locationId, `message.campaign.${target}`, "message_campaign", campaignId, requestId, { reason });
  });
}

export async function sendMessageCampaign(actorId: string, organizationId: string, locationId: string, campaignId: string, requestId: string) {
  await requireLocationScope(db, actorId, organizationId, locationId, "message.send_bulk");
  const campaignResult = await db.execute<{ id: string; status: string; audience_definition: CampaignAudience; message_body_snapshot: string; scheduled_for: string | null }>(sql`select id,status,audience_definition,message_body_snapshot,scheduled_for::text from message_campaigns where id=${campaignId} and organization_id=${organizationId} and pantry_location_id=${locationId}`);
  const campaign = campaignResult.rows[0];
  if (!campaign || !["approved", "scheduled", "partially_sent", "failed"].includes(campaign.status)) throw new DomainError(campaign ? "MESSAGE_CAMPAIGN_INVALID_STATE" : "NOT_FOUND");
  const preview = await previewCampaignAudience(actorId, organizationId, locationId, campaign.audience_definition);
  const settings = await settingsFor(db, organizationId, locationId);
  if (!settings || !settings.is_enabled || settings.sending_mode === "disabled") throw new DomainError("SMS_DISABLED");
  const beganSending = await db.transaction(async (tx) => {
    const locked = await tx.execute<{ status: string }>(sql`select status from message_campaigns where id=${campaignId} for update`);
    if (locked.rows[0]?.status === "cancelled" || locked.rows[0]?.status === "sent") return false;
    await tx.execute(sql`update message_campaigns set status='sending',updated_at=now() where id=${campaignId}`);
    await tx.execute(sql`delete from message_recipient_exclusions where campaign_id=${campaignId}`);
    for (const row of preview.exclusions) await tx.execute(sql`insert into message_recipient_exclusions(campaign_id,household_id,contact_id,phone_number,exclusion_reason) values(${campaignId},${row.household_id},${row.contact_id},${row.normalizedPhoneNumber},${row.eligibility.exclusionReason ?? "other"})`);
    for (const row of preview.eligible) {
      if (!row.eligibility.normalizedPhoneNumber) continue;
      const idempotency = deterministicUuid(`campaign:${campaignId}:${row.eligibility.normalizedPhoneNumber}`);
      await tx.execute(sql`insert into sms_messages(organization_id,pantry_location_id,campaign_id,household_id,household_contact_id,consent_id,direction,message_type,status,to_phone_number,from_phone_number,body_snapshot,language,scheduled_for,queued_at,provider,idempotency_key,created_by) values(${organizationId},${locationId},${campaignId},${row.household_id},${row.contact_id},${row.eligibility.consentId},'outbound','bulk_announcement',${campaign.scheduled_for && new Date(campaign.scheduled_for)>new Date() ? "scheduled" : "queued"},${row.eligibility.normalizedPhoneNumber},${settings.default_from_number},${campaign.message_body_snapshot},${row.eligibility.preferredLanguage},${campaign.scheduled_for},${campaign.scheduled_for ? null : new Date()},${settings.sending_mode === "simulation" ? "simulation" : settings.provider},${idempotency},${actorId}) on conflict(organization_id,idempotency_key) do nothing`);
    }
    await writeAudit(tx, actorId, organizationId, locationId, "message.campaign.send_started", "message_campaign", campaignId, requestId, { eligible: preview.eligible.length, excluded: preview.exclusions.length });
    return true;
  });
  if (!beganSending) throw new DomainError("MESSAGE_CAMPAIGN_INVALID_STATE");
  const futureSchedule = Boolean(campaign.scheduled_for && new Date(campaign.scheduled_for) > new Date());
  if (futureSchedule) {
    await db.execute(sql`update message_campaigns set status='scheduled',updated_at=now() where id=${campaignId} and status='sending'`);
    return { total: preview.eligible.length, completed: 0, failed: 0, status: "scheduled", excluded: preview.exclusions.length };
  }
  const dispatchable = await db.execute<{ id: string }>(sql`select id from sms_messages where campaign_id=${campaignId} and status='queued' order by created_at limit 100`);
  for (const row of dispatchable.rows) await dispatchMessage(row.id);
  const metrics = await db.execute<{ total: number; completed: number; failed: number }>(sql`select count(*)::int total,count(*) filter(where status in('sent','delivered'))::int completed,count(*) filter(where status in('failed','undelivered','excluded'))::int failed from sms_messages where campaign_id=${campaignId}`);
  const row = metrics.rows[0] ?? { total: 0, completed: 0, failed: 0 };
  const nextStatus = row.total === 0 ? "failed" : row.completed + row.failed < row.total ? "partially_sent" : row.failed > 0 ? "partially_sent" : "sent";
  await db.execute(sql`update message_campaigns set status=${nextStatus},updated_at=now() where id=${campaignId} and status='sending'`);
  return { ...row, status: nextStatus, excluded: preview.exclusions.length };
}

function inboundResponse(intent: ReturnType<typeof parseInboundIntent>, helpResponse: string, recognizedContact: boolean, activeConsent: boolean) {
  if (intent === "stop") return "You have been opted out. Reply START to request messages again.";
  if (intent === "start") return recognizedContact ? "Your request to receive pantry messages was recorded. Reply STOP to opt out." : "We could not match this number. Please contact the pantry for help.";
  if (intent === "help") return helpResponse;
  if (intent === "confirm" && activeConsent) return "Your pantry appointment is confirmed.";
  if (intent === "cancellation_intent" && activeConsent) return "Your cancellation request was received for staff review.";
  return null;
}

export async function processInboundWebhook(event: InboundSmsEvent) {
  const from = normalizePhoneNumber(event.from);
  const to = normalizePhoneNumber(event.to);
  if (!from || !to || !event.providerMessageId || event.body.length > 1600) throw new DomainError("VALIDATION_ERROR");
  const settingResult = await db.execute<MessagingSettings>(sql`select s.*,coalesce(l.timezone,o.timezone,'UTC') timezone from sms_settings s join pantry_locations l on l.id=s.pantry_location_id join organizations o on o.id=s.organization_id where s.is_enabled and regexp_replace(coalesce(s.default_from_number,''),'[^0-9]','','g')=${to.replace(/\D/g, "")} limit 2`);
  if (settingResult.rows.length !== 1) return { accepted: true, response: null, matched: false };
  const settings = settingResult.rows[0];
  const contacts = await db.execute<ContactRecipient>(sql`
    select hc.id contact_id,h.id household_id,h.organization_id,h.status household_status,h.default_pantry_location_id,hc.is_active contact_active,hc.archived_at::text contact_archived_at,hc.phone_number,hc.phone_normalized,
      coalesce(hc.preferred_language,h.preferred_language,'en') preferred_language,sc.id consent_id,sc.status::text consent_status,h.display_name,hc.name contact_name
    from household_contacts hc join households h on h.id=hc.household_id and h.organization_id=hc.organization_id
    left join lateral(select id,status from sms_consents c where c.organization_id=h.organization_id and c.household_id=h.id and c.phone_normalized=${from} and (c.household_contact_id=hc.id or c.household_contact_id is null) order by c.effective_at desc,c.created_at desc limit 1) sc on true
    where hc.organization_id=${settings.organization_id} and hc.phone_normalized=${from} and hc.is_active and hc.archived_at is null and h.status='active'
    order by hc.contact_type,hc.created_at
  `);
  const contact = contacts.rows[0] ?? null;
  const intent = parseInboundIntent(event.body);
  const response = inboundResponse(intent, settings.help_response, Boolean(contact?.consent_id), contact?.consent_status === "consented");
  const transactionResult = await db.transaction(async (tx) => {
    const inserted = await tx.execute<{ id: string }>(sql`insert into inbound_messages(organization_id,pantry_location_id,household_id,household_contact_id,from_phone_number,to_phone_number,body,normalized_command,provider_message_id,processing_status) values(${settings.organization_id},${settings.pantry_location_id},${contact?.household_id ?? null},${contact?.contact_id ?? null},${from},${to},${event.body},${normalizeInboundText(event.body)},${event.providerMessageId},'received') on conflict(organization_id,provider_message_id) do nothing returning id`);
    if (!inserted.rows[0]) return { duplicate: true };
    const inboundId = inserted.rows[0].id;
    let appointmentId: string | null = null;
    if (intent === "stop" && contacts.rows.length) {
      for (const row of contacts.rows) if (row.consent_id && row.consent_status !== "opted_out") await tx.execute(sql`insert into sms_consents(organization_id,household_id,household_contact_id,phone_normalized,status,consent_source,recorded_by,notes) values(${settings.organization_id},${row.household_id},${row.contact_id},${from},'opted_out','administrative_correction',${settings.created_by},'Inbound STOP command')`);
    } else if (intent === "start" && contact?.consent_id && contact.consent_status !== "consented") {
      await tx.execute(sql`insert into sms_consents(organization_id,household_id,household_contact_id,phone_normalized,status,consent_source,recorded_by,notes) values(${settings.organization_id},${contact.household_id},${contact.contact_id},${from},'consented','inbound_start',${settings.created_by},'Inbound START command')`);
    } else if ((intent === "confirm" || intent === "cancellation_intent") && contact) {
      const appointment = await tx.execute<{ id: string; status: string }>(sql`select id,status::text from appointments where organization_id=${settings.organization_id} and pantry_location_id=${settings.pantry_location_id} and household_id=${contact.household_id} and status in('scheduled','confirmed') and scheduled_end_at>now() order by scheduled_start_at limit 1 for update`);
      appointmentId = appointment.rows[0]?.id ?? null;
      if (appointmentId && intent === "confirm" && appointment.rows[0].status === "scheduled") {
        await tx.execute(sql`update appointments set status='confirmed',updated_at=now() where id=${appointmentId}`);
        await tx.execute(sql`insert into appointment_status_history(organization_id,pantry_location_id,appointment_id,from_status,to_status,reason,changed_by) values(${settings.organization_id},${settings.pantry_location_id},${appointmentId},'scheduled','confirmed','Confirmed by inbound SMS',${settings.created_by})`);
      }
    }
    const processing = intent === "unknown" || intent === "cancellation_intent" || !contact ? "review_required" : "processed";
    await tx.execute(sql`update inbound_messages set processing_status=${processing},linked_appointment_id=${appointmentId} where id=${inboundId}`);
    if (response) {
      await tx.execute(sql`insert into sms_compliance_messages(organization_id,pantry_location_id,inbound_message_id,to_phone_number,from_phone_number,body_snapshot,command) values(${settings.organization_id},${settings.pantry_location_id},${inboundId},${from},${to},${response},${intent}) on conflict(inbound_message_id) do nothing`);
    }
    await writeAudit(tx, settings.created_by, settings.organization_id, settings.pantry_location_id, `message.inbound.${intent}`, "inbound_message", inboundId, deterministicUuid(`inbound-audit:${event.providerMessageId}`), { matched: Boolean(contact), appointmentId });
    return { duplicate: false };
  });
  return { accepted: true, response, matched: Boolean(contact), intent, ...transactionResult };
}

export async function scheduleAppointmentReminders(organizationId?: string, locationId?: string) {
  const candidates = await db.execute<Record<string, unknown>>(sql`
    select a.id appointment_id,a.organization_id,a.pantry_location_id,a.scheduled_start_at,a.status::text appointment_status,h.id household_id,h.display_name,
      coalesce(hc.preferred_language,h.preferred_language,s.default_language,'en') language,hc.id contact_id,hc.phone_normalized,sc.id consent_id,sc.status::text consent_status,
      mt.id template_id,mt.body template_body,l.name location_name,l.address_line_1 as address_line1,l.city,l.state_region,l.phone_number,s.provider,s.default_from_number,s.sending_mode,coalesce(l.timezone,o.timezone,'UTC') timezone
    from appointments a join sms_settings s on s.organization_id=a.organization_id and s.pantry_location_id=a.pantry_location_id and s.is_enabled and s.sending_mode<>'disabled'
    join households h on h.id=a.household_id and h.organization_id=a.organization_id and h.status='active'
    join pantry_locations l on l.id=a.pantry_location_id join organizations o on o.id=a.organization_id
    join lateral(select * from household_contacts c where c.organization_id=a.organization_id and c.household_id=a.household_id and c.is_active and c.archived_at is null and c.phone_normalized is not null order by c.contact_type,c.created_at limit 1) hc on true
    left join lateral(select id,status from sms_consents c where c.organization_id=a.organization_id and c.household_id=a.household_id and c.phone_normalized=hc.phone_normalized and (c.household_contact_id=hc.id or c.household_contact_id is null) order by c.effective_at desc,c.created_at desc limit 1) sc on true
    join lateral(select id,body from message_templates t where t.organization_id=a.organization_id and (t.pantry_location_id=a.pantry_location_id or t.pantry_location_id is null) and t.template_type='appointment_reminder' and t.status='active' and t.archived_at is null and t.language=coalesce(hc.preferred_language,h.preferred_language,s.default_language,'en') order by t.pantry_location_id nulls last,t.created_at desc limit 1) mt on true
    where a.status in('scheduled','confirmed') and a.scheduled_start_at>now() and a.scheduled_start_at<=now()+make_interval(hours=>s.reminder_hours_before)
      and (${organizationId ?? ""}='' or a.organization_id=${organizationId ?? "00000000-0000-0000-0000-000000000000"})
      and (${locationId ?? ""}='' or a.pantry_location_id=${locationId ?? "00000000-0000-0000-0000-000000000000"})
    order by a.scheduled_start_at limit 200
  `);
  let created = 0;
  for (const row of candidates.rows) {
    const eligibility = evaluateSmsRecipientEligibility({ phoneNumber: String(row.phone_normalized), consentId: String(row.consent_id ?? "") || null, consentStatus: String(row.consent_status ?? "") || null, householdStatus: "active", contactActive: true, contactOrganizationId: String(row.organization_id), expectedOrganizationId: String(row.organization_id), appointmentStatus: String(row.appointment_status) });
    if (!eligibility.eligible || !eligibility.normalizedPhoneNumber) continue;
    const start = new Date(String(row.scheduled_start_at));
    const rendered = renderMessageTemplate(String(row.template_body), { household_name: String(row.display_name), appointment_date: start.toLocaleDateString("en-US", { timeZone: String(row.timezone) }), appointment_time: start.toLocaleTimeString("en-US", { timeZone: String(row.timezone), hour: "numeric", minute: "2-digit" }), pantry_location: String(row.location_name), pantry_address: [row.address_line1, row.city, row.state_region].filter(Boolean).join(", "), contact_phone: String(row.phone_number ?? "") });
    if (rendered.missingVariables.length || rendered.segments > 10) continue;
    const idempotency = deterministicUuid(`appointment-reminder:${row.appointment_id}:${start.toISOString()}`);
    const result = await db.execute<{ id: string }>(sql`insert into sms_messages(organization_id,pantry_location_id,appointment_id,household_id,household_contact_id,consent_id,direction,message_type,status,to_phone_number,from_phone_number,body_snapshot,language,scheduled_for,queued_at,provider,idempotency_key,created_by) values(${String(row.organization_id)},${String(row.pantry_location_id)},${String(row.appointment_id)},${String(row.household_id)},${String(row.contact_id)},${String(row.consent_id)},'outbound','appointment_reminder','queued',${eligibility.normalizedPhoneNumber},${row.default_from_number ? String(row.default_from_number) : null},${rendered.body},${String(row.language)},now(),now(),${row.sending_mode === "simulation" ? "simulation" : String(row.provider)},${idempotency},null) on conflict(organization_id,idempotency_key) do nothing returning id`);
    if (result.rows[0]) created += 1;
  }
  return { candidates: candidates.rows.length, created };
}

export async function dispatchDueMessages(limit = 100) {
  const due = await db.execute<{ id: string; campaign_id: string | null }>(sql`select id,campaign_id from sms_messages where status in('queued','scheduled') and (scheduled_for is null or scheduled_for<=now()) order by coalesce(scheduled_for,queued_at,created_at) limit ${Math.max(1, Math.min(limit, 500))} for update skip locked`);
  const results = await Promise.all(due.rows.map((row) => dispatchMessage(row.id)));
  const processed = results.filter(Boolean).length;
  for (const campaignId of new Set(due.rows.flatMap((row) => row.campaign_id ? [row.campaign_id] : []))) {
    const metrics = await db.execute<{ total: number; completed: number; failed: number }>(sql`select count(*)::int total,count(*) filter(where status in('sent','delivered'))::int completed,count(*) filter(where status in('failed','undelivered','excluded'))::int failed from sms_messages where campaign_id=${campaignId}`);
    const row = metrics.rows[0] ?? { total: 0, completed: 0, failed: 0 };
    const status = row.completed + row.failed < row.total ? "partially_sent" : row.failed > 0 ? "partially_sent" : "sent";
    await db.execute(sql`update message_campaigns set status=${status},updated_at=now() where id=${campaignId} and status in('scheduled','sending','partially_sent')`);
  }
  return { found: due.rows.length, processed };
}

export async function retryDueMessages(limit = 100) {
  const failed = await db.execute<{ id: string; status: string; attempt_count: number; retry_limit: number; provider_error_code: string | null; consent_status: string | null; updated_at: string }>(sql`
    select m.id,m.status,m.attempt_count,s.retry_limit,m.provider_error_code,sc.status::text consent_status,m.updated_at::text
    from sms_messages m join sms_settings s on s.organization_id=m.organization_id and s.pantry_location_id=m.pantry_location_id
    left join lateral(select status from sms_consents c where c.organization_id=m.organization_id and c.phone_normalized=m.to_phone_number order by c.effective_at desc,c.created_at desc limit 1) sc on true
    where m.status in('failed','undelivered') order by m.updated_at limit ${Math.max(1, Math.min(limit, 500))}
  `);
  let retried = 0;
  for (const row of failed.rows) {
    if (!isRetryEligible({ status: row.status, attemptCount: row.attempt_count, retryLimit: row.retry_limit, providerErrorCode: row.provider_error_code, consentStatus: row.consent_status })) continue;
    if (Date.now() - new Date(row.updated_at).getTime() < retryDelaySeconds(row.attempt_count) * 1000) continue;
    await db.execute(sql`update sms_messages set status='queued',updated_at=now() where id=${row.id}`);
    if (await dispatchMessage(row.id)) retried += 1;
  }
  return { found: failed.rows.length, retried };
}

export async function runMessagingJobs() {
  const reminders = await scheduleAppointmentReminders();
  const due = await dispatchDueMessages();
  const retries = await retryDueMessages();
  return { reminders, due, retries };
}

export async function markInboundHandled(actorId: string, organizationId: string, locationId: string, inboundId: string, requestId: string) {
  return db.transaction(async (tx) => {
    await requireLocationScope(tx, actorId, organizationId, locationId, "message.manage_inbound");
    const result = await tx.execute<{ id: string }>(sql`update inbound_messages set processing_status='handled',handled_by=${actorId},handled_at=now() where id=${inboundId} and organization_id=${organizationId} and pantry_location_id=${locationId} and handled_at is null returning id`);
    if (!result.rows[0]) throw new DomainError("NOT_FOUND");
    await writeAudit(tx, actorId, organizationId, locationId, "message.inbound.handled", "inbound_message", inboundId, requestId);
  });
}
