"use client";

import { BookMarked, Building2, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import AccountPlansManagement from "@/features/financial/components/settings/account-plans-management";
import BankAccountsManagement from "@/features/financial/components/settings/bank-accounts-management";
import ExpenseDescriptionsManagement from "@/features/financial/components/settings/expense-descriptions-management";
import ImportAliasesManagement from "@/features/financial/components/settings/import-aliases-management";
import ResultCentersManagement from "@/features/financial/components/settings/result-centers-management";
import { useAuth } from "@/hooks/use-auth";

export function FinancialSettingsPage() {
  const { permissions } = useAuth();

  if (!permissions.financial?.settings?.view) {
    return (
      <FinancialAccessGuard
        title="Configurações financeiras"
        description="Seu perfil não possui permissão para acessar os cadastros e parâmetros do módulo financeiro."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="accounting" className="w-full">
        <div className="flex justify-end">
          <TabsList className="grid h-auto w-full max-w-[520px] grid-cols-3 rounded-2xl border bg-background p-1 shadow-sm">
            <TabsTrigger value="accounting" className="rounded-xl px-4 py-2.5 text-sm font-semibold">
              <span className="inline-flex items-center gap-2">
                <BookMarked className="h-4 w-4" />
                Contabilidade
              </span>
            </TabsTrigger>
            <TabsTrigger value="accounts" className="rounded-xl px-4 py-2.5 text-sm font-semibold">
              <span className="inline-flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Contas
              </span>
            </TabsTrigger>
            <TabsTrigger value="import" className="rounded-xl px-4 py-2.5 text-sm font-semibold">
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Importação
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="accounting" className="mt-4 space-y-6">
          <AccountPlansManagement canManage={permissions.financial?.settings?.manageAccountPlans} />
          <ResultCentersManagement canManage={permissions.financial?.settings?.manageResultCenters} />
          {permissions.financial?.settings?.manageExpenseDescriptions ? (
            <ExpenseDescriptionsManagement canManage={permissions.financial?.settings?.manageExpenseDescriptions} />
          ) : null}
        </TabsContent>
        <TabsContent value="accounts" className="mt-4">
          <BankAccountsManagement canManage={permissions.financial?.settings?.manageBankAccounts} />
        </TabsContent>
        <TabsContent value="import" className="mt-4">
          <ImportAliasesManagement canManage={permissions.financial?.settings?.manageImportAliases} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
