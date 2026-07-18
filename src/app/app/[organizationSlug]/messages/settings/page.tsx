import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveMessagingSettingsAction } from "@/domains/messaging/actions";
import { getMessagingSettings } from "@/domains/messaging/queries";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function MessagingSettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  const location = context.activeLocation;
  if (!location || !can(context.effectivePermissions, "message.settings.view")) notFound();
  const organizationId = context.access.organization.id;
  const settings = await getMessagingSettings(context.user.id, organizationId, location.id);
  const canManage = can(context.effectivePermissions, "message.settings.manage");
  const value = (name: string, fallback = "") => String(settings?.[name] ?? fallback);
  return <div className="grid gap-10">
    <PageHeader eyebrow="Provider safety" title="Messaging settings" description="Choose one SMS provider per pantry location. Disabled and simulation modes never contact a real recipient." />
    <section className={`border border-[var(--rule)] p-5 ${value("sending_mode", "simulation") === "live" ? "bg-[#fff0e8]" : "bg-white"}`}><p className="text-sm font-semibold">Current environment</p><p className="mt-2 text-2xl font-semibold capitalize">{value("sending_mode", "simulation").replaceAll("_", " ")}</p><p className="mt-2 text-sm text-[var(--muted)]">Provider: {value("provider", "twilio")}. Credentials remain server-only and are never displayed here.</p></section>
    {canManage ? <ActionForm action={saveMessagingSettingsAction.bind(null, organizationId, organizationSlug, location.id)} className="grid gap-4 border border-[var(--rule)] bg-white p-5 md:grid-cols-2">
      <SelectField label="SMS provider" name="provider" defaultValue={value("provider", "twilio")}><option value="twilio">Twilio</option><option value="vonage">Vonage</option><option value="plivo">Plivo</option><option value="telnyx">Telnyx</option><option value="sinch">Sinch</option><option value="infobip">Infobip</option><option value="bandwidth">Bandwidth</option><option value="bird">Bird</option><option value="aws_sns">Amazon SNS</option><option value="azure_communication_services">Azure Communication Services</option></SelectField>
      <SelectField label="Sending mode" name="sendingMode" defaultValue={value("sending_mode", "simulation")}><option value="disabled">Disabled</option><option value="simulation">Safe simulation</option><option value="live">Live provider</option></SelectField>
      <Field label="Default sender number or ID" name="defaultFromNumber" defaultValue={value("default_from_number")} placeholder="+12025550199" />
      <Field label="Default language" name="defaultLanguage" defaultValue={value("default_language", "en")} />
      <Field label="Reminder hours before" name="reminderHoursBefore" type="number" min="1" max="168" defaultValue={value("reminder_hours_before", "24")} />
      <Field label="Quiet hours start" name="quietHoursStart" type="time" defaultValue={value("quiet_hours_start")} />
      <Field label="Quiet hours end" name="quietHoursEnd" type="time" defaultValue={value("quiet_hours_end")} />
      <Field label="Retry limit" name="retryLimit" type="number" min="0" max="10" defaultValue={value("retry_limit", "3")} />
      <TextAreaField label="HELP response" name="helpResponse" maxLength={320} defaultValue={value("help_response", "Reply STOP to opt out. Contact the pantry for assistance.")} className="md:col-span-2" />
      <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" name="isEnabled" defaultChecked={settings ? Boolean(settings.is_enabled) : true} />Messaging enabled</label>
      <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" name="confirmLive" />I explicitly confirm live sending if live mode is selected.</label>
      <SubmitButton pendingLabel="Saving...">Save settings</SubmitButton>
    </ActionForm> : <p className="text-sm text-[var(--muted)]">You can view these settings but cannot change them.</p>}
  </div>;
}
