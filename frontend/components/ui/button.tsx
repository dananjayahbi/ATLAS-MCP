"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format/cn";

/** Doc 05 §8.7 — square icon action; `label` is mandatory (aria-label + tooltip). */

export type ButtonVariant = "primary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border-flow bg-flow text-inverse hover:bg-flow-dim",
  ghost: "border-transparent text-secondary hover:bg-raised hover:text-primary",
  outline: "border-grid text-secondary hover:border-grid-strong hover:text-primary",
  danger: "border-critical/50 bg-critical-tint text-critical-hot hover:border-critical hover:bg-critical/20",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-6 px-2 text-hud-micro",
  md: "h-7 px-2.5 text-hud-label",
};

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
};

export function Button({
  variant = "outline",
  size = "sm",
  icon,
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-hud border font-ui uppercase tracking-[0.06em] transition-colors duration-100",
        FOCUS,
        SIZES[size],
        VARIANTS[variant],
        (disabled || loading) && "cursor-not-allowed border-grid text-disabled hover:border-grid hover:bg-transparent",
        className,
      )}
    >
      {icon ? <span aria-hidden>{icon}</span> : null}
      {children}
    </button>
  );
}

export type IconButtonProps = Omit<ButtonProps, "children" | "icon"> & {
  /** Required: becomes `aria-label` and the native tooltip. */
  label: string;
  icon: ReactNode;
  active?: boolean;
};

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "sm",
  active,
  className,
  disabled,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-hud border transition-colors duration-100",
        FOCUS,
        size === "sm" ? "size-6" : "size-7",
        VARIANTS[variant],
        active && "border-flow/40 bg-flow-tint text-flow",
        disabled && "cursor-not-allowed border-transparent text-disabled hover:bg-transparent",
        className,
      )}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}
