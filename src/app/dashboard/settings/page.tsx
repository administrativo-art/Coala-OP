"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronRight, Group, Menu, Settings2, SlidersHorizontal, Users2 } from "lucide-react";
import { PermissionGuard } from "@/components/permission-guard";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { ChartLineUp, Storefront, Users, Wallet } from "@phosphor-icons/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const UserManagement = dynamic(
  () => import("@/components/user-management").then((m) => m.UserManagement),
  { ssr: false }
);
const DPChecklistsV2Page = dynamic(
  () => import("@/components/dp/dp-checklists-v2-page").then((m) => m.DPChecklistsV2Page),
  { ssr: false }
);
const ItemManagement = dynamic(
  () => import("@/components/item-management").then((m) => m.ItemManagement),
  { ssr: false }
);
const BaseProductManagement = dynamic(
  () => import("@/components/base-product-management").then((m) => m.BaseProductManagement),
  { ssr: false }
);
const EntityManagement = dynamic(
  () => import("@/components/entity-management").then((m) => m.EntityManagement),
  { ssr: false }
);
const DPSettingsShifts = dynamic(
  () => import("@/components/dp/dp-settings-shifts").then((m) => m.DPSettingsShifts),
  { ssr: false }
);
const DPSettingsRoles = dynamic(
  () => import("@/components/dp/dp-settings-roles").then((m) => m.DPSettingsRoles),
  { ssr: false }
);
const DPOrgChart = dynamic(
  () => import("@/components/dp/dp-org-chart").then((m) => m.DPOrgChart),
  { ssr: false }
);
const DPLoginAccessDiagnostic = dynamic(
  () => import("@/components/dp/dp-login-access-diagnostic").then((m) => m.DPLoginAccessDiagnostic),
  { ssr: false }
);
const DPLoginAccessAudit = dynamic(
  () => import("@/components/dp/dp-login-access-audit").then((m) => m.DPLoginAccessAudit),
  { ssr: false }
);
const DPSettingsCalendars = dynamic(
  () => import("@/components/dp/dp-settings-calendars").then((m) => m.DPSettingsCalendars),
  { ssr: false }
);
const AccountPlansManagement = dynamic(
  () => import("@/features/financial/components/settings/account-plans-management"),
  { ssr: false }
);
const ResultCentersManagement = dynamic(
  () => import("@/features/financial/components/settings/result-centers-management"),
  { ssr: false }
);
const BankAccountsManagement = dynamic(
  () => import("@/features/financial/components/settings/bank-accounts-management"),
  { ssr: false }
);
const ImportAliasesManagement = dynamic(
  () => import("@/features/financial/components/settings/import-aliases-management"),
  { ssr: false }
);
const PricingSimulator = dynamic(
  () => import("@/components/pricing-simulator").then((m) => m.PricingSimulator),
  { ssr: false }
);
const PriceComparisonTable = dynamic(
  () => import("@/components/price-comparison-table").then((m) => m.PriceComparisonTable),
  { ssr: false }
);
const CompetitorManagementModal = dynamic(
  () => import("@/components/competitor-management-modal").then((m) => m.CompetitorManagementModal),
  { ssr: false }
);
const CompetitorProductManagementModal = dynamic(
  () => import("@/components/competitor-product-management-modal").then((m) => m.CompetitorProductManagementModal),
  { ssr: false }
);
const CompetitorSelectionModal = dynamic(
  () => import("@/components/competitor-selection-modal").then((m) => m.CompetitorSelectionModal),
  { ssr: false }
);
const GoalsTrackingDashboard = dynamic(
  () => import("@/components/goals-tracking-dashboard").then((m) => m.GoalsTrackingDashboard),
  { ssr: false }
);
const GoalsRegistrationDashboard = dynamic(
  () => import("@/components/goals-registration-dashboard").then((m) => m.GoalsRegistrationDashboard),
  { ssr: false }
);
const GoalsProvider = dynamic(
  () => import("@/components/goals-provider").then((m) => m.GoalsProvider),
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
const PurchasingAccountingSettings = dynamic(
  () => import("@/components/purchasing/purchasing-accounting-settings").then((m) => m.PurchasingAccountingSettings),
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

function OperationalCadastrosPanel() {
  return (
    <Tabs defaultValue="items" className="w-full space-y-4">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="items">Insumos</TabsTrigger>
        <TabsTrigger value="base-products">Produtos Base</TabsTrigger>
        <TabsTrigger value="entities">Pessoas & Empresas</TabsTrigger>
      </TabsList>
      <TabsContent value="items">
        <ItemManagement />
      </TabsContent>
      <TabsContent value="base-products">
        <BaseProductManagement />
      </TabsContent>
      <TabsContent value="entities">
        <EntityManagement />
      </TabsContent>
    </Tabs>
  );
}

function CommercialCompetitorsPanel() {
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
  const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<string[]>([]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon">
              <Menu className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setIsSelectionModalOpen(true)}>
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Selecionar concorrentes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsProductModalOpen(true)}>
              <Group className="mr-2 h-4 w-4" />
              Mercadorias dos concorrentes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsCompetitorModalOpen(true)}>
              <Users2 className="mr-2 h-4 w-4" />
              Gerenciar concorrentes
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <PriceComparisonTable selectedCompetitorIds={selectedCompetitorIds} />

      <CompetitorManagementModal
        isOpen={isCompetitorModalOpen}
        onClose={() => setIsCompetitorModalOpen(false)}
      />
      <CompetitorProductManagementModal
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
      />
      <CompetitorSelectionModal
        isOpen={isSelectionModalOpen}
        onClose={() => setIsSelectionModalOpen(false)}
        selectedCompetitorIds={selectedCompetitorIds}
        setSelectedCompetitorIds={setSelectedCompetitorIds}
      />
    </div>
  );
}

function CommercialGoalsPanel({ canManage }: { canManage: boolean }) {
  return (
    <GoalsProvider>
      {canManage ? <GoalsRegistrationDashboard /> : <GoalsTrackingDashboard />}
    </GoalsProvider>
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

function OperationalChecklistsPanel() {
  const { firebaseUser } = useAuth();
  const [mode, setMode] = useState<"loading" | "forms" | "legacy">("loading");

  useEffect(() => {
    let cancelled = false;

    async function resolveMode() {
      if (!firebaseUser) {
        if (!cancelled) setMode("legacy");
        return;
      }

      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch("/api/forms/navigation", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });

        if (!cancelled) {
          setMode(response.ok ? "forms" : "legacy");
        }
      } catch {
        if (!cancelled) {
          setMode("legacy");
        }
      }
    }

    resolveMode();

    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  if (mode === "loading") {
    return <EmptySection label="Checklists" />;
  }

  if (mode === "forms") {
    return (
      <SettingsLaunchPanel
        title="Novo módulo de formulários"
        description="A configuração operacional já foi migrada para o novo domínio de formulários. Use esse acesso para projetos, templates e execuções."
        href="/dashboard/forms"
        actionLabel="Abrir formulários"
      />
    );
  }

  return <DPChecklistsV2Page />;
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
  requestedValue,
}: {
  tabs: NestedTab[];
  emptyLabel: string;
  requestedValue?: string | null;
}) {
  const defaultTab = tabs[0]?.value;
  const [activeSubTab, setActiveSubTab] = useState(defaultTab ?? "");

  useEffect(() => {
    if (requestedValue && tabs.some((tab) => tab.value === requestedValue)) {
      setActiveSubTab(requestedValue);
      return;
    }
    setActiveSubTab(defaultTab ?? "");
  }, [defaultTab, requestedValue, tabs]);

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
  const searchParams = useSearchParams();

  const operationalTabs: NestedTab[] = [
    {
      value: "checklists",
      label: "Checklists",
      title: "Checklists operacionais",
      description: "Centralize o acesso às configurações operacionais dos formulários e ao catálogo de templates.",
      content: <OperationalChecklistsPanel />,
    },
    {
      value: "cadastros",
      label: "Cadastros",
      title: "Cadastros operacionais",
      description: "Gerencie insumos, produtos base e entidades do sistema.",
      content: <OperationalCadastrosPanel />,
    },
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
  ].filter((tab) => {
    if (tab.value === "cadastros") return !!permissions.registration.view;
    return true;
  });

  const commercialTabs: NestedTab[] = [
    {
      value: "purchasing",
      label: "Compras",
      title: "Compras",
      description: "Classificações padrão usadas pelo módulo de compras para mercadoria e frete.",
      content: <PurchasingAccountingSettings />,
    },
    {
      value: "pricing",
      label: "Precificação",
      title: "Precificação",
      description: "Parâmetros e rotinas ligadas a preços, margens e simulações.",
      content: <PricingSimulator />,
    },
    {
      value: "competitors",
      label: "Concorrentes",
      title: "Concorrentes",
      description: "Gestão de grupos, unidades e produtos monitorados da concorrência.",
      content: <CommercialCompetitorsPanel />,
    },
    {
      value: "goals",
      label: "Metas",
      title: "Metas",
      description: "Templates e acompanhamento das metas do departamento comercial.",
      content: <CommercialGoalsPanel canManage={!!permissions.goals?.manage} />,
    },
  ].filter((tab) => {
    if (tab.value === "purchasing") {
      return !!permissions.purchasing?.view;
    }
    if (tab.value === "pricing") {
      return !!(permissions.pricing.view || permissions.pricing.manageParameters || permissions.dashboard.pricing);
    }
    if (tab.value === "competitors") {
      return !!permissions.pricing.view;
    }
    if (tab.value === "goals") {
      return !!(permissions.goals?.view || permissions.goals?.manage);
    }
    return false;
  });

  const personalTabs: NestedTab[] = [
    {
      value: "users",
      label: "Usuários",
      title: "Usuários",
      description: "Gerencie usuários, perfis de acesso e dados complementares do DP.",
      content: <UserManagement />,
    },
    {
      value: "roles",
      label: "Cargos & Funções",
      title: "Cargos & Funções",
      description: "Catálogo de cargos, funções e vínculo com perfis do departamento pessoal.",
      content: <DPSettingsRoles />,
    },
    {
      value: "organogram",
      label: "Organograma",
      title: "Organograma",
      description: "Visualização da estrutura organizacional do departamento pessoal.",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Esta visualização usa cargos e vínculos dos colaboradores sem substituir o modelo atual de permissões.
          </p>
          <DPOrgChart />
        </div>
      ),
    },
    {
      value: "login-access",
      label: "Acesso por Escala",
      title: "Acesso por Escala",
      description: "Diagnóstico e auditoria da política de acesso vinculada à escala.",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Esta área reúne o diagnóstico da regra atual e a auditoria das justificativas já registradas.
          </p>
          <DPLoginAccessDiagnostic />
          <DPLoginAccessAudit />
        </div>
      ),
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
      content: <DPSettingsCalendars />,
    },
  ].filter((tab) => {
    if (tab.value === "users") {
      return !!(permissions.settings.manageUsers || permissions.settings.manageProfiles);
    }
    if (tab.value === "roles") {
      return !!(permissions.settings.manageUsers || permissions.dp?.collaborators?.edit);
    }
    if (tab.value === "organogram") {
      return !!(
        permissions.settings.manageUsers ||
        permissions.dp?.collaborators?.edit ||
        permissions.dp?.collaborators?.terminate
      );
    }
    if (tab.value === "login-access") {
      return !!(
        permissions.settings.manageUsers ||
        permissions.dp?.collaborators?.edit ||
        permissions.dp?.collaborators?.terminate
      );
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
        <div className="space-y-6">
          <AccountPlansManagement canManage={permissions.financial?.settings?.manageAccountPlans} />
          <ResultCentersManagement canManage={permissions.financial?.settings?.manageResultCenters} />
        </div>
      ),
    },
    {
      value: "accounts",
      label: "Contas",
      title: "Contas Bancárias",
      description: "Gerencie bancos, contas e vínculos usados no financeiro.",
      content: (
        <BankAccountsManagement canManage={permissions.financial?.settings?.manageBankAccounts} />
      ),
    },
    {
      value: "import",
      label: "Importação",
      title: "Aliases de Importação",
      description: "Mapeie aliases e regras usadas na importação financeira.",
      content: (
        <ImportAliasesManagement canManage={permissions.financial?.settings?.manageImportAliases} />
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

  const requestedDepartment = searchParams.get("department");
  const requestedTab = searchParams.get("tab");

  const [activeDepartment, setActiveDepartment] = useState(
    requestedDepartment && departmentTabs.some((tab) => tab.value === requestedDepartment)
      ? requestedDepartment
      : "operacional"
  );

  useEffect(() => {
    if (!departmentTabs.some((tab) => tab.value === activeDepartment)) {
      setActiveDepartment(departmentTabs[0]?.value ?? "operacional");
    }
  }, [activeDepartment, departmentTabs]);

  useEffect(() => {
    if (
      requestedDepartment &&
      departmentTabs.some((tab) => tab.value === requestedDepartment)
    ) {
      setActiveDepartment(requestedDepartment);
    }
  }, [requestedDepartment, departmentTabs]);

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
              requestedValue={requestedTab}
            />
          ) : null}
        </div>
      </div>
    </PermissionGuard>
  );
}
