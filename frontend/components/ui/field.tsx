"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { cn } from "@/lib/format/cn";

/** Doc 05 §8.6 — HUD form controls: 1px grid border, flow focus ring, machine labels. */

const FIELD =
  "w-full rounded-chip border border-grid bg-canvas px-2 py-1 font-machine text-machine-sm text-primary placeholder:text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow disabled:cursor-not-allowed disabled:text-disabled";

const LABEL = "text-hud-micro uppercase tracking-[0.08em] text-secondary";

export type FieldProps = {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className={LABEL}>
        {label}
        {required ? <span className="ml-1 text-critical-hot">*</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-hud-micro text-critical-hot">
          {error}
        </p>
      ) : hint ? (
        <p className="text-hud-micro text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  id?: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  fieldClassName?: string;
};

export function TextField({ id, label, hint, error, required, fieldClassName, className, ...rest }: TextFieldProps) {
  const fallback = useId();
  const inputId = id ?? `field-${fallback}`;
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} required={required} className={fieldClassName}>
      <input
        {...rest}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={cn(FIELD, error && "border-critical/60", className)}
      />
    </Field>
  );
}

export type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  id?: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  fieldClassName?: string;
};

export function TextAreaField({
  id,
  label,
  hint,
  error,
  required,
  fieldClassName,
  className,
  ...rest
}: TextAreaFieldProps) {
  const fallback = useId();
  const areaId = id ?? `field-${fallback}`;
  return (
    <Field label={label} htmlFor={areaId} hint={hint} error={error} required={required} className={fieldClassName}>
      <textarea
        {...rest}
        id={areaId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(FIELD, "resize-y leading-relaxed", error && "border-critical/60", className)}
      />
    </Field>
  );
}

export type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
  id?: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  options: readonly { value: string; label: string }[];
  fieldClassName?: string;
};

export function SelectField({
  id,
  label,
  hint,
  error,
  required,
  options,
  fieldClassName,
  className,
  ...rest
}: SelectFieldProps) {
  const fallback = useId();
  const selectId = id ?? `field-${fallback}`;
  return (
    <Field label={label} htmlFor={selectId} hint={hint} error={error} required={required} className={fieldClassName}>
      <select
        {...rest}
        id={selectId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(FIELD, "cursor-pointer", error && "border-critical/60", className)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
