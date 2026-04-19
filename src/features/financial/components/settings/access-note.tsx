"use client";

import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function FinancialAccessNote() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Acesso e permissões
        </CardTitle>
        <CardDescription>
          O módulo financeiro usa a autenticação do OP e espelha as permissões definidas nos perfis globais.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
        <p>
          Usuários e perfis de acesso do financeiro não são mantidos aqui. Para habilitar ou restringir acesso, ajuste o perfil do usuário nas configurações globais do OP.
        </p>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/settings">
              Abrir configurações do OP
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
