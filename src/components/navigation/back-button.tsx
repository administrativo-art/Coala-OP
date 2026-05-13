"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BackButtonProps = {
  fallbackHref: string;
  label?: string;
  ariaLabel?: string;
  iconOnly?: boolean;
  className?: string;
  iconClassName?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
};

export function BackButton({
  fallbackHref,
  label = "Voltar",
  ariaLabel,
  iconOnly = false,
  className,
  iconClassName,
  variant = "outline",
  size = "sm",
}: BackButtonProps) {
  const router = useRouter();

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(fallbackHref);
  }

  return (
    <Button
      type="button"
      onClick={handleBack}
      variant={variant}
      size={iconOnly ? "icon" : size}
      aria-label={ariaLabel ?? label}
      className={className}
    >
      <ArrowLeft className={cn(iconOnly ? "h-6 w-6" : "mr-2 h-4 w-4", iconClassName)} />
      {iconOnly ? null : label}
    </Button>
  );
}
