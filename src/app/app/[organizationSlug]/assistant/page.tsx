import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { createConversationAction } from "@/domains/assistant/actions";
import { listAssistantConversations } from "@/domains/assistant/queries";
import { getRegisteredAssistantTools } from "@/domains/assistant/service";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "assistant.use")) notFound();
  const location = context.activeLocation;
  if (!location)
    return (
      <EmptyState
        title="No active location"
        description="Select a pantry location before using scoped assistant tools."
      />
    );
  const organizationId = context.access.organization.id;
  const conversations = await listAssistantConversations(
    context.user.id,
    organizationId,
    location.id,
  );
  const tools = getRegisteredAssistantTools();

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Controlled operations assistant"
        title={`Assistant · ${location.name}`}
        description="The local deterministic fallback selects only approved tools. Facts come from fresh, permission-scoped records; proposed actions require a separate confirmation."
      />

      <section className="grid gap-6 border border-[var(--rule)] bg-white p-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
        <div>
          <h2 className="text-xl font-semibold">Start a conversation</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Do not enter phone numbers, passwords, household notes, or other
            sensitive personal information.
          </p>
          <ActionForm
            action={createConversationAction.bind(
              null,
              organizationId,
              organizationSlug,
              location.id,
            )}
            className="mt-5 grid gap-4"
          >
            <Field
              label="Conversation title"
              name="title"
              maxLength={120}
              required
              placeholder="Morning inventory review"
            />
            <SubmitButton pendingLabel="Starting…">
              Start conversation
            </SubmitButton>
          </ActionForm>
        </div>
        <aside className="border-l-4 border-[var(--warning)] bg-[var(--surface)] p-5 text-sm leading-6">
          <h2 className="font-semibold">Safety boundary</h2>
          <p className="mt-2">
            The assistant cannot run SQL, browse the schema, reveal contacts,
            change inventory, or send messages. An alert acknowledgement is the
            only confirmable action in this initial slice.
          </p>
        </aside>
      </section>

      <section className="grid gap-4">
        <h2 className="text-2xl font-semibold">Your conversations</h2>
        {conversations.length === 0 ? (
          <EmptyState
            title="No assistant conversations"
            description="Create a conversation to run a scoped inventory, forecast, or alert query."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {conversations.map((conversation) => (
              <Link
                key={conversation.id}
                href={`/app/${organizationSlug}/assistant/${conversation.id}`}
                className="border border-[var(--rule)] bg-white p-5 focus:outline-2 focus:outline-offset-2 focus:outline-[var(--ink)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">{conversation.title}</h3>
                  <StatusBadge status={conversation.status} />
                </div>
                <p className="mt-3 text-sm text-[var(--muted)]">
                  {conversation.message_count} messages · updated{" "}
                  {new Date(conversation.updated_at).toLocaleString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4">
        <h2 className="text-2xl font-semibold">Fixed tool registry</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {tools.map((tool) => (
            <article
              key={tool.name}
              className="border border-[var(--rule)] bg-white p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="text-sm font-semibold">{tool.name}</code>
                <StatusBadge status={tool.class} />
              </div>
              <p className="mt-3 text-sm leading-6">{tool.description}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Requires {tool.requiredPermission}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
