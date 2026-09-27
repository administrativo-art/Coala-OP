"use client";

import Link from "next/link";
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
  // Do not mount the data-consuming workspace for a profile without audit access.
  if (permissions.financial?.audits?.view !== true) {
    return <PageContainer><FinancialAccessGuard title="Extratos bancários" description="Seu perfil não possui permissão para consultar auditorias de extratos." /></PageContainer>;
  }
  return <PageContainer variant="wide" className="space-y-6 pb-10">
    <PageHeader title="Extratos bancários" description="Importe o extrato, confira as movimentações e vincule cada uma ao registro correspondente."
      actions={<Button asChild variant="outline"><Link href={expensesReturnHref(searchParams.get("returnTo"))}>Voltar a Despesas</Link></Button>} />
    <FinancialImportPage embedded />
  </PageContainer>;
}
