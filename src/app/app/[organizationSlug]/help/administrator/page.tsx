import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { PrintButton } from "@/app/app/[organizationSlug]/reports/print/print-button";
import { can, requireOrganizationContext } from "@/lib/auth/access";

const sections = [
  {
    title: "Open the pantry",
    steps: [
      "Confirm the active organization and pantry location in the context rail.",
      "Open Today at a glance. Address critical alerts, pickups due, and inbound messages needing review.",
      "Confirm the system health page reports a current encrypted backup before making major changes.",
    ],
  },
  {
    title: "Keep operations accurate",
    steps: [
      "Use receiving sessions for donations and purchases; complete them only after the physical stock is verified.",
      "Require a clear reason for every stock correction. Do not edit a completed transaction; use its correction or reversal path.",
      "Review expiring lots, low-stock alerts, and forecast recommendations before requesting food or approving a transfer.",
    ],
  },
  {
    title: "Protect people and data",
    steps: [
      "Give people the least access they need. Suspend access promptly when a staff member leaves.",
      "Keep household contact, preference, and consent details inside Pantry Assistant. Do not export or share them casually.",
      "Review message consent, quiet hours, and exact recipients before approving a campaign.",
    ],
  },
  {
    title: "Recover safely",
    steps: [
      "Use Health and recovery to confirm backups and download a support bundle that excludes household data and secrets.",
      "Before an update, make a fresh encrypted backup. If an application update fails, use the documented application rollback; never delete the database to troubleshoot.",
      "If the database is unavailable, stop operational writes and follow the restore guide before resuming service.",
    ],
  },
];

export default async function AdministratorHandbookPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "organization.update")) notFound();

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Printable field guide"
        title="Administrator handbook"
        description="A short operating checklist for the staff member responsible for safe local operations."
        actions={<PrintButton />}
      />
      <p className="text-sm text-[var(--muted)]">
        Organization: {context.access.organization.name} · Print this guide or
        save it as a PDF for the pantry binder.
      </p>
      <section className="grid gap-5 md:grid-cols-2">
        {sections.map((section) => (
          <article
            key={section.title}
            className="border border-[var(--rule)] bg-white p-6"
          >
            <h2 className="text-xl font-semibold">{section.title}</h2>
            <ol className="mt-4 grid list-decimal gap-3 pl-5 text-sm leading-6">
              <>
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </>
            </ol>
          </article>
        ))}
      </section>
      <section className="border border-[var(--rule)] bg-white p-6">
        <h2 className="text-xl font-semibold">When to pause and escalate</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Pause the affected workflow and contact the pantry administrator if an
          inventory balance appears wrong, a recipient&apos;s consent is
          unclear, a household record may be duplicated, a transfer discrepancy
          is unresolved, or the Health and recovery page reports a database or
          backup problem.
        </p>
      </section>
    </div>
  );
}
