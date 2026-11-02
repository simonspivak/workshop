"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "@/components/platform/ui";

/** Кнопка отправки формы: пока Server Action работает, она выключена (защита от двойного клика). */
export function SubmitButton({
  children,
  pendingText = "Сохраняем…",
  variant = "primary",
  size = "md",
  className = "",
  name,
  value,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-disabled={pending}
      className={`${buttonClass(variant, size)} ${className}`}
    >
      {pending ? pendingText : children}
    </button>
  );
}
