import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import {
  getCurrentProfile,
  getOrganizationAccessList,
  requireUser,
} from "@/lib/auth/access";

export default async function OnboardingPage() {
  const user = await requireUser();
  if ((await getOrganizationAccessList()).length > 0) redirect("/");
  const profile = await getCurrentProfile();
  return (
    <main className="min-h-screen bg-[var(--surface)]">
      <header className="grid-surface border-b border-[var(--rule)] px-6 py-8 sm:px-10 lg:px-16">
        <p className="text-sm font-semibold">Pantry Assistant</p>
        <div className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <h1 className="max-w-3xl text-5xl font-semibold tracking-[-0.055em] sm:text-7xl">
            Set up your organization
          </h1>
          <p className="max-w-xl self-end text-base leading-7 text-[var(--muted)]">
            Create the organization boundary, its first pantry location, and the
            administrator membership that will control later access.
          </p>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-6 py-10 sm:px-10 lg:px-16">
        <OnboardingForm
          initialDisplayName={
            profile?.displayName ??
            user.email?.split("@")[0] ??
            "Pantry administrator"
          }
          initialEmail={user.email ?? ""}
        />
      </section>
    </main>
  );
}
