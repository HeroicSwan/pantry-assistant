import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { messagingDashboard } from "@/domains/messaging/queries";

export default async function MessagesPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  const location = context.activeLocation;
  if (!location || !can(context.effectivePermissions, "message.view")) notFound();
  const metrics = await messagingDashboard(context.user.id, context.access.organization.id, location.id);
  const cards = [
    ["Scheduled", metrics.scheduled], ["Sent", metrics.sent], ["Delivered", metrics.delivered], ["Failed", metrics.failed],
    ["Undelivered", metrics.undelivered], ["Opt-outs (30 days)", metrics.opt_outs], ["Inbound confirmations", metrics.confirmations],
    ["Awaiting review", metrics.awaiting_review], ["Campaigns awaiting approval", metrics.awaiting_approval],
  ];
  const base = `/app/${organizationSlug}/messages`;
  return <div className="grid gap-10">
    <PageHeader eyebrow="Consent-first communication" title={`Messaging · ${location.name}`} description="Every outbound message uses the configured provider mode and revalidates current consent immediately before sending. Metrics below come from stored message and provider events." />
    <nav aria-label="Messaging sections" className="flex flex-wrap gap-3 text-sm font-semibold">
      {can(context.effectivePermissions, "message.send_individual") ? <Link href={`${base}/individual`}>Individual message</Link> : null}
      {can(context.effectivePermissions, "message.template.view") ? <Link href={`${base}/templates`}>Templates</Link> : null}
      <Link href={`${base}/campaigns`}>Campaigns</Link>
      {can(context.effectivePermissions, "message.view_delivery") ? <Link href={`${base}/history`}>Delivery history</Link> : null}
      {can(context.effectivePermissions, "message.view_inbound") ? <Link href={`${base}/inbound`}>Inbound queue</Link> : null}
      {can(context.effectivePermissions, "message.settings.view") ? <Link href={`${base}/settings`}>Settings</Link> : null}
    </nav>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Last 30 days">
      {cards.map(([label, value]) => <article key={String(label)} className="border border-[var(--rule)] bg-white p-5"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p></article>)}
    </section>
  </div>;
}
