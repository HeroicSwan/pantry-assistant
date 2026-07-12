import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { signInAction } from "@/domains/auth/actions";
import { safeNextPath } from "@/domains/auth/schemas";
import { getCurrentUser } from "@/lib/auth/access";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const parameters = await searchParams;
  return (
    <AuthShell
      title="Sign in"
      description="Use your pantry account. Access is checked again against active organization membership and location assignments."
      footer={
        <span>
          New to the platform?{" "}
          <Link className="font-semibold underline" href="/sign-up">
            Create an account
          </Link>
          .
        </span>
      }
    >
      <AuthForm
        action={signInAction}
        mode="sign-in"
        nextPath={safeNextPath(parameters.next, "/")}
      />
      <Link
        className="mt-5 inline-block text-sm font-semibold underline"
        href="/forgot-password"
      >
        Forgot your password?
      </Link>
    </AuthShell>
  );
}
