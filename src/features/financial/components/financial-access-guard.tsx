"use client";

import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
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
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
