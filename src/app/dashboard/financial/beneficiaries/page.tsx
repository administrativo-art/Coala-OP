"use client";

import BeneficiariesManagement from "@/features/financial/components/settings/beneficiaries-management";
import { useAuth } from "@/hooks/use-auth";

export default function FinancialBeneficiariesPage() {
  const { permissions } = useAuth();
  if (!permissions.financial?.beneficiaries?.view) {
    return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Seu perfil não possui permissão para visualizar favorecidos.</div>;
  }
  return <BeneficiariesManagement />;
}
