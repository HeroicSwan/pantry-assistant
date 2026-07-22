import { PageHeader } from "@/components/ui/page-header";
import { PrintButton } from "@/app/app/[organizationSlug]/reports/print/print-button";
import { requireOrganizationContext } from "@/lib/auth/access";

const steps = [
  "Check that the organization and pantry location shown in the top rail match your shift.",
  "Open Today at a glance and follow the pickup or receiving tasks assigned to your role.",
  "Use item search, a USB scanner, or the camera lookup before creating a new inventory item.",
  "At pickup, share only what the household needs to receive service. Never discuss another household's information.",
  "If food, a lot, or a count does not match what the screen shows, stop and ask a manager. Do not guess or overwrite records.",
  "Record only what was actually received or handed out, then end the shift by flagging anything that needs follow-up.",
];

export default async function VolunteerQuickStartPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireOrganizationContext(organizationSlug);
  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Printable field guide"
        title="Volunteer quick start"
        description="A short, plain-language guide for a safe pantry shift."
        actions={<PrintButton />}
      />
      <section className="border border-[var(--rule)] bg-white p-6">
        <h2 className="text-xl font-semibold">Your shift, step by step</h2>
        <ol className="mt-5 grid list-decimal gap-4 pl-5 text-sm leading-6">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <section className="grid gap-5 md:grid-cols-2">
        <article className="border border-[var(--rule)] bg-white p-6">
          <h2 className="text-xl font-semibold">Always do</h2>
          <ul className="mt-4 grid list-disc gap-3 pl-5 text-sm leading-6">
            <li>Ask when you are unsure.</li>
            <li>Use clear notes for unusual situations.</li>
            <li>Keep screens and printed lists away from public view.</li>
          </ul>
        </article>
        <article className="border border-[var(--rule)] bg-white p-6">
          <h2 className="text-xl font-semibold">Never do</h2>
          <ul className="mt-4 grid list-disc gap-3 pl-5 text-sm leading-6">
            <li>Change stock just to make a number match.</li>
            <li>Send a message from another account.</li>
            <li>Share household information, phone numbers, or preferences.</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
