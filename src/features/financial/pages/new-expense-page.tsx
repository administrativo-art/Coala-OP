"use client";

import { ExpenseForm } from "@/features/financial/components/expenses/expense-form";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { useAuth } from "@/hooks/use-auth";

export function NewExpensePage() {
  const { permissions } = useAuth();

  if (!permissions.financial?.expenses?.create) {
    return (
      <FinancialAccessGuard
        title="Lançar despesa"
        description="Seu perfil não possui permissão para criar novas despesas no módulo financeiro."
        backHref="/dashboard/financial/expenses"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Lançar despesa</h1>
        <p className="text-muted-foreground">
          Preencha os campos abaixo para provisionar uma nova despesa no módulo financeiro.
        </p>
      </div>
      <ExpenseForm />
    </div>
  );
}
