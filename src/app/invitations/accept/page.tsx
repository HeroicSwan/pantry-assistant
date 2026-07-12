import { ActionForm } from "@/components/ui/action-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { SubmitButton } from "@/components/ui/submit-button";
import { acceptInvitationAction } from "@/domains/admin/actions";
import { requireUser } from "@/lib/auth/access";

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  await requireUser();
  const { token = "" } = await searchParams;
  return (
    <AuthShell
      title="Accept organization invitation"
      description="Acceptance verifies this signed-in account against the invitation email, then creates only the membership and scoped role included in the invitation."
    >
      <ActionForm action={acceptInvitationAction.bind(null, token)}>
        <SubmitButton pendingLabel="Accepting…">Accept invitation</SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
