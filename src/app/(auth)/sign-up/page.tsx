import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { signUpAction } from "@/domains/auth/actions";
import { getCurrentUser } from "@/lib/auth/access";

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <AuthShell
      title="Create an account"
      description="Create your identity first. The next step creates an organization, its first location, and your administrator membership in one transaction."
      footer={
        <span>
          Already registered?{" "}
          <Link className="font-semibold underline" href="/sign-in">
            Sign in
          </Link>
          .
        </span>
      }
    >
      <AuthForm action={signUpAction} mode="sign-up" />
    </AuthShell>
  );
}
