"use client";

import Link from "next/link";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronRight } from "lucide-react";

const PricingParametersModal = dynamic(
  () => import("@/components/pricing-parameters-modal").then((m) => m.PricingParametersModal),
  { ssr: false }
);
const CompetitorManagementModal = dynamic(
  () => import("@/components/competitor-management-modal").then((m) => m.CompetitorManagementModal),
  { ssr: false }
);
const GoalTemplateFormModal = dynamic(
  () => import("@/components/goal-template-form-modal").then((m) => m.GoalTemplateFormModal),
  { ssr: false }
);

function SettingsCard({
  title,
  description,
  actionLabel,
  onManage,
  href,
  hrefLabel,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onManage?: () => void;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-5 py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="flex flex-col gap-2 sm:ml-4 sm:shrink-0">
          {href && hrefLabel && (
            <Button asChild variant="outline" className="gap-1.5">
              <Link href={href}>
                {hrefLabel}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
          {onManage && actionLabel && (
            <Button variant="outline" onClick={onManage} className="gap-1.5">
              {actionLabel}
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ComercialSettings() {
  const { permissions } = useAuth();
  const [pricingOpen, setPricingOpen] = useState(false);
  const [competitorOpen, setCompetitorOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);

  const tabs = [
    {
      value: "pricing",
      label: "Precificação",
      show: !!(permissions.pricing.view || permissions.pricing.manageParameters),
      content: (
        <div className="space-y-4">
          <SettingsCard
            title="Parâmetros de Precificação"
            description="Taxas, margens de lucro, metas e categorias de simulação."
            href="/dashboard/pricing"
            hrefLabel="Abrir módulo"
            actionLabel="Gerenciar parâmetros"
            onManage={permissions.pricing.manageParameters ? () => setPricingOpen(true) : undefined}
          />
        </div>
      ),
    },
    {
      value: "competitors",
      label: "Concorrentes",
      show: !!permissions.pricing.view,
      content: (
        <div className="space-y-4">
          <SettingsCard
            title="Concorrentes"
            description="Grupos, unidades e produtos dos concorrentes monitorados."
            href="/dashboard/pricing/price-comparison"
            hrefLabel="Abrir estudo"
            actionLabel="Gerenciar concorrentes"
            onManage={() => setCompetitorOpen(true)}
          />
        </div>
      ),
    },
    {
      value: "goals",
      label: "Metas",
      show: !!(permissions.goals?.view || permissions.goals?.manage),
      content: (
        <div className="space-y-4">
          <SettingsCard
            title="Templates de Metas"
            description="Modelos reutilizáveis para criação de metas de vendas por período."
            href="/dashboard/goals/tracking"
            hrefLabel="Abrir módulo"
            actionLabel="Gerenciar templates"
            onManage={permissions.goals?.manage ? () => setGoalsOpen(true) : undefined}
          />
        </div>
      ),
    },
  ].filter((tab) => tab.show);

  const defaultTab = tabs[0]?.value;

  if (!defaultTab) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-center text-muted-foreground">
        <p className="text-sm font-medium">Sem configurações comerciais disponíveis para este perfil.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue={defaultTab} className="space-y-6">
        <TabsList className="flex w-full overflow-x-auto">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-shrink-0">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>

      <PricingParametersModal open={pricingOpen} onOpenChange={setPricingOpen} />
      <CompetitorManagementModal isOpen={competitorOpen} onClose={() => setCompetitorOpen(false)} />
      <GoalTemplateFormModal open={goalsOpen} onOpenChange={setGoalsOpen} />
    </div>
  );
}
