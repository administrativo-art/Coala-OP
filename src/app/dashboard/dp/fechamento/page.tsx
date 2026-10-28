"use client";

import { PageHero } from "@/components/patterns/page-hero";
import { CompetenceClosureSection } from "@/features/dp/time-adjustments/closure-section";
import { useAuth } from "@/hooks/use-auth";

export default function DpTimeClosurePage() {
  const { firebaseUser, permissions, isDefaultAdmin, activeUsers } = useAuth();
  if (!isDefaultAdmin && permissions.dp?.timeClosure?.close !== true && permissions.dp?.timeClosure?.reopen !== true) {
    return <p className="p-6 text-muted-foreground">Sem permissão para acessar o fechamento do ponto.</p>;
  }
  return (
    <div className="system-standard-page space-y-5 pb-8 font-ds">
      <PageHero
        kicker="Departamento Pessoal · Gestão do colaborador"
        title="Fechamento do ponto"
        subtitle="Congela o mês com a declaração de cada pessoa. Pedido de ausência ou ajuste sem decisão impede o fechamento."
      />
      <CompetenceClosureSection firebaseUser={firebaseUser} people={activeUsers} />
    </div>
  );
}
