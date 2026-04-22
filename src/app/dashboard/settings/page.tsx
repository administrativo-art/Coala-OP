"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronRight, Settings2 } from "lucide-react";
import { PermissionGuard } from "@/components/permission-guard";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { ChartLineUp, Storefront, Users, Wallet } from "@phosphor-icons/react";

const UserManagement = dynamic(
  () => import("@/components/user-management").then((m) => m.UserManagement),
  { ssr: false }
);
const CalendarManagement = dynamic(
  () => import("@/components/calendar-management").then((m) => m.CalendarManagement),
  { ssr: false }
);
const DPSettingsShifts = dynamic(
  () => import("@/components/dp/dp-settings-shifts").then((m) => m.DPSettingsShifts),
  { ssr: false }
);
const KioskManagement = dynamic(
  () => import("@/components/kiosk-management").then((m) => m.KioskManagement),
  { ssr: false }
);
const PdvSyncManagement = dynamic(
  () => import("@/components/pdv-sync-management").then((m) => m.PdvSyncManagement),
  { ssr: false }
);

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4 border-b pb-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  );
}

function EmptySection({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-center text-muted-foreground">
      <Settings2 className="h-8 w-8 opacity-30" />
      <p className="text-sm font-medium">Configurações de {label}</p>
      <p className="text-xs opacity-60">Em breve disponíveis aqui.</p>
    </div>
  );
}

function SettingsLaunchPanel({
  title,
  description,
  href,
  actionLabel,
}: {
  title: string;
  description: string;
  href: string;
  actionLabel: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-5 py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <Button asChild variant="outline" className="gap-1.5 sm:ml-4 sm:shrink-0">
          <Link href={href}>
            {actionLabel}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

type NestedTab = {
  value: string;
  label: string;
  title: string;
  description: string;
  content: React.ReactNode;
};

type DepartmentTab = {
  value: string;
  label: string;
  icon: React.ReactNode;
  tabs: NestedTab[];
  emptyLabel: string;
};

function SegmentedTabs<T extends { value: string; label: string; icon?: React.ReactNode }>({
  tabs,
  value,
  onChange,
  withIcons = false,
}: {
  tabs: T[];
  value: string;
  onChange: (value: string) => void;
  withIcons?: boolean;
}) {
  return (
    <div className="max-w-full overflow-x-auto">
      <div className="inline-flex min-w-max rounded-md border border-border bg-background">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap border-r border-border transition-all last:border-r-0",
              withIcons ? "px-4 py-2 text-xs" : "px-3.5 py-1.5 text-xs",
              value === tab.value
                ? "bg-[#FBEAF0] font-medium text-[#993556]"
                : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {withIcons ? tab.icon : null}
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DepartmentSubtabs({
  tabs,
  emptyLabel,
}: {
  tabs: NestedTab[];
  emptyLabel: string;
}) {
  const defaultTab = tabs[0]?.value;
  const [activeSubTab, setActiveSubTab] = useState(defaultTab ?? "");

  useEffect(() => {
    setActiveSubTab(defaultTab ?? "");
  }, [defaultTab]);

  if (!defaultTab) {
    return <EmptySection label={emptyLabel} />;
  }

  const activeTab = tabs.find((tab) => tab.value === activeSubTab) ?? tabs[0];

  return (
    <div className="space-y-6">
      <SegmentedTabs tabs={tabs} value={activeTab.value} onChange={setActiveSubTab} />
      <div className="space-y-4">
        <SectionHeader title={activeTab.title} description={activeTab.description} />
        {activeTab.content}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { permissions } = useAuth();
  const router = useRouter();

  const operationalTabs: NestedTab[] = [
    {
      value: "units",
      label: "Unidades",
      title: "Unidades",
      description: "Gerencie as unidades operacionais e integrações principais.",
      content: <KioskManagement compact />,
    },
    {
      value: "pdv-sync",
      label: "Sincronizar",
      title: "Sincronização PDV",
      description: "Reprocesse dados históricos e configure a rotina operacional ligada ao PDV.",
      content: <PdvSyncManagement />,
    },
  ];

  const commercialTabs: NestedTab[] = [
    {
      value: "pricing",
      label: "Precificação",
      title: "Precificação",
      description: "Parâmetros e rotinas ligadas a preços, margens e simulações.",
      content: (
        <SettingsLaunchPanel
          title="Parâmetros de precificação"
          description="Abra o módulo comercial para ajustar taxas, margens, metas e categorias de simulação."
          href="/dashboard/pricing"
          actionLabel="Abrir módulo"
        />
      ),
    },
    {
      value: "competitors",
      label: "Concorrentes",
      title: "Concorrentes",
      description: "Gestão de grupos, unidades e produtos monitorados da concorrência.",
      content: (
        <SettingsLaunchPanel
          title="Estudo de preço e concorrentes"
          description="Abra o estudo de preço para gerenciar concorrentes e mercadorias relacionadas."
          href="/dashboard/pricing/price-comparison"
          actionLabel="Abrir estudo"
        />
      ),
    },
    {
      value: "goals",
      label: "Metas",
      title: "Metas",
      description: "Templates e acompanhamento das metas do departamento comercial.",
      content: (
        <SettingsLaunchPanel
          title="Templates e acompanhamento de metas"
          description="Abra o módulo de metas para gerenciar templates, períodos e acompanhamento comercial."
          href="/dashboard/goals/tracking"
          actionLabel="Abrir metas"
        />
      ),
    },
  ];

  const personalTabs: NestedTab[] = [
    {
      value: "users",
      label: "Usuários",
      title: "Usuários",
      description: "Gerencie usuários, perfis de acesso e dados complementares do DP.",
      content: <UserManagement />,
    },
    {
      value: "shifts",
      label: "Turnos",
      title: "Turnos",
      description: "Configure os turnos reutilizáveis do departamento pessoal.",
      content: <DPSettingsShifts />,
    },
    {
      value: "calendars",
      label: "Calendário",
      title: "Calendários de Trabalho",
      description: "Configure calendários de feriados usados nas escalas.",
      content: <CalendarManagement />,
    },
  ].filter((tab) => {
    if (tab.value === "users") {
      return !!(permissions.settings.manageUsers || permissions.settings.manageProfiles);
    }
    if (tab.value === "shifts") {
      return !!permissions.dp?.settings?.manageShifts;
    }
    if (tab.value === "calendars") {
      return !!permissions.dp?.settings?.manageCalendars;
    }
    return false;
  });

  const financialTabs: NestedTab[] = [
    {
      value: "accounting",
      label: "Contabilidade",
      title: "Cadastros Contábeis",
      description: "Plano de contas e centros de resultado do módulo financeiro.",
      content: (
        <SettingsLaunchPanel
          title="Abrir cadastros contábeis"
          description="Abra a tela financeira já posicionada na aba de contabilidade."
          href="/dashboard/financial/settings?tab=accounting"
          actionLabel="Abrir contabilidade"
        />
      ),
    },
    {
      value: "accounts",
      label: "Contas",
      title: "Contas Bancárias",
      description: "Gerencie bancos, contas e vínculos usados no financeiro.",
      content: (
        <SettingsLaunchPanel
          title="Abrir contas bancárias"
          description="Abra a tela financeira já posicionada na aba de contas."
          href="/dashboard/financial/settings?tab=accounts"
          actionLabel="Abrir contas"
        />
      ),
    },
    {
      value: "import",
      label: "Importação",
      title: "Aliases de Importação",
      description: "Mapeie aliases e regras usadas na importação financeira.",
      content: (
        <SettingsLaunchPanel
          title="Abrir aliases de importação"
          description="Abra a tela financeira já posicionada na aba de importação."
          href="/dashboard/financial/settings?tab=import"
          actionLabel="Abrir importação"
        />
      ),
    },
  ].filter(() => !!permissions.financial?.settings?.view);

  const departmentTabs: DepartmentTab[] = [
    {
      value: "operacional",
      label: "Operacional",
      icon: <Storefront size={14} weight="light" />,
      tabs: operationalTabs,
      emptyLabel: "Operacional",
    },
    {
      value: "comercial",
      label: "Comercial",
      icon: <ChartLineUp size={14} weight="light" />,
      tabs: commercialTabs,
      emptyLabel: "Comercial",
    },
    {
      value: "pessoal",
      label: "Pessoal",
      icon: <Users size={14} weight="light" />,
      tabs: personalTabs,
      emptyLabel: "Pessoal",
    },
    {
      value: "financeiro",
      label: "Financeiro",
      icon: <Wallet size={14} weight="light" />,
      tabs: financialTabs,
      emptyLabel: "Financeiro",
    },
  ];

  const [activeDepartment, setActiveDepartment] = useState("operacional");

  useEffect(() => {
    if (!departmentTabs.some((tab) => tab.value === activeDepartment)) {
      setActiveDepartment(departmentTabs[0]?.value ?? "operacional");
    }
  }, [activeDepartment, departmentTabs]);

  const activeDepartmentTab =
    departmentTabs.find((tab) => tab.value === activeDepartment) ?? departmentTabs[0];

  return (
    <PermissionGuard allowed={permissions.settings.view}>
      <div className="w-full space-y-6">
        <div className="flex items-center gap-4 mb-2">
          <Button
            onClick={() => router.back()}
            variant="ghost"
            className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-6 h-6" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Configurações</h1>
            <p className="text-sm text-muted-foreground">Gerencie as configurações de cada departamento.</p>
          </div>
        </div>

        <div className="space-y-6">
          <SegmentedTabs
            tabs={departmentTabs}
            value={activeDepartmentTab?.value ?? "operacional"}
            onChange={setActiveDepartment}
            withIcons
          />

          {activeDepartmentTab ? (
            <DepartmentSubtabs
              tabs={activeDepartmentTab.tabs}
              emptyLabel={activeDepartmentTab.emptyLabel}
            />
          ) : null}
        </div>
      </div>
    </PermissionGuard>
  );
}
