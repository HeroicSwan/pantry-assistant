import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { resetPasswordAction } from "@/domains/auth/actions";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const parameters = await searchParams;
  const token = parameters.token ?? "";
  return (
    <AuthShell title="Set a new password" description={token ? "Choose a new password for this recovery request." : "This password reset link is missing or has expired."}>
      {token ? <AuthForm action={resetPasswordAction} mode="reset" resetToken={token} /> : null}
    </AuthShell>
  );
}
