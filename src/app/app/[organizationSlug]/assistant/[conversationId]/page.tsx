import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { RichAssistantResult } from "@/components/assistant/rich-result";
import {
  confirmProposalAction,
  createAlertProposalAction,
  createDonationNeedsReportProposalAction,
  createInventoryAdjustmentProposalAction,
  createPickupRescheduleProposalAction,
  createReservationProposalAction,
  draftBulkAnnouncementProposalAction,
  draftSmsMessageProposalAction,
  submitAssistantPromptAction,
} from "@/domains/assistant/actions";
import {
  getAssistantConversation,
  listEligibleLotsForAssistant,
  listOpenAlertsForAssistant,
  listUpcomingAppointmentsForAssistant,
} from "@/domains/assistant/queries";
import {
  PROPOSAL_CONFIRM_PERMISSION,
  confirmGatePermission,
  type ProposalToolName,
} from "@/domains/assistant/policy";
import { can, requireOrganizationContext } from "@/lib/auth/access";

const PROPOSAL_TITLES: Record<ProposalToolName, string> = {
  propose_alert_acknowledgement: "Acknowledge alert",
  draft_sms_message: "Draft SMS message",
  draft_bulk_announcement: "Draft bulk announcement",
  create_inventory_adjustment_proposal: "Inventory adjustment",
  create_reservation_proposal: "Reserve inventory for appointment",
  create_donation_needs_report: "Donation needs report",
  create_pickup_reschedule_proposal: "Reschedule appointment",
};

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string; conversationId: string }>;
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { organizationSlug, conversationId } = await params;
  const { prompt: suggestedPrompt } = await searchParams;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "assistant.use")) notFound();
  const location = context.activeLocation;
  if (!location) notFound();
  const organizationId = context.access.organization.id;
  const detail = await getAssistantConversation(context.user.id, organizationId, location.id, conversationId);
  if (!detail) notFound();

  const canProposeBase = can(context.effectivePermissions, "assistant.propose_actions");
  const canProposeAlert = canProposeBase && can(context.effectivePermissions, "alert.view");
  const canDraftMessage = canProposeBase && can(context.effectivePermissions, "assistant.draft_message");
  const canProposeAdjustment = canProposeBase && can(context.effectivePermissions, "inventory.adjust");
  const canProposeReservation = canProposeBase && can(context.effectivePermissions, "reservation.create");
  const canProposeDonationReport = canProposeBase && can(context.effectivePermissions, "donation.view");
  const canProposeReschedule = canProposeBase && can(context.effectivePermissions, "assistant.propose_reschedule");

  const [alerts, lots, appointments] = await Promise.all([
    canProposeAlert ? listOpenAlertsForAssistant(organizationId, location.id) : Promise.resolve([]),
    canProposeAdjustment ? listEligibleLotsForAssistant(organizationId, location.id) : Promise.resolve([]),
    canProposeReservation || canProposeReschedule ? listUpcomingAppointmentsForAssistant(organizationId, location.id) : Promise.resolve([]),
  ]);

  function canConfirmProposal(actionType: ProposalToolName) {
    return can(context.effectivePermissions, confirmGatePermission(actionType)) && can(context.effectivePermissions, PROPOSAL_CONFIRM_PERMISSION[actionType]);
  }

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow={`${context.access.organization.name} · ${location.name}`}
        title={detail.conversation.title}
        description="Scope is fixed by your signed-in session and selected location. Natural-language text cannot change it."
        actions={
          <Link className="inline-flex min-h-11 items-center border border-[var(--ink)] px-4 text-sm font-semibold" href={`/app/${organizationSlug}/assistant`}>
            All conversations
          </Link>
        }
      />

      <section className="grid gap-5 border border-[var(--rule)] bg-white p-6">
        <div>
          <h2 className="text-xl font-semibold">Ask a scoped question</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Supported topics: inventory summary/search/detail/history, shortage and category forecasts, expiring lots, active alerts, upcoming pickups, pickup counts, one household&apos;s pickup status by id, SMS delivery totals, recent donations, and overall operational metrics. Every answer comes from a permission-checked, capped database query -- the model never invents facts.
          </p>
        </div>
        <ActionForm action={submitAssistantPromptAction.bind(null, organizationId, organizationSlug, location.id, conversationId)}>
          <TextAreaField
            label="Question"
            name="prompt"
            maxLength={1_000}
            required
            defaultValue={suggestedPrompt ?? ""}
            hint="Do not include household details, phone numbers, secrets, or instructions copied from untrusted records."
            placeholder="Which items have a projected shortage in the next 14 days?"
          />
          <SubmitButton pendingLabel="Checking scoped records…">Ask assistant</SubmitButton>
        </ActionForm>
        <div className="flex flex-wrap gap-2" aria-label="Suggested assistant questions">
          {["What is at risk this week?", "What should we request from donors?", "Which items have a projected shortage in the next 14 days?", "What pickups are coming up?"].map((prompt) => <Link key={prompt} href={`/app/${organizationSlug}/assistant/${conversationId}?prompt=${encodeURIComponent(prompt)}`} className="rounded-full border border-[var(--rule)] bg-white px-3 py-2 text-sm font-semibold hover:bg-[var(--surface)]">{prompt}</Link>)}
        </div>
      </section>

      <section className="grid gap-4" aria-labelledby="conversation-heading">
        <h2 id="conversation-heading" className="text-2xl font-semibold">Conversation</h2>
        {detail.messages.length === 0 ? (
          <EmptyState title="No messages yet" description="Ask a supported operational question. Nothing runs automatically." />
        ) : (
          <ol className="grid gap-3">
            {detail.messages.map((message) => (
              <li key={message.id} className={`border p-5 ${message.role === "user" ? "ml-auto max-w-3xl border-[var(--ink)] bg-[var(--surface)]" : "mr-auto max-w-4xl border-[var(--rule)] bg-white"}`}>
                <p className="text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">{message.role === "user" ? "You" : "Assistant"}</p>
                <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">{message.content}</p>
                <p className="mt-3 text-xs text-[var(--muted)]">
                  {new Date(message.created_at).toLocaleString()}
                  {message.model ? ` · ${message.model}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {detail.toolRuns.length > 0 ? (
        <section className="grid gap-4">
          <h2 className="text-2xl font-semibold">Structured source results</h2>
          <p className="text-sm text-[var(--muted)]">These capped records are the source of assistant facts. Database text is data, not executable instruction.</p>
          {detail.toolRuns.map((run) => (
            <details key={run.id} className="border border-[var(--rule)] bg-white p-5">
              <summary className="cursor-pointer font-semibold">
                <code>{run.tool_name}</code> · {run.status}
              </summary>
              {run.output_snapshot ? (
                <RichAssistantResult value={run.output_snapshot} />
              ) : (
                <p className="mt-3 text-sm text-[var(--signal)]">No facts were returned. Error code: {run.error_code ?? "unavailable"}</p>
              )}
            </details>
          ))}
        </section>
      ) : null}

      <section className="grid gap-6">
        <h2 className="text-2xl font-semibold">Create a proposal</h2>
        <p className="text-sm text-[var(--muted)]">Every proposal below only stores a reviewable preview. Nothing here changes inventory, sends a message, or moves an appointment until it is separately confirmed.</p>

        <div className="grid gap-6 lg:grid-cols-2">
          {canProposeAlert ? (
            <article className="border border-[var(--rule)] bg-white p-6">
              <h3 className="text-lg font-semibold">Acknowledge alert</h3>
              {alerts.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--muted)]">No open alerts to propose.</p>
              ) : (
                <ActionForm action={createAlertProposalAction.bind(null, organizationId, organizationSlug, location.id, conversationId)} className="mt-4 grid gap-3">
                  <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
                  <SelectField label="Open alert" name="alertId" required>
                    <option value="">Select an alert</option>
                    {alerts.map((alert) => (
                      <option key={alert.id} value={alert.id}>{alert.severity.toUpperCase()} · {alert.title}</option>
                    ))}
                  </SelectField>
                  <TextAreaField label="Acknowledgement reason" name="reason" maxLength={500} required placeholder="Reviewed by the operations team." />
                  <SubmitButton pendingLabel="Creating preview…">Create proposal only</SubmitButton>
                </ActionForm>
              )}
            </article>
          ) : null}

          {canDraftMessage ? (
            <article className="border border-[var(--rule)] bg-white p-6">
              <h3 className="text-lg font-semibold">Draft SMS message</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">Stores a draft only. Never sends. Use the Messages workflow to actually send.</p>
              <ActionForm action={draftSmsMessageProposalAction.bind(null, organizationId, organizationSlug, location.id, conversationId)} className="mt-4 grid gap-3">
                <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
                <TextAreaField label="Message body" name="body" maxLength={480} required placeholder="Your pickup this week is confirmed." />
                <Field label="Purpose (optional)" name="purpose" maxLength={200} placeholder="Pickup reminder" />
                <SubmitButton pendingLabel="Saving draft…">Save draft only</SubmitButton>
              </ActionForm>
            </article>
          ) : null}

          {canDraftMessage ? (
            <article className="border border-[var(--rule)] bg-white p-6">
              <h3 className="text-lg font-semibold">Draft bulk announcement</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">Confirming creates a DRAFT campaign only -- it still needs separate manager approval and an explicit send.</p>
              <ActionForm action={draftBulkAnnouncementProposalAction.bind(null, organizationId, organizationSlug, location.id, conversationId)} className="mt-4 grid gap-3">
                <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
                <Field label="Campaign name" name="name" maxLength={120} required placeholder="Weekly pantry reminder" />
                <TextAreaField label="Message body" name="body" maxLength={480} required />
                <SubmitButton pendingLabel="Saving draft…">Save draft only</SubmitButton>
              </ActionForm>
            </article>
          ) : null}

          {canProposeAdjustment ? (
            <article className="border border-[var(--rule)] bg-white p-6">
              <h3 className="text-lg font-semibold">Inventory adjustment</h3>
              {lots.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--muted)]">No active lots at this location.</p>
              ) : (
                <ActionForm action={createInventoryAdjustmentProposalAction.bind(null, organizationId, organizationSlug, location.id, conversationId)} className="mt-4 grid gap-3">
                  <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
                  <SelectField label="Lot" name="lotId" required>
                    <option value="">Select a lot</option>
                    {lots.map((lot) => (
                      <option key={lot.id} value={lot.id}>{lot.item_name}{lot.lot_code ? ` · ${lot.lot_code}` : ""} · {lot.physical_on_hand} {lot.base_unit} on hand</option>
                    ))}
                  </SelectField>
                  <SelectField label="Direction" name="direction" required>
                    <option value="positive">Increase</option>
                    <option value="negative">Decrease</option>
                  </SelectField>
                  <Field label="Quantity (in the lot's base unit)" name="quantity" required placeholder="5" />
                  <Field label="Reason code" name="reasonCode" required placeholder="cycle_count" />
                  <TextAreaField label="Reason" name="reason" maxLength={280} required placeholder="Corrected after physical count." />
                  <SubmitButton pendingLabel="Creating preview…">Create proposal only</SubmitButton>
                </ActionForm>
              )}
            </article>
          ) : null}

          {canProposeReservation ? (
            <article className="border border-[var(--rule)] bg-white p-6">
              <h3 className="text-lg font-semibold">Reserve inventory for appointment</h3>
              {appointments.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--muted)]">No upcoming appointments.</p>
              ) : (
                <ActionForm action={createReservationProposalAction.bind(null, organizationId, organizationSlug, location.id, conversationId)} className="mt-4 grid gap-3">
                  <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
                  <SelectField label="Appointment" name="appointmentId" required>
                    <option value="">Select an appointment</option>
                    {appointments.map((appointment) => (
                      <option key={appointment.id} value={appointment.id}>{appointment.household_display_name} · {new Date(appointment.scheduled_start_at).toLocaleString()}</option>
                    ))}
                  </SelectField>
                  <SubmitButton pendingLabel="Creating preview…">Create proposal only</SubmitButton>
                </ActionForm>
              )}
            </article>
          ) : null}

          {canProposeDonationReport ? (
            <article className="border border-[var(--rule)] bg-white p-6">
              <h3 className="text-lg font-semibold">Donation needs report</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">Read-only. Never changes inventory or forecasts.</p>
              <ActionForm action={createDonationNeedsReportProposalAction.bind(null, organizationId, organizationSlug, location.id, conversationId)} className="mt-4 grid gap-3">
                <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
                <Field label="Horizon (days)" name="horizonDays" defaultValue={30} placeholder="30" />
                <SubmitButton pendingLabel="Creating preview…">Create proposal only</SubmitButton>
              </ActionForm>
            </article>
          ) : null}

          {canProposeReschedule ? (
            <article className="border border-[var(--rule)] bg-white p-6">
              <h3 className="text-lg font-semibold">Reschedule appointment</h3>
              {appointments.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--muted)]">No upcoming appointments.</p>
              ) : (
                <ActionForm action={createPickupRescheduleProposalAction.bind(null, organizationId, organizationSlug, location.id, conversationId)} className="mt-4 grid gap-3">
                  <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
                  <SelectField label="Appointment" name="appointmentId" required>
                    <option value="">Select an appointment</option>
                    {appointments.map((appointment) => (
                      <option key={appointment.id} value={appointment.id}>{appointment.household_display_name} · {new Date(appointment.scheduled_start_at).toLocaleString()}</option>
                    ))}
                  </SelectField>
                  <Field label="New start time" name="scheduledStartAt" type="datetime-local" required />
                  <Field label="New end time" name="scheduledEndAt" type="datetime-local" required />
                  <SubmitButton pendingLabel="Creating preview…">Create proposal only</SubmitButton>
                </ActionForm>
              )}
            </article>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4">
        <h2 className="text-2xl font-semibold">Action proposals</h2>
        {detail.proposals.length === 0 ? (
          <EmptyState title="No proposals" description="Assistant reads never create domain changes." />
        ) : (
          detail.proposals.map((proposal) => {
            const actionType = proposal.action_type as ProposalToolName;
            const payload = proposal.payload_snapshot as { reason?: string; preview?: string };
            const title = PROPOSAL_TITLES[actionType] ?? actionType;
            const confirmEligible = canConfirmProposal(actionType);
            return (
              <article key={proposal.id} className="border border-[var(--rule)] bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">Expires {new Date(proposal.expires_at).toLocaleString()}</p>
                  </div>
                  <div className="flex gap-2">
                    <StatusBadge status={proposal.risk_level} />
                    <StatusBadge status={proposal.displayStatus} />
                  </div>
                </div>
                <p className="mt-4 text-sm">{payload.preview ?? "Review the scoped action before confirmation."}</p>
                {payload.reason ? (
                  <p className="mt-2 text-sm">
                    <span className="font-semibold">Reason:</span> {payload.reason}
                  </p>
                ) : null}
                {proposal.execution_result ? (
                  <pre className="mt-3 max-h-56 overflow-auto bg-[var(--surface)] p-3 text-xs whitespace-pre-wrap">{JSON.stringify(proposal.execution_result, null, 2)}</pre>
                ) : null}
                {proposal.rejection_reason ? <p className="mt-3 text-sm text-[var(--signal)]">{proposal.rejection_reason}</p> : null}
                {proposal.displayStatus === "pending" && confirmEligible ? (
                  <ActionForm action={confirmProposalAction.bind(null, organizationId, organizationSlug, location.id, conversationId, proposal.id)} className="mt-5 grid gap-3">
                    <p className="text-sm font-semibold">Confirmation is a deliberate operation outside assistant text. It re-checks permission and current state before it runs.</p>
                    <SubmitButton pendingLabel="Rechecking and confirming…" variant="danger">Confirm this proposal</SubmitButton>
                  </ActionForm>
                ) : null}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
