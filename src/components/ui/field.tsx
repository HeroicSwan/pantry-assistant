"use client";

import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";
import { clsx } from "clsx";

type SharedProps = {
  label: string;
  hint?: string;
  error?: string;
};

export function Field({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: SharedProps & InputHTMLAttributes<HTMLInputElement>) {
  const generatedId = useId();
  const fieldId = id ?? `${props.name ?? "field"}-${generatedId}`;
  return (
    <label className="grid gap-2 text-sm font-medium" htmlFor={fieldId}>
      <span>{label}</span>
      <input
        id={fieldId}
        className={clsx(
          "min-h-11 w-full rounded-xl border border-[var(--rule)] bg-white px-3 py-2 text-[var(--ink)] placeholder:text-[#777] shadow-sm transition-[border-color,box-shadow] focus:border-[var(--ink)] focus:shadow-[0_0_0_4px_rgba(17,17,17,0.06)]",
          error && "border-[var(--signal)]",
          className,
        )}
        aria-invalid={Boolean(error)}
        aria-describedby={
          error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
        }
        {...props}
      />
      {hint && !error ? (
        <span
          id={`${fieldId}-hint`}
          className="font-normal text-[var(--muted)]"
        >
          {hint}
        </span>
      ) : null}
      {error ? (
        <span
          id={`${fieldId}-error`}
          className="font-normal text-[var(--signal)]"
        >
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  id,
  children,
  ...props
}: SharedProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const generatedId = useId();
  const fieldId = id ?? `${props.name ?? "select"}-${generatedId}`;
  return (
    <label className="grid gap-2 text-sm font-medium" htmlFor={fieldId}>
      <span>{label}</span>
      <select
        id={fieldId}
        className={clsx(
          "min-h-11 w-full rounded-xl border border-[var(--rule)] bg-white px-3 py-2 shadow-sm transition-[border-color,box-shadow] focus:border-[var(--ink)] focus:shadow-[0_0_0_4px_rgba(17,17,17,0.06)]",
          error && "border-[var(--signal)]",
          className,
        )}
        aria-invalid={Boolean(error)}
        {...props}
      >
        {children}
      </select>
      {hint && !error ? (
        <span className="font-normal text-[var(--muted)]">{hint}</span>
      ) : null}
      {error ? (
        <span className="font-normal text-[var(--signal)]">{error}</span>
      ) : null}
    </label>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: SharedProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generatedId = useId();
  const fieldId = id ?? `${props.name ?? "textarea"}-${generatedId}`;
  return (
    <label className="grid gap-2 text-sm font-medium" htmlFor={fieldId}>
      <span>{label}</span>
      <textarea
        id={fieldId}
        className={clsx(
          "min-h-28 w-full resize-y rounded-xl border border-[var(--rule)] bg-white px-3 py-2 shadow-sm transition-[border-color,box-shadow] focus:border-[var(--ink)] focus:shadow-[0_0_0_4px_rgba(17,17,17,0.06)]",
          error && "border-[var(--signal)]",
          className,
        )}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {hint && !error ? (
        <span className="font-normal text-[var(--muted)]">{hint}</span>
      ) : null}
      {error ? (
        <span className="font-normal text-[var(--signal)]">{error}</span>
      ) : null}
    </label>
  );
}
