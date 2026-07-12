"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="max-w-lg border-t-4 border-[var(--signal)] bg-white p-8">
        <h1 className="text-3xl font-semibold">The page could not be loaded</h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          Your last confirmed change is not hidden. Retry the request, or
          refresh and check the authoritative page state.
        </p>
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </section>
    </main>
  );
}
