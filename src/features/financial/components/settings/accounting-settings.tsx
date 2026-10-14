"use client";

import { useState } from "react";
import { Segmented } from "@/components/patterns/segmented";
import AccountPlansManagement from "./account-plans-management";
import ExpenseDescriptionsManagement from "./expense-descriptions-management";
import ResultCentersManagement from "./result-centers-management";

type Section = "plan" | "centers" | "descriptions";

export interface AccountingSettingsPermissions {
  manageAccountPlans?: boolean;
  manageResultCenters?: boolean;
  /** Sem esta permissão a seção de descrições não é oferecida. */
  manageExpenseDescriptions?: boolean;
}

/** Contabilidade: uma seção por vez, cada uma com seu cabeçalho de busca e painel lateral. */
export function AccountingSettings({ permissions }: { permissions: AccountingSettingsPermissions }) {
  const [section, setSection] = useState<Section>("plan");
  const options = [
    { value: "plan" as const, label: "Plano de contas" },
    { value: "centers" as const, label: "Centros de resultado" },
    ...(permissions.manageExpenseDescriptions ? [{ value: "descriptions" as const, label: "Descrições" }] : []),
  ];

  return (
    <div className="space-y-5">
      <Segmented value={section} onChange={setSection} options={options} aria-label="Seção de contabilidade" />
      {section === "plan" ? <AccountPlansManagement canManage={permissions.manageAccountPlans} /> : null}
      {section === "centers" ? <ResultCentersManagement canManage={permissions.manageResultCenters} /> : null}
      {section === "descriptions" && permissions.manageExpenseDescriptions ? (
        <ExpenseDescriptionsManagement canManage={permissions.manageExpenseDescriptions} />
      ) : null}
    </div>
  );
}
