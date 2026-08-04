"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type CentsInputProps = {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

function display(cents: number | null) {
  if (cents === null) return "";
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function CentsInput({ value, onChange, disabled, className, ariaLabel }: CentsInputProps) {
  const [text, setText] = useState(() => display(value));

  useEffect(() => setText(display(value)), [value]);

  return (
    <div className="relative min-w-[140px]">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        R$
      </span>
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        disabled={disabled}
        value={text}
        placeholder="0,00"
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "");
          if (!digits) {
            setText("");
            onChange(null);
            return;
          }
          const cents = Number.parseInt(digits, 10);
          setText(display(cents));
          onChange(cents);
        }}
        className={cn(
          "h-10 w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-right text-sm tabular-nums ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      />
    </div>
  );
}
