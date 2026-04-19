"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import AccountPlansManagement from "@/features/financial/components/settings/account-plans-management";
import BankAccountsManagement from "@/features/financial/components/settings/bank-accounts-management";
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
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="accounting">Contabilidade</TabsTrigger>
          <TabsTrigger value="accounts">Contas</TabsTrigger>
          <TabsTrigger value="import">Importação</TabsTrigger>
        </TabsList>
        <TabsContent value="accounting" className="space-y-6">
          <AccountPlansManagement canManage={permissions.financial?.settings?.manageAccountPlans} />
          <ResultCentersManagement canManage={permissions.financial?.settings?.manageResultCenters} />
        </TabsContent>
        <TabsContent value="accounts">
          <BankAccountsManagement canManage={permissions.financial?.settings?.manageBankAccounts} />
        </TabsContent>
        <TabsContent value="import">
          <ImportAliasesManagement canManage={permissions.financial?.settings?.manageImportAliases} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
