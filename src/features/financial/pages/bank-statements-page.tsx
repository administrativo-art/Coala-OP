"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { FinancialAccessGuard } from "../components/financial-access-guard";
import { expensesReturnHref } from "../lib/reconciliation-navigation";
import { FinancialImportPage } from "./import-page";

export function BankStatementsPage() {
  const { permissions } = useAuth();
  const searchParams = useSearchParams();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  // Do not mount the data-consuming workspace for a profile without audit access.
  if (permissions.financial?.audits?.view !== true) {
    return <PageContainer surface><FinancialAccessGuard title="Extratos bancários" description="Seu perfil não possui permissão para consultar auditorias de extratos." /></PageContainer>;
  }
  return <PageContainer variant="wide" surface className="space-y-6 pb-10">
    <PageHeader
      title="Extratos bancários"
      back={{
        fallbackHref: expensesReturnHref(searchParams.get("returnTo")),
        parentLabel: "Despesas",
      }}
      actions={permissions.financial?.audits?.import === true ? (
        <Button
          type="button"
          size="sm"
          onClick={() => setImportDialogOpen(true)}
          className="h-9 rounded-[11px] bg-[#db2777] px-[14px] text-[13px] font-extrabold text-white hover:bg-[#be185d]"
        >
          <Upload className="mr-2 h-4 w-4" />
          Importar extrato
        </Button>
      ) : null}
    />
    <FinancialImportPage
      embedded
      showImportControls={false}
      importDialogOpen={importDialogOpen}
      onImportDialogOpenChange={setImportDialogOpen}
    />
  </PageContainer>;
}
