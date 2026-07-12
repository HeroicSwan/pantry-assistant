import Link from "next/link";

const scopeSteps = ["Account", "Organization", "Location", "Access"];

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen bg-[var(--surface)] lg:grid-cols-[minmax(280px,0.7fr)_minmax(0,1.3fr)]">
      <aside className="grid-surface border-b border-[var(--rule)] p-6 lg:border-r lg:border-b-0 lg:p-10">
        <div className="flex h-full max-w-md flex-col justify-between gap-12">
          <Link href="/" className="text-lg font-bold tracking-[-0.03em]">
            Food Pantry Operations
          </Link>
          <ol className="grid border-t border-[var(--ink)]">
            {scopeSteps.map((step, index) => (
              <li
                key={step}
                className="grid grid-cols-[52px_1fr] border-b border-[var(--rule)] py-4"
              >
                <span className="tabular text-2xl font-semibold text-[var(--signal)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="self-center text-sm font-semibold">
                  {step}
                </span>
              </li>
            ))}
          </ol>
          <p className="max-w-xs text-sm leading-6 text-[var(--muted)]">
            Authentication establishes identity. Organization membership and
            location assignments determine access.
          </p>
        </div>
      </aside>
      <section className="flex items-center justify-center p-6 sm:p-10 lg:p-16">
        <div className="page-enter w-full max-w-xl border-t-4 border-[var(--signal)] bg-white p-6 sm:p-10">
          <header className="mb-8 border-b border-[var(--rule)] pb-6">
            <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              {title}
            </h1>
            <p className="mt-4 max-w-lg leading-7 text-[var(--muted)]">
              {description}
            </p>
          </header>
          {children}
          {footer ? (
            <footer className="mt-8 border-t border-[var(--rule)] pt-6 text-sm text-[var(--muted)]">
              {footer}
            </footer>
          ) : null}
        </div>
      </section>
    </main>
  );
}
