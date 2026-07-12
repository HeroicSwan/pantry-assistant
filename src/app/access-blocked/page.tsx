import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/domains/auth/actions";
import { requireUser } from "@/lib/auth/access";

export default async function AccessBlockedPage() {
  await requireUser();
  return (
    <AuthShell
      title="Access is blocked"
      description="Your account is signed in, but no active organization membership is available. An organization administrator must restore or replace your membership."
    >
      <form action={signOutAction}>
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </AuthShell>
  );
}
