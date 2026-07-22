export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="pantry-empty-state grid min-h-56 place-items-center border border-dashed border-[var(--rule)] bg-white p-8 text-center">
      <div className="max-w-md">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-3 leading-6 text-[var(--muted)]">{description}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </section>
  );
}
