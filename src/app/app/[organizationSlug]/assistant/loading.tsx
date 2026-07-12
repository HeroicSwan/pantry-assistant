export default function AssistantLoading() {
  return (
    <div className="grid gap-6" role="status" aria-live="polite">
      <div className="h-28 animate-pulse bg-[var(--surface)]" />
      <div className="h-64 animate-pulse border border-[var(--rule)] bg-white" />
      <span className="sr-only">Loading controlled assistant</span>
    </div>
  );
}
