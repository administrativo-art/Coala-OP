"use client";

import { UniformManagement } from "@/components/uniform-management";
import { PageHero } from "@/components/patterns/page-hero";

export default function UniformsPage() {
  return (
    <div className="min-h-[calc(100vh-8rem)] space-y-5">
      <PageHero
        kicker="Gestão de estoque"
        title="Controle de Uniformes"
        subtitle="Peças novas, usadas, entregas, devoluções e peças em posse dos colaboradores."
      />
      <UniformManagement />
    </div>
  );
}
