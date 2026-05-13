"use client";

import { LockKeyhole } from "lucide-react";
import { BackButton } from "@/components/navigation/back-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type FinancialAccessGuardProps = {
  title: string;
  description: string;
  backHref?: string;
};

export function FinancialAccessGuard({
  title,
  description,
  backHref = "/dashboard/financial",
}: FinancialAccessGuardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockKeyhole className="h-4 w-4 text-amber-500" />
          Acesso restrito
        </CardTitle>
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div>
          <BackButton fallbackHref={backHref} />
        </div>
      </CardContent>
    </Card>
  );
}
