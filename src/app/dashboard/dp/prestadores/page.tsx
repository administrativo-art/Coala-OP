"use client";
import { ServiceProvidersAdmin } from "@/features/service-portal/admin-panel";
import { PageHero } from "@/components/patterns/page-hero";
import { useAuth } from "@/hooks/use-auth";
import { resolveUnitAccess } from "@/lib/unit-access";

export default function ServiceProvidersPage() {
  const { firebaseUser, user, permissions, isDefaultAdmin } = useAuth();
  const allowed = isDefaultAdmin || (permissions.dp?.timeClosure?.close === true
    && permissions.dp?.requests?.review === true
    && user && resolveUnitAccess(user).allUnits);
  if (!allowed) return <p className="p-6">A gestão de prestadores exige revisão e fechamento do RH com acesso a todas as unidades.</p>;
  return <div className="system-standard-page space-y-5 pb-8 font-ds">
    <PageHero kicker="Departamento Pessoal · Acessos externos" title="Prestadores de serviço" subtitle="Gerencie escritórios, profissionais de contabilidade e acesso às competências." />
    <ServiceProvidersAdmin firebaseUser={firebaseUser} />
  </div>;
}
