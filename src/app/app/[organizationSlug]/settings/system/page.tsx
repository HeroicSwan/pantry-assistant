import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { getMessagingSettings } from "@/domains/messaging/queries";
import { getSystemHealth } from "@/domains/system/health";

export default async function SystemHealthPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "organization.update")) notFound();
  const location = context.activeLocation;
  const [health, messaging] = await Promise.all([
    getSystemHealth(),
    location && can(context.effectivePermissions, "message.settings.view")
      ? getMessagingSettings(context.user.id, context.access.organization.id, location.id)
      : Promise.resolve(null),
  ]);

  const backupDetail = health.backup.status === "current"
    ? `Last encrypted Windows backup: ${health.backup.modifiedAt?.toLocaleString()} (${health.backup.ageHours} hours ago).`
    : health.backup.status === "overdue"
      ? `The latest backup is ${health.backup.ageHours} hours old. Confirm the Windows backup task and make a fresh backup before an update.`
      : "No local backup was found. Confirm the Windows backup task before entering operational data.";

  return <div className="grid gap-10">
    <PageHeader eyebrow="Self-hosted system" title="Health and recovery" description="This page shows non-sensitive local service status. It never displays database passwords, SMS credentials, email passwords, or AI prompts." />
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <article className="border border-[var(--rule)] bg-white p-5"><p className="text-xs text-[var(--muted)]">Application</p><div className="mt-3"><StatusBadge status="ready" /></div><p className="mt-3 text-sm">Version {health.version}</p></article>
      <article className="border border-[var(--rule)] bg-white p-5"><p className="text-xs text-[var(--muted)]">PostgreSQL</p><div className="mt-3"><StatusBadge status={health.database} /></div><p className="mt-3 text-sm">Local database connection is available.</p></article>
      <article className="border border-[var(--rule)] bg-white p-5"><p className="text-xs text-[var(--muted)]">Backups</p><div className="mt-3"><StatusBadge status={health.backup.status} /></div><p className="mt-3 text-sm">{backupDetail}</p></article>
      <article className="border border-[var(--rule)] bg-white p-5"><p className="text-xs text-[var(--muted)]">Local Ollama</p><div className="mt-3"><StatusBadge status={health.ollama.status} /></div><p className="mt-3 text-sm">{health.ollama.model ? `Configured model: ${health.ollama.model}` : "Assistant is disabled for this installation."}</p></article>
    </section>
    <section className="grid gap-6 lg:grid-cols-2">
      <article className="border border-[var(--rule)] bg-white p-6"><h2 className="text-xl font-semibold">Local network</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">Approved devices on the food pantry’s private network use this address. Do not expose Pantry Assistant directly to the public internet.</p><p className="mt-4 rounded-xl bg-[var(--surface)] px-4 py-3 font-mono text-sm break-all">{health.lanUrl}</p></article>
      <article className="border border-[var(--rule)] bg-white p-6"><h2 className="text-xl font-semibold">Messaging</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{messaging ? `Provider: ${String(messaging.provider)} · mode: ${String(messaging.sending_mode)} · ${messaging.is_enabled ? "enabled" : "disabled"}.` : "You do not have access to messaging settings for this location."}</p>{location && can(context.effectivePermissions, "message.settings.view") ? <Link className="mt-5 inline-flex text-sm font-semibold underline decoration-[var(--signal)] decoration-2 underline-offset-4" href={`/app/${organizationSlug}/messages/settings`}>Open messaging settings</Link> : null}</article>
    </section>
    <section className="border border-[var(--rule)] bg-white p-6"><h2 className="text-xl font-semibold">Recovery and updates</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">The Windows installer creates a daily encrypted backup task. Before an update, verify that backups are current; the update process preserves local secrets and database files, and a failed application build can be rolled back to the previous application folder. The Windows package includes the complete installation and recovery guide.</p><a className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-[var(--ink)] bg-white px-4 text-sm font-semibold shadow-sm" href={`/api/support-bundle/${organizationSlug}`}>Download safe support bundle</a><p className="mt-3 text-xs text-[var(--muted)]">The bundle includes only version, service, migration, backup, and integration-configuration status—never household data, logs, passwords, or API keys.</p></section>
  </div>;
}
