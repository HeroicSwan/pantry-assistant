import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { markInboundHandledAction } from "@/domains/messaging/actions";
import { listInboundMessages } from "@/domains/messaging/queries";
import { maskPhoneNumber } from "@/domains/messaging/policy";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function InboundMessagesPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params; const context = await requireOrganizationContext(organizationSlug); const location = context.activeLocation;
  if (!location || !can(context.effectivePermissions, "message.view_inbound")) notFound();
  const organizationId = context.access.organization.id; const messages = await listInboundMessages(context.user.id, organizationId, location.id);
  return <div className="grid gap-10"><PageHeader eyebrow="Inbound review" title="Inbound messages" description="Compliance commands are processed first. Clear confirmations may confirm an appointment; cancellation intent and free-form replies remain queued for staff review." />
    <section className="grid gap-4">{messages.length ? messages.map((message) => <article key={message.id} className="border border-[var(--rule)] bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{message.household_display_name ?? "Unmatched number"}</h2><p className="text-sm text-[var(--muted)]">{maskPhoneNumber(message.from_phone_number)} · {new Date(message.received_at).toLocaleString()}</p></div><StatusBadge status={message.processing_status}/></div><p className="mt-4 whitespace-pre-wrap text-sm">{message.body}</p>{message.normalized_command ? <p className="mt-2 text-xs text-[var(--muted)]">Normalized: {message.normalized_command}</p> : null}{message.processing_status === "review_required" && can(context.effectivePermissions, "message.manage_inbound") ? <ActionForm action={markInboundHandledAction.bind(null, organizationId, organizationSlug, location.id, message.id)} className="mt-4"><SubmitButton pendingLabel="Saving…">Mark handled</SubmitButton></ActionForm> : null}</article>) : <p className="border border-dashed border-[var(--rule)] p-6 text-sm text-[var(--muted)]">No inbound messages.</p>}</section>
  </div>;
}
