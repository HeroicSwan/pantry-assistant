import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { listActiveHouseholdOptions, listTemplateOptions } from "@/domains/pickups/queries";
import { createAppointmentAction } from "@/domains/pickups/actions";

export default async function NewAppointmentPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "appointment.create")) notFound();
  const location = context.activeLocation;
  const organizationId = context.access.organization.id;

  if (!location) {
    return (
      <div className="grid gap-10">
        <PageHeader eyebrow="Pickups" title="New appointment" description="Select an active pantry location first." />
        <EmptyState title="No active location" description="Choose a pantry location from the scope switcher." />
      </div>
    );
  }

  const [householdOptions, templateOptions] = await Promise.all([
    listActiveHouseholdOptions(organizationId),
    listTemplateOptions(organizationId),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Pickups"
        title={`New appointment · ${location.name}`}
        description="Scheduling snapshots the household size and preferred language. Reserving holds available stock without changing physical inventory. No SMS reminder is sent."
      />
      {householdOptions.length === 0 ? (
        <EmptyState title="No active households" description="Create a household before scheduling an appointment." />
      ) : (
        <section className="max-w-2xl border border-[var(--rule)] bg-white p-6">
          <ActionForm action={createAppointmentAction.bind(null, organizationId, organizationSlug, location.id)} className="grid gap-4">
            <SelectField label="Household" name="householdId" required defaultValue="">
              <option value="" disabled>Select a household</option>
              {householdOptions.map((household) => (
                <option key={household.id} value={household.id}>{household.displayName} · {household.householdNumber} · size {household.householdSize}</option>
              ))}
            </SelectField>
            <SelectField label="Appointment type" name="appointmentType" defaultValue="scheduled_pickup">
              <option value="scheduled_pickup">Scheduled pickup</option>
              <option value="walk_in">Walk-in</option>
              <option value="emergency_pickup">Emergency pickup</option>
              <option value="special_distribution">Special distribution</option>
            </SelectField>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Date" name="date" type="date" defaultValue={today} required />
              <Field label="Start" name="startTime" type="time" defaultValue="09:00" required />
              <Field label="End" name="endTime" type="time" defaultValue="09:30" required />
            </div>
            <SelectField label="Package template" name="packageTemplateId" defaultValue="" hint="Generates the allocation from the template and household-size rules.">
              <option value="">No package (schedule only)</option>
              {templateOptions.map((template) => (
                <option key={template.id} value={template.id}>{template.name} · {template.packageType}</option>
              ))}
            </SelectField>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="reserve" defaultChecked className="size-4" />
              Reserve inventory now (FEFO)
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="walkInCheckIn" className="size-4" />
              Walk-in: check in immediately
            </label>
            <TextAreaField label="Special instructions (optional)" name="specialInstructions" maxLength={280} />
            <SubmitButton pendingLabel="Scheduling…">Create appointment</SubmitButton>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
