"use client";

import { useState } from "react";

import { Segmented } from "@/components/patterns/segmented";
import { DPLoginAccessAudit } from "@/components/dp/dp-login-access-audit";
import { DPLoginAccessDiagnostic } from "@/components/dp/dp-login-access-diagnostic";

type View = "diagnostic" | "audit";

/** Acesso por escala: diagnóstico da regra atual e auditoria das justificativas, uma visão por vez. */
export function DPLoginAccessSettings() {
  const [view, setView] = useState<View>("diagnostic");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-ds-ink-muted">
          Esta área reúne o diagnóstico da regra atual e a auditoria das justificativas já registradas.
        </p>
        <Segmented<View>
          aria-label="Visão do acesso por escala"
          value={view}
          onChange={setView}
          options={[
            { value: "diagnostic", label: "Diagnóstico" },
            { value: "audit", label: "Auditoria" },
          ]}
        />
      </div>
      {view === "diagnostic" ? <DPLoginAccessDiagnostic /> : <DPLoginAccessAudit />}
    </div>
  );
}
