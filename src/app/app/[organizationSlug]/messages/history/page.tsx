import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { retryFailedMessageAction } from "@/domains/messaging/actions";
import { listMessageHistory } from "@/domains/messaging/queries";
import { maskPhoneNumber } from "@/domains/messaging/policy";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function MessageHistoryPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ status?: string }> }) {
  const { organizationSlug } = await params; const { status } = await searchParams; const context = await requireOrganizationContext(organizationSlug); const location = context.activeLocation;
  if (!location || !can(context.effectivePermissions, "message.view_delivery")) notFound();
  const organizationId = context.access.organization.id; const messages = await listMessageHistory(context.user.id, organizationId, location.id, status);
  return <div className="grid gap-10"><PageHeader eyebrow="Provider results" title="Delivery history" description="Accepted and queued messages are not treated as delivered. Every row shows the latest monotonic provider state and bounded attempt count." />
    <nav className="flex flex-wrap gap-3 text-sm font-semibold" aria-label="Delivery filters"><a href="?">All</a><a href="?status=scheduled">Scheduled</a><a href="?status=delivered">Delivered</a><a href="?status=failed">Failed</a><a href="?status=undelivered">Undelivered</a></nav>
    <section className="grid gap-4">{messages.length ? messages.map((message) => <article key={message.id} className="border border-[var(--rule)] bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{message.message_type.replaceAll("_", " ")}</h2><p className="text-sm text-[var(--muted)]">{maskPhoneNumber(message.to_phone_number)} · {message.provider} · attempt {message.attempt_count}</p></div><StatusBadge status={message.status}/></div><p className="mt-4 line-clamp-3 whitespace-pre-wrap text-sm">{message.body_snapshot}</p>{message.provider_error_code ? <p className="mt-3 text-sm text-[var(--signal)]">{message.provider_error_code}: {message.provider_error_message ?? "Provider failure"}</p> : null}{["failed", "undelivered"].includes(message.status) && can(context.effectivePermissions, "message.retry_failed") ? <ActionForm action={retryFailedMessageAction.bind(null, organizationId, organizationSlug, location.id, message.id)} className="mt-4"><SubmitButton pendingLabel="Rechecking…">Recheck consent and retry</SubmitButton></ActionForm> : null}</article>) : <p className="border border-dashed border-[var(--rule)] p-6 text-sm text-[var(--muted)]">No messages match this filter.</p>}</section>
  </div>;
}
