import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { forgotPasswordAction } from "@/domains/auth/actions";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter your account email. For privacy, the response is the same whether or not an account matches."
      footer={
        <Link className="font-semibold underline" href="/sign-in">
          Return to sign in
        </Link>
      }
    >
      <AuthForm action={forgotPasswordAction} mode="forgot" />
    </AuthShell>
  );
}
