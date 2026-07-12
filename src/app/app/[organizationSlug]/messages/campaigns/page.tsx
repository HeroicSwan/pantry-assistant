import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { createMessageCampaignAction } from "@/domains/messaging/actions";
import { listMessageCampaigns } from "@/domains/messaging/queries";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function MessageCampaignsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params; const context = await requireOrganizationContext(organizationSlug); const location = context.activeLocation;
  if (!location || !can(context.effectivePermissions, "message.view")) notFound();
  const organizationId = context.access.organization.id; const campaigns = await listMessageCampaigns(context.user.id, organizationId, location.id);
  return <div className="grid gap-10"><PageHeader eyebrow="Preview and approval" title="Message campaigns" description="Campaign audiences are snapshotted for review, then every recipient is deduplicated and rechecked against current consent when the approved campaign sends." />
    {can(context.effectivePermissions, "message.draft") ? <section className="border border-[var(--rule)] bg-white p-5"><h2 className="text-xl font-semibold">Create draft</h2><ActionForm action={createMessageCampaignAction.bind(null, organizationId, organizationSlug, location.id)} className="mt-5 grid gap-4 md:grid-cols-2"><input type="hidden" name="idempotencyKey" value={crypto.randomUUID()}/><Field label="Campaign name" name="name" required/><SelectField label="Campaign type" name="campaignType" defaultValue="bulk_announcement"><option value="bulk_announcement">Bulk announcement</option><option value="closure_notice">Closure notice</option><option value="special_distribution">Special distribution</option><option value="pickup_ready">Pickup ready</option></SelectField><Field label="Appointment date filter" name="appointmentDate" type="date" hint="Optional"/><SelectField label="Appointment status" name="appointmentStatus" defaultValue=""><option value="">Any status</option><option value="scheduled">Scheduled</option><option value="confirmed">Confirmed</option><option value="arrived">Arrived</option></SelectField><Field label="Preferred language" name="preferredLanguage" placeholder="en"/><Field label="Schedule (optional)" name="scheduledFor" type="datetime-local"/><TextAreaField label="Exact message body" name="body" required maxLength={1600} className="md:col-span-2"/><SubmitButton pendingLabel="Creating…">Create draft</SubmitButton></ActionForm></section> : null}
    <section className="grid gap-4">{campaigns.length ? campaigns.map((campaign) => <Link key={campaign.id} href={`/app/${organizationSlug}/messages/campaigns/${campaign.id}`} className="block border border-[var(--rule)] bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{campaign.name}</h2><p className="text-sm text-[var(--muted)]">{campaign.campaign_type.replaceAll("_", " ")} · {new Date(campaign.created_at).toLocaleString()}</p></div><StatusBadge status={campaign.status}/></div><p className="mt-3 text-sm">{campaign.total} recipients · {campaign.delivered} delivered · {campaign.failed} failed or excluded</p></Link>) : <p className="border border-dashed border-[var(--rule)] p-6 text-sm text-[var(--muted)]">No campaigns yet.</p>}</section>
  </div>;
}
