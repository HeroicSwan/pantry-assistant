import { clsx } from "clsx";

export function StatusBadge({ status }: { status: string }) {
  const blocked = ["suspended", "archived", "revoked", "expired"].includes(
    status,
  );
  const warning = ["temporarily_closed", "invited", "pending"].includes(status);
  return (
    <span
      className={clsx(
        "inline-flex border px-2 py-1 text-xs font-semibold capitalize",
        blocked && "border-[var(--signal)] text-[var(--signal)]",
        warning && "border-[#b76b00] text-[var(--warning)]",
        !blocked && !warning && "border-[#2b7a45] text-[var(--success)]",
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
