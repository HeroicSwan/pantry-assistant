import type { ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "quiet";
};

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-sm font-semibold shadow-sm transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
        variant === "primary" &&
          "border-[var(--signal)] bg-[var(--signal)] text-white hover:border-[var(--signal-dark)] hover:bg-[var(--signal-dark)]",
        variant === "secondary" &&
          "border-[var(--ink)] bg-white text-[var(--ink)] hover:bg-[var(--surface)]",
        variant === "danger" &&
          "border-[var(--signal)] bg-white text-[var(--signal)] hover:bg-[var(--signal)] hover:text-white",
        variant === "quiet" &&
          "border-transparent bg-transparent text-[var(--ink)] hover:border-[var(--rule)] hover:bg-white",
        className,
      )}
      {...props}
    />
  );
}
