import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="max-w-lg border-t-4 border-[var(--signal)] bg-white p-8">
        <p className="tabular text-sm font-semibold text-[var(--signal)]">
          404
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Page unavailable</h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          The record does not exist or is outside your organization and location
          access.
        </p>
        <Link className="mt-6 inline-block font-semibold underline" href="/">
          Return to your workspace
        </Link>
      </section>
    </main>
  );
}
