export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="grid gap-6 border-b border-[var(--ink)] pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
      <div>
        <p className="mb-3 text-sm font-semibold text-[var(--signal)]">
          {eyebrow}
        </p>
        <h1 className="text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">
          {description}
        </p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
