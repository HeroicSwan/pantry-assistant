import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectField, TextAreaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  confirmProposalAction,
  createAlertProposalAction,
  submitAssistantPromptAction,
} from "@/domains/assistant/actions";
import {
  getAssistantConversation,
  listOpenAlertsForAssistant,
} from "@/domains/assistant/queries";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; conversationId: string }>;
}) {
  const { organizationSlug, conversationId } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "assistant.use")) notFound();
  const location = context.activeLocation;
  if (!location) notFound();
  const organizationId = context.access.organization.id;
  const detail = await getAssistantConversation(
    context.user.id,
    organizationId,
    location.id,
    conversationId,
  );
  if (!detail) notFound();
  const canPropose =
    can(context.effectivePermissions, "assistant.propose_actions") &&
    can(context.effectivePermissions, "alert.view");
  const canConfirm =
    can(context.effectivePermissions, "assistant.confirm_low_risk") &&
    can(context.effectivePermissions, "alert.acknowledge");
  const alerts = canPropose
    ? await listOpenAlertsForAssistant(organizationId, location.id)
    : [];

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow={`${context.access.organization.name} · ${location.name}`}
        title={detail.conversation.title}
        description="Scope is fixed by your signed-in session and selected location. Natural-language text cannot change it."
        actions={
          <Link
            className="inline-flex min-h-11 items-center border border-[var(--ink)] px-4 text-sm font-semibold"
            href={`/app/${organizationSlug}/assistant`}
          >
            All conversations
          </Link>
        }
      />

      <section className="grid gap-5 border border-[var(--rule)] bg-white p-6">
        <div>
          <h2 className="text-xl font-semibold">Ask a scoped question</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Supported topics: current inventory, shortage forecasts, and active
            alerts. The fallback does not make up answers when no matching data
            exists.
          </p>
        </div>
        <ActionForm
          action={submitAssistantPromptAction.bind(
            null,
            organizationId,
            organizationSlug,
            location.id,
            conversationId,
          )}
        >
          <TextAreaField
            label="Question"
            name="prompt"
            maxLength={1_000}
            required
            hint="Do not include household details, phone numbers, secrets, or instructions copied from untrusted records."
            placeholder="Which items have a projected shortage in the next 14 days?"
          />
          <SubmitButton pendingLabel="Checking scoped records…">
            Ask assistant
          </SubmitButton>
        </ActionForm>
      </section>

      <section className="grid gap-4" aria-labelledby="conversation-heading">
        <h2 id="conversation-heading" className="text-2xl font-semibold">
          Conversation
        </h2>
        {detail.messages.length === 0 ? (
          <EmptyState
            title="No messages yet"
            description="Ask a supported operational question. Nothing runs automatically."
          />
        ) : (
          <ol className="grid gap-3">
            {detail.messages.map((message) => (
              <li
                key={message.id}
                className={`border p-5 ${message.role === "user" ? "ml-auto max-w-3xl border-[var(--ink)] bg-[var(--surface)]" : "mr-auto max-w-4xl border-[var(--rule)] bg-white"}`}
              >
                <p className="text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
                  {message.role === "user" ? "You" : "Assistant"}
                </p>
                <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">
                  {message.content}
                </p>
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
          <p className="text-sm text-[var(--muted)]">
            These capped records are the source of assistant facts. Database
            text is data, not executable instruction.
          </p>
          {detail.toolRuns.map((run) => (
            <details
              key={run.id}
              className="border border-[var(--rule)] bg-white p-5"
            >
              <summary className="cursor-pointer font-semibold">
                <code>{run.tool_name}</code> · {run.status}
              </summary>
              {run.output_snapshot ? (
                <pre className="mt-4 max-h-96 overflow-auto bg-[var(--surface)] p-4 text-xs whitespace-pre-wrap">
                  {JSON.stringify(run.output_snapshot, null, 2)}
                </pre>
              ) : (
                <p className="mt-3 text-sm text-[var(--signal)]">
                  No facts were returned. Error code:{" "}
                  {run.error_code ?? "unavailable"}
                </p>
              )}
            </details>
          ))}
        </section>
      ) : null}

      {canPropose ? (
        <section className="grid gap-5 border border-[var(--rule)] bg-white p-6">
          <div>
            <h2 className="text-xl font-semibold">
              Propose an alert acknowledgement
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Creating this proposal changes nothing. It expires after 15
              minutes and confirmation rechecks permissions and the alert
              version.
            </p>
          </div>
          {alerts.length === 0 ? (
            <EmptyState
              title="No open alerts"
              description="There is nothing eligible to propose for this location."
            />
          ) : (
            <ActionForm
              action={createAlertProposalAction.bind(
                null,
                organizationId,
                organizationSlug,
                location.id,
                conversationId,
              )}
            >
              <input
                type="hidden"
                name="idempotencyKey"
                value={crypto.randomUUID()}
              />
              <SelectField label="Open alert" name="alertId" required>
                <option value="">Select an alert</option>
                {alerts.map((alert) => (
                  <option key={alert.id} value={alert.id}>
                    {alert.severity.toUpperCase()} · {alert.title}
                  </option>
                ))}
              </SelectField>
              <TextAreaField
                label="Acknowledgement reason"
                name="reason"
                maxLength={500}
                required
                placeholder="Reviewed by the operations team."
              />
              <SubmitButton pendingLabel="Creating preview…">
                Create proposal only
              </SubmitButton>
            </ActionForm>
          )}
        </section>
      ) : null}

      <section className="grid gap-4">
        <h2 className="text-2xl font-semibold">Action proposals</h2>
        {detail.proposals.length === 0 ? (
          <EmptyState
            title="No proposals"
            description="Assistant reads never create domain changes."
          />
        ) : (
          detail.proposals.map((proposal) => {
            const payload = proposal.payload_snapshot as {
              reason?: string;
              preview?: string;
            };
            return (
              <article
                key={proposal.id}
                className="border border-[var(--rule)] bg-white p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Acknowledge alert</h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Expires {new Date(proposal.expires_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <StatusBadge status={proposal.risk_level} />
                    <StatusBadge status={proposal.displayStatus} />
                  </div>
                </div>
                <p className="mt-4 text-sm">
                  {payload.preview ??
                    "Review the scoped action before confirmation."}
                </p>
                <p className="mt-2 text-sm">
                  <span className="font-semibold">Reason:</span>{" "}
                  {payload.reason ?? "Not provided"}
                </p>
                {proposal.rejection_reason ? (
                  <p className="mt-3 text-sm text-[var(--signal)]">
                    {proposal.rejection_reason}
                  </p>
                ) : null}
                {proposal.displayStatus === "pending" && canConfirm ? (
                  <ActionForm
                    action={confirmProposalAction.bind(
                      null,
                      organizationId,
                      organizationSlug,
                      location.id,
                      conversationId,
                      proposal.id,
                    )}
                    className="mt-5 grid gap-3"
                  >
                    <p className="text-sm font-semibold">
                      Confirmation is a deliberate operation outside assistant
                      text. It will acknowledge only this alert.
                    </p>
                    <SubmitButton pendingLabel="Rechecking and confirming…">
                      Confirm acknowledgement
                    </SubmitButton>
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
