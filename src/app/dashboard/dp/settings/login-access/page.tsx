"use client";

import { DPLoginAccessAudit } from "@/components/dp/dp-login-access-audit";
import { DPLoginAccessDiagnostic } from "@/components/dp/dp-login-access-diagnostic";
import { useAuth } from "@/hooks/use-auth";

export default function DPSettingsLoginAccessPage() {
  const { permissions } = useAuth();

  if (
    !permissions.settings?.manageUsers &&
    !permissions.dp?.collaborators?.edit &&
    !permissions.dp?.collaborators?.terminate
  ) {
    return (
      <p className="p-6 text-muted-foreground">
        Sem permissão para diagnosticar acesso por escala.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Esta área reúne o diagnóstico da regra atual e a auditoria das justificativas já registradas.
      </p>
      <DPLoginAccessDiagnostic />
      <DPLoginAccessAudit />
    </div>
  );
}
