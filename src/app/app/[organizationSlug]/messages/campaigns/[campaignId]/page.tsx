import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { sendMessageCampaignAction, transitionMessageCampaignAction } from "@/domains/messaging/actions";
import { getMessageCampaign } from "@/domains/messaging/queries";
import { calculateSmsSegments } from "@/domains/messaging/policy";
import { previewCampaignAudience, type CampaignAudience } from "@/domains/messaging/service";
import { can, requireOrganizationContext } from "@/lib/auth/access";

type CampaignRow = { id: string; name: string; campaign_type: string; status: string; audience_definition: CampaignAudience; message_body_snapshot: string; scheduled_for: string | null; approved_at: string | null; created_at: string };

export default async function MessageCampaignPage({ params }: { params: Promise<{ organizationSlug: string; campaignId: string }> }) {
  const { organizationSlug, campaignId } = await params; const context = await requireOrganizationContext(organizationSlug); const location = context.activeLocation;
  if (!location || !can(context.effectivePermissions, "message.view")) notFound();
  const organizationId = context.access.organization.id; const detail = await getMessageCampaign(context.user.id, organizationId, location.id, campaignId); if (!detail) notFound();
  const campaign = detail.campaign as CampaignRow; const preview = await previewCampaignAudience(context.user.id, organizationId, location.id, campaign.audience_definition); const size = calculateSmsSegments(campaign.message_body_snapshot);
  return <div className="grid gap-10"><PageHeader eyebrow="Campaign review" title={campaign.name} description="Approval captures this audience definition and body. Eligibility remains provisional until send-time consent revalidation." />
    <section className="grid gap-4 border border-[var(--rule)] bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><StatusBadge status={campaign.status}/><p className="text-sm">{size.characters} characters · {size.segments} segment(s) · {size.encoding}</p></div><p className="whitespace-pre-wrap border-l-4 border-[var(--rule)] pl-4">{campaign.message_body_snapshot}</p><dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-[var(--muted)]">Matched</dt><dd className="text-2xl font-semibold">{preview.matched}</dd></div><div><dt className="text-[var(--muted)]">Eligible now</dt><dd className="text-2xl font-semibold">{preview.eligible.length}</dd></div><div><dt className="text-[var(--muted)]">Excluded now</dt><dd className="text-2xl font-semibold">{preview.exclusions.length}</dd></div></dl>{Object.entries(preview.byReason).length ? <ul className="text-sm text-[var(--muted)]">{Object.entries(preview.byReason).map(([reason, total]) => <li key={reason}>{reason.replaceAll("_", " ")}: {total}</li>)}</ul> : null}</section>
    <section className="flex flex-wrap gap-4">{campaign.status === "draft" && can(context.effectivePermissions, "message.draft") ? <ActionForm action={transitionMessageCampaignAction.bind(null, organizationId, organizationSlug, location.id, campaignId, "awaiting_approval")}><input type="hidden" name="reason" value="Submitted for approval"/><SubmitButton pendingLabel="Submitting…">Submit for approval</SubmitButton></ActionForm> : null}{campaign.status === "awaiting_approval" && can(context.effectivePermissions, "message.approve_bulk") ? <ActionForm action={transitionMessageCampaignAction.bind(null, organizationId, organizationSlug, location.id, campaignId, "approved")}><input type="hidden" name="reason" value="Audience and content reviewed"/><SubmitButton pendingLabel="Approving…">Approve campaign</SubmitButton></ActionForm> : null}{["approved", "scheduled", "partially_sent", "failed"].includes(campaign.status) && can(context.effectivePermissions, "message.send_bulk") ? <ActionForm action={sendMessageCampaignAction.bind(null, organizationId, organizationSlug, location.id, campaignId)}><SubmitButton pendingLabel="Sending…">Revalidate and send</SubmitButton></ActionForm> : null}{!["sent", "cancelled"].includes(campaign.status) && can(context.effectivePermissions, "message.cancel_scheduled") ? <ActionForm action={transitionMessageCampaignAction.bind(null, organizationId, organizationSlug, location.id, campaignId, "cancelled")}><Field label="Cancellation reason" name="reason" required/><SubmitButton variant="danger" pendingLabel="Cancelling…">Cancel campaign</SubmitButton></ActionForm> : null}</section>
  </div>;
}
