"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useHrBootstrap } from "@/hooks/use-hr-bootstrap";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Box, ChevronRight, Group, Loader2, Menu, Package, Settings2, SlidersHorizontal, Users2, UsersRound } from "lucide-react";
import { PermissionGuard } from "@/components/permission-guard";
import { DPRuntimeGuard } from "@/components/dp-runtime-guard";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { ChartLineUp, Storefront, Users, Wallet } from "@phosphor-icons/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useEntities } from "@/hooks/use-entities";
import { useProducts } from "@/hooks/use-products";

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
const ExpenseDescriptionsManagement = dynamic(
  () => import("@/features/financial/components/settings/expense-descriptions-management"),
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
const DPSettingsUnits = dynamic(
  () => import("@/components/dp/dp-settings-units").then((m) => m.DPSettingsUnits),
  { ssr: false }
);
const PdvSyncManagement = dynamic(
  () => import("@/components/pdv-sync-management").then((m) => m.PdvSyncManagement),
  { ssr: false }
);
const CatalogoQRPanel = dynamic(
  () => import("@/components/catalogo/catalogo-qr-panel").then((m) => m.CatalogoQRPanel),
  { ssr: false }
);
const PurchasingAccountingSettings = dynamic(
  () => import("@/components/purchasing/purchasing-accounting-settings").then((m) => m.PurchasingAccountingSettings),
  { ssr: false }
);
const InternalPrivacySettings = dynamic(
  () => import("@/components/privacy/internal-privacy-settings").then((m) => m.InternalPrivacySettings),
  { ssr: false }
);
const InternalAuditPanel = dynamic(
  () => import("@/components/privacy/internal-audit-panel").then((m) => m.InternalAuditPanel),
  { ssr: false }
);
const FieldConfigPage = dynamic(
  () => import("@/features/rh/components/FieldConfigPage").then((m) => m.FieldConfigPage),
  { ssr: false }
);
const AssetBarcodeLabelsPanel = dynamic(
  () => import("@/components/assets/asset-barcode-labels-panel").then((m) => m.AssetBarcodeLabelsPanel),
  { ssr: false }
);
const RecruitmentFormsView = dynamic(
  () => import("@/components/hr/recruitment/recruitment-shell").then((m) => m.RecruitmentFormsView),
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

function RecruitmentFormsSettingsPanel() {
  const { firebaseUser, permissions } = useAuth();
  const { roles, functions, loading, error, refresh } = useHrBootstrap();
  const canManage = !!(permissions.settings.manageUsers || permissions.dp?.collaborators?.edit);

  const getToken = useCallback(async () => {
    const token = await firebaseUser?.getIdToken();
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    return token;
  }, [firebaseUser]);

  if (!firebaseUser || loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <RecruitmentFormsView
        getToken={getToken}
        canManage={canManage}
        roles={roles}
        functions={functions}
        onModelsUpdated={refresh}
      />
    </div>
  );
}

function OperationalCadastrosPanel() {
  const { baseProducts } = useBaseProducts();
  const { products } = useProducts();
  const { entities } = useEntities();

  const catalogTabs = [
    {
      value: "base-products",
      label: "Insumo base",
      count: baseProducts.filter((product) => !product.isArchived).length,
      icon: Box,
    },
    {
      value: "items",
      label: "Insumo derivado",
      count: products.filter((product) => !product.isArchived).length,
      icon: Package,
    },
    {
      value: "entities",
      label: "Pessoas e empresas",
      count: entities.length,
      icon: UsersRound,
    },
  ];

  return (
    <Tabs defaultValue="items" className="w-full space-y-8">
      <TabsList className="grid h-auto w-full grid-cols-3 rounded-none border-0 border-b border-[#ded3c5] bg-transparent p-0 shadow-none">
        {catalogTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="group relative min-h-20 rounded-none border-0 bg-transparent px-3 py-4 text-[#746961] shadow-none transition-colors data-[state=active]:bg-transparent data-[state=active]:text-[#211814] data-[state=active]:shadow-none"
            >
              <span className="flex items-center justify-center gap-3">
                <Icon className="h-5 w-5 text-[#a79c93] group-data-[state=active]:text-[#a6325b]" />
                <span className="text-sm font-bold sm:text-base">{tab.label}</span>
                <span className="rounded-full bg-[#e6e0d8] px-2.5 py-1 text-xs font-bold text-[#746961] group-data-[state=active]:bg-[#a6325b] group-data-[state=active]:text-white">
                  {tab.count}
                </span>
              </span>
              <span className="absolute inset-x-4 -bottom-px hidden h-1 rounded-full bg-[#a6325b] group-data-[state=active]:block" />
            </TabsTrigger>
          );
        })}
      </TabsList>
      <TabsContent value="base-products">
        <BaseProductManagement />
      </TabsContent>
      <TabsContent value="items">
        <ItemManagement />
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

function OperationalFormsPanel() {
  return (
    <SettingsLaunchPanel
      title="Módulo de formulários"
      description="A configuração operacional foi migrada para o domínio de formulários. Use esse acesso para projetos, templates e execuções."
      href="/dashboard/forms"
      actionLabel="Abrir formulários"
    />
  );
}

function OperationalUnitsPanel() {
  return (
    <DPRuntimeGuard area="Unidades">
      <DPSettingsUnits />
    </DPRuntimeGuard>
  );
}

type NestedTab = {
  value: string;
  label: string;
  /** Omitido quando o próprio conteúdo já exibe o título da seção. */
  title?: string;
  description?: string;
  content: React.ReactNode;
  children?: NestedTab[];
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
      <div className="inline-flex min-w-max rounded-2xl border border-border bg-background p-1 shadow-sm">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-xl transition-all",
              withIcons ? "px-4 py-2.5 text-sm font-semibold" : "px-4 py-2 text-sm font-medium",
              value === tab.value
                ? "bg-[#FBEAF0] text-[#993556] shadow-sm"
                : "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
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
  const resolveTab = useCallback(
    (value?: string | null) => {
      if (!tabs.length) return null;
      if (value) {
        for (const tab of tabs) {
          if (tab.value === value) {
            return { group: tab, leaf: tab.children?.[0] ?? tab };
          }
          const child = tab.children?.find((item) => item.value === value);
          if (child) {
            return { group: tab, leaf: child };
          }
        }
      }
      const group = tabs[0];
      return { group, leaf: group.children?.[0] ?? group };
    },
    [tabs]
  );

  const defaultMatch = resolveTab(requestedValue);
  const [activeSubTab, setActiveSubTab] = useState(defaultMatch?.group.value ?? "");
  const [activeLeafTab, setActiveLeafTab] = useState(defaultMatch?.leaf.value ?? "");

  useEffect(() => {
    const match = resolveTab(requestedValue);
    if (match) {
      setActiveSubTab(match.group.value);
      setActiveLeafTab(match.leaf.value);
      return;
    }
    setActiveSubTab("");
    setActiveLeafTab("");
  }, [requestedValue, resolveTab]);

  if (!tabs.length) {
    return <EmptySection label={emptyLabel} />;
  }

  const activeGroup = tabs.find((tab) => tab.value === activeSubTab) ?? tabs[0];
  const childTabs = activeGroup.children ?? [];
  const activeTab = childTabs.find((tab) => tab.value === activeLeafTab) ?? childTabs[0] ?? activeGroup;

  const handleGroupChange = (value: string) => {
    const nextGroup = tabs.find((tab) => tab.value === value) ?? tabs[0];
    setActiveSubTab(nextGroup.value);
    setActiveLeafTab((nextGroup.children?.[0] ?? nextGroup).value);
  };

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <SegmentedTabs tabs={tabs} value={activeGroup.value} onChange={handleGroupChange} />
      {childTabs.length > 1 ? (
        <SegmentedTabs tabs={childTabs} value={activeTab.value} onChange={setActiveLeafTab} />
      ) : null}
      <div className="min-w-0 space-y-4">
        {activeTab.title ? <SectionHeader title={activeTab.title} description={activeTab.description} /> : null}
        <div className="min-w-0 overflow-x-hidden">{activeTab.content}</div>
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
      value: "forms",
      label: "Formulários",
      title: "Formulários operacionais",
      description: "Centralize o acesso às configurações operacionais dos formulários e ao catálogo de templates.",
      content: <OperationalFormsPanel />,
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
      content: <OperationalUnitsPanel />,
    },
    {
      value: "pdv-sync",
      label: "Sincronizar",
      title: "Sincronização do PDV",
      description: "Reprocesse dados históricos e configure a rotina operacional ligada ao PDV.",
      content: <PdvSyncManagement />,
    },
    {
      value: "catalogo-qr",
      label: "QR Codes",
      title: "QR codes operacionais",
      description: "Centralize QR codes, etiquetas e códigos usados em catálogo, patrimônio, estoque e leitura por scanner.",
      content: <CatalogoQRPanel />,
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

  const personalLeafTabs: NestedTab[] = [
    {
      value: "roles",
      label: "Cargos e funções",
      title: "Cargos e funções",
      description: "Catálogo de cargos, funções e vínculo com perfis do departamento pessoal.",
      content: <DPSettingsRoles />,
    },
    {
      value: "organogram",
      label: "Organograma",
      title: "Organograma",
      description: "Visualização da estrutura organizacional do departamento pessoal.",
      content: <DPOrgChart />,
    },
    {
      value: "login-access",
      label: "Acesso por escala",
      title: "Acesso por escala",
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
      value: "privacy",
      label: "Privacidade",
      title: "Privacidade interna",
      description: "Aviso interno, inventário LGPD, fornecedores, retenção e pendências de governança.",
      content: <InternalPrivacySettings />,
    },
    {
      value: "profile-fields",
      label: "Campos do perfil",
      title: "Campos do perfil",
      description: "Crie, nomeie e organize as seções e campos exibidos no perfil dos colaboradores.",
      content: <FieldConfigPage />,
    },
    {
      value: "recruitment",
      label: "Recrutamento",
      title: "Recrutamento",
      description: "Gerencie formulários públicos, modelos de questionário e modelos de integração por cargo e função.",
      content: <RecruitmentFormsSettingsPanel />,
    },
    {
      value: "audit",
      label: "Auditoria",
      title: "Auditoria",
      description: "Eventos críticos de acesso, usuários, senha e visualização de dados internos.",
      content: <InternalAuditPanel />,
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
      title: "Calendários de trabalho",
      description: "Configure calendários de feriados usados nas escalas.",
      content: <DPSettingsCalendars />,
    },
  ].filter((tab) => {
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
    if (tab.value === "privacy") {
      return !!(
        permissions.settings.view ||
        permissions.settings.manageUsers ||
        permissions.settings.manageProfiles ||
        permissions.dp?.collaborators?.edit ||
        permissions.dp?.collaborators?.terminate
      );
    }
    if (tab.value === "profile-fields") {
      return !!(
        permissions.settings.manageUsers ||
        permissions.dp?.collaborators?.edit
      );
    }
    if (tab.value === "recruitment") {
      return !!(
        permissions.settings.manageUsers ||
        permissions.dp?.collaborators?.edit ||
        permissions.dp?.view
      );
    }
    if (tab.value === "audit") {
      return !!(
        permissions.settings.manageUsers ||
        permissions.settings.manageProfiles
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

  const pickPersonalTabs = (values: string[]) => personalLeafTabs.filter((tab) => values.includes(tab.value));

  const personalTabs: NestedTab[] = [
    {
      value: "team-structure",
      label: "Equipe e organograma",
      title: "Equipe e organograma",
      description: "Gerencie cargos, funções e a estrutura organizacional.",
      content: null,
      children: pickPersonalTabs(["roles", "organogram"]),
    },
    {
      value: "collaborator-profile",
      label: "Perfil do colaborador",
      title: "Perfil do colaborador",
      description: "Configure os campos e a composição do perfil dos colaboradores.",
      content: null,
      children: pickPersonalTabs(["profile-fields"]),
    },
    {
      value: "journey",
      label: "Jornada",
      title: "Jornada",
      description: "Configure turnos, calendários e regras de acesso por escala.",
      content: null,
      children: pickPersonalTabs(["shifts", "calendars", "login-access"]),
    },
    {
      value: "recruitment",
      label: "Recrutamento",
      title: "Recrutamento",
      description: "Gerencie formulários públicos, modelos de questionário e modelos de integração por cargo e função.",
      content: null,
      children: pickPersonalTabs(["recruitment"]),
    },
    {
      value: "governance",
      label: "Governança",
      title: "Governança",
      description: "Centralize privacidade, auditoria e controles internos do departamento pessoal.",
      content: null,
      children: pickPersonalTabs(["privacy", "audit"]),
    },
  ].filter((tab) => (tab.children?.length ?? 0) > 0);

  const financialTabs: NestedTab[] = [
    {
      value: "accounting",
      label: "Contabilidade",
      title: "Cadastros contábeis",
      description: "Plano de contas e centros de resultado do módulo financeiro.",
      content: (
        <div className="space-y-6">
          <AccountPlansManagement canManage={permissions.financial?.settings?.manageAccountPlans} />
          <ResultCentersManagement canManage={permissions.financial?.settings?.manageResultCenters} />
          {permissions.financial?.settings?.manageExpenseDescriptions ? (
            <ExpenseDescriptionsManagement canManage={permissions.financial?.settings?.manageExpenseDescriptions} />
          ) : null}
        </div>
      ),
    },
    {
      value: "accounts",
      label: "Contas",
      title: "Contas bancárias",
      description: "Gerencie bancos, contas e vínculos usados no financeiro.",
      content: (
        <BankAccountsManagement canManage={permissions.financial?.settings?.manageBankAccounts} />
      ),
    },
    {
      value: "import",
      label: "Importação",
      title: "Aliases de importação",
      description: "Mapeie aliases e regras usadas na importação financeira.",
      content: (
        <ImportAliasesManagement canManage={permissions.financial?.settings?.manageImportAliases} />
      ),
    },
    {
      value: "asset-labels",
      label: "Patrimônio",
      title: "Etiquetas patrimoniais",
      description: "Gere e exporte placas patrimoniais com logo, numeração fixa e código de barras.",
      content: <AssetBarcodeLabelsPanel />,
    },
  ].filter((tab) => {
    if (tab.value === "asset-labels") return !!permissions.assets?.printLabels;
    return !!permissions.financial?.settings?.view;
  });

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

  useEffect(() => {
    if (requestedDepartment === "pessoal" && requestedTab === "users") {
      router.replace("/dashboard/dp/collaborators");
    }
  }, [requestedDepartment, requestedTab, router]);

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
      <div className="w-full min-w-0 max-w-full space-y-6 overflow-x-hidden">
        <div className="flex items-center gap-2 sm:gap-4 mb-2">
          <Button
            onClick={() => router.back()}
            variant="ghost"
            className="p-2 rounded-full h-auto w-auto shrink-0 text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold">Configurações</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Gerencie as configurações de cada departamento.</p>
          </div>
        </div>

        <div className="min-w-0 space-y-6">
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
