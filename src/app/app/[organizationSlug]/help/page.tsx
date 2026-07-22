import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function HelpPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  const permissions = context.effectivePermissions;
  const guides = [
    can(permissions, "receiving.create") && {
      title: "Receive food safely",
      text: "Create an intake, start a receiving session, enter the lot details, and complete it only after the physical stock is verified.",
      href: `/app/${organizationSlug}/inventory/receiving`,
      action: "Open receiving",
    },
    can(permissions, "appointment.view") && {
      title: "Run a pickup",
      text: "Open today’s pickup, check in the household, reserve stock, and record only the quantities actually handed out.",
      href: `/app/${organizationSlug}/pickups`,
      action: "Open pickups",
    },
    can(permissions, "inventory.adjust") && {
      title: "Correct stock",
      text: "Use an adjustment with a clear reason. Large adjustments require an independent approval; posted ledger records remain immutable.",
      href: `/app/${organizationSlug}/inventory/adjustments`,
      action: "Open adjustments",
    },
    can(permissions, "message.view") && {
      title: "Message with consent",
      text: "Review consent and the exact message body before sending. Appointment reminders are queued only for eligible contacts and follow quiet-hour settings.",
      href: `/app/${organizationSlug}/messages`,
      action: "Open messaging",
    },
    can(permissions, "forecast.view") && {
      title: "Respond to shortages",
      text: "Review forecast recommendations and operational alerts before asking for donations, transferring stock, or creating a purchase request.",
      href: `/app/${organizationSlug}/forecast`,
      action: "Open forecast",
    },
  ].filter(Boolean) as Array<{
    title: string;
    text: string;
    href: string;
    action: string;
  }>;

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Built-in help"
        title="Run your pantry with confidence"
        description="Short, role-aware operating guidance for the active organization and location. Every workflow keeps a human in control of inventory, communications, and household data."
      />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {guides.map((guide) => (
          <article
            key={guide.title}
            className="border border-[var(--rule)] bg-white p-6"
          >
            <h2 className="text-xl font-semibold">{guide.title}</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              {guide.text}
            </p>
            <Link
              className="mt-5 inline-flex text-sm font-semibold underline decoration-[var(--signal)] decoration-2 underline-offset-4"
              href={guide.href}
            >
              {guide.action}
            </Link>
          </article>
        ))}
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="border border-[var(--rule)] bg-white p-6">
          <h2 className="text-xl font-semibold">Before every shift</h2>
          <ol className="mt-4 grid list-decimal gap-3 pl-5 text-sm leading-6">
            <li>
              Confirm the active organization and location shown in the context
              rail.
            </li>
            <li>
              Open Today at a glance and clear urgent alerts, arriving pickups,
              and inbound messages needing review.
            </li>
            <li>
              Use the barcode lookup or item search before creating a duplicate
              inventory item.
            </li>
            <li>
              Record why a correction was needed; never overwrite a completed
              inventory or pickup record.
            </li>
          </ol>
        </article>
        <article className="border border-[var(--rule)] bg-white p-6">
          <h2 className="text-xl font-semibold">Keep local data safe</h2>
          <ul className="mt-4 grid gap-3 text-sm leading-6">
            <li>
              Check{" "}
              <Link
                className="font-semibold underline"
                href={`/app/${organizationSlug}/settings/system`}
              >
                Health and recovery
              </Link>{" "}
              for a current encrypted backup before updates.
            </li>
            <li>
              Keep the Windows host on a private network. Do not expose port
              3000 directly to the public internet.
            </li>
            <li>
              Only configure live SMS or email after confirming the
              pantry&apos;s consent and privacy policy.
            </li>
            <li>
              Use local Ollama as a read-only assistant; review every proposed
              operation before confirming it.
            </li>
          </ul>
        </article>
      </section>
      <section className="border border-[var(--rule)] bg-white p-6">
        <h2 className="text-xl font-semibold">Printable field guides</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Keep a simple guide at the front desk or in the pantry binder. These
          pages print cleanly or can be saved as a PDF from the browser print
          dialog.
        </p>
        <div className="mt-5 flex flex-wrap gap-4">
          <Link
            className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold"
            href={`/app/${organizationSlug}/help/volunteer`}
          >
            Volunteer quick start
          </Link>
          {can(permissions, "organization.update") ? (
            <Link
              className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold"
              href={`/app/${organizationSlug}/help/administrator`}
            >
              Administrator handbook
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
