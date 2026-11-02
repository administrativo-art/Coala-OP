"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyResults, ListHead, ListShell, ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { ControlPanel, ControlSearch } from "@/components/patterns/control-panel";
import { LiftRow } from "@/components/patterns/lift-row";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { ProfileLinksPopover, type ProfileLinkGroup, type ProfileLinkItem } from "@/components/access-profile-links";
import { ProfileManagementModal, logProfileAudit } from "@/components/profile-management-modal";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { BriefcaseBusiness, Check, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useProfiles } from "@/hooks/use-profiles";
import { canReadUsersDirectory } from "@/features/auth/users-directory-access";
import { fetchHrJobCatalog } from "@/features/hr/lib/client";
import type { JobFunction, JobRole, Profile } from "@/types";

type AccessProfilesSettingsProps = {
  canEdit: boolean;
};

const ROW_TEMPLATE = "minmax(220px,1.6fr) minmax(180px,1fr) minmax(140px,.7fr) minmax(110px,.6fr)";

const AREA_LABELS: Record<string, string> = {
  dashboard: "Painel", registration: "Cadastros", stock: "Estoque", assets: "Patrimônio",
  pricing: "Precificação", commercial: "Comercial", settings: "Configurações", tasks: "Tarefas",
  goals: "Metas", help: "Ajuda", reposition: "Reposição", itemRequests: "Solicitações",
  signage: "Sinalização", dp: "Pessoal", financial: "Financeiro", hr: "RH", app: "Aplicativo",
  purchasing: "Compras", recruitment: "Recrutamento", forms: "Formulários",
};

const PERMISSION_LABELS: Record<string, string> = {
  view: "Visualizar",
  add: "Adicionar",
  edit: "Editar",
  delete: "Excluir",
  create: "Criar",
  manage: "Gerenciar",
  approve: "Aprovar",
  perform: "Realizar",
  start: "Iniciar",
  receive: "Receber",
  finalize: "Finalizar",
  cancel: "Cancelar",
  export: "Exportar",
  import: "Importar",
  audit: "Auditoria",
  operational: "Painel de operações",
  pricing: "Precificação",
  settings: "Configurações",
  technicalSheets: "Fichas técnicas",
  collaborator: "Painel do colaborador",
  inventoryControl: "Controle de estoque",
  uniforms: "Uniformes",
  stockCount: "Contagem de estoque",
  requestItem: "Solicitar item",
  analysis: "Análises",
  purchasing: "Compras",
  returns: "Devoluções",
  conversions: "Conversões",
  predefinedLists: "Listas predefinidas",
  addLot: "Adicionar lote",
  editLot: "Editar lote",
  writeDown: "Dar baixa",
  transfer: "Transferir",
  viewHistory: "Ver histórico",
  deliver: "Entregar",
  dispose: "Descartar",
  manageEvaluation: "Gerenciar avaliação",
  restock: "Reposição sugerida",
  consumption: "Consumo",
  projection: "Projeção",
  valuation: "Valoração",
  suggest: "Sugerir",
  deleteHistory: "Excluir histórico",
  updateStatus: "Atualizar situação",
  printLabels: "Imprimir etiquetas",
  retire: "Baixar patrimônio",
  simulate: "Simular",
  manageParameters: "Gerenciar parâmetros",
  manageUsers: "Gerenciar usuários",
  manageKiosks: "Gerenciar unidades",
  manageProfiles: "Gerenciar perfis",
  manageLabels: "Gerenciar etiquetas",
  managePublicBio: "Gerenciar perfil público",
  viewAiCosts: "Ver custos de IA",
  viewSystemNotices: "Ver avisos do sistema",
  prepareDispatch: "Preparar envio",
  schedules: "Escalas",
  publishBizneo: "Publicar no Bizneo",
  assignExternal: "Escalar pessoa de outra unidade",
  vacation: "Férias",
  requests: "Solicitações dos colaboradores",
  viewAll: "Ver todos",
  request: "Solicitar",
  review: "Analisar",
  responsibilities: "Cobertura de responsabilidades",
  receiveUnassignedAlerts: "Receber alertas sem responsável",
  manageSettings: "Gerenciar configurações",
  collaborators: "Colaboradores",
  ownProfileOnly: "Somente o próprio perfil",
  terminate: "Desligar colaborador",
  syncProfile: "Sincronizar perfil",
  manageUnits: "Gerenciar unidades",
  manageShifts: "Gerenciar turnos",
  manageCalendars: "Gerenciar calendários",
  manageTime: "Gerenciar jornadas e horas",
  readLocation: "Consultar coordenadas com auditoria",
  manageAbsences: "Gerenciar tipos de ausência",
  manageFieldVisibility: "Configurar visibilidade dos campos",
  dashboard: "Visão geral",
  cashFlow: "Fluxo de caixa",
  financialFlow: "Fluxo financeiro",
  expenses: "Despesas",
  inbox: "Caixa de entrada",
  audits: "Auditorias",
  reconciliation: "Conciliação",
  cardStatements: "Extratos de cartão",
  personnelCosts: "Custos de pessoal",
  beneficiaries: "Beneficiários",
  paymentRequests: "Solicitações de pagamento",
  cashClosures: "Fechamentos de caixa",
  cashDeposits: "Depósitos de caixa",
  interIntegration: "Integração bancária",
  pay: "Pagar",
  analyze: "Analisar",
  link: "Vincular",
  discard: "Descartar",
  ignore: "Ignorar",
  effectuate: "Efetivar",
  confirm: "Confirmar",
  correct: "Corrigir",
  classifyAdjustments: "Classificar ajustes",
  administer: "Administrar",
  close: "Fechar",
  reconcile: "Conciliar",
  viewMaskedPaymentData: "Ver dados de pagamento mascarados",
  managePaymentData: "Gerenciar dados de pagamento",
  authorize: "Autorizar",
  submit: "Enviar",
  refresh: "Atualizar",
  viewProof: "Ver comprovante",
  adjustExpected: "Ajustar valor esperado",
  reopen: "Reabrir",
  resync: "Sincronizar novamente",
  issue: "Emitir",
  adjust: "Ajustar",
  createQuotation: "Criar cotação",
  finalizeQuotation: "Finalizar cotação",
  createPurchase: "Criar compra",
  receivePurchase: "Receber compra",
  cancelPurchase: "Cancelar compra",
  revertPurchaseStage: "Voltar etapa da compra",
  manageFinancialLink: "Gerenciar vínculo financeiro",
  manageBaseItems: "Gerenciar itens-base",
  localPurchase: "Compra local",
  register: "Registrar",
  stockEntry: "Dar entrada em estoque",
  schedule: "Escala",
  viewAllUnits: "Ver todas as unidades",
  employees: "Colaboradores",
  org_chart: "Organograma",
  roles: "Cargos",
  functions: "Funções",
  navigation: "Navegação",
  formalization: "Formalização",
  propagate: "Propagar alterações",
  onboarding: "Admissão",
  aso: "ASO",
  accountant: "Contabilidade",
  documents: "Documentos",
  companyDocuments: "Documentos da empresa",
  templates: "Modelos",
  signatures: "Assinaturas",
  consents: "Consentimentos",
  sensitiveData: "Dados sensíveis",
  generate: "Gerar",
  publish: "Publicar",
  send: "Enviar",
  pipeline: "Etapas do processo",
  talent_pool: "Banco de talentos",
  hire: "Contratar",
  global: "Configurações gerais",
  analytics: "Análises",
  projects: "Projetos",
  view_all_projects: "Ver todos os projetos",
  create_projects: "Criar projetos",
  manage_templates: "Gerenciar modelos",
  view_analytics: "Ver análises",
  manage_taxonomy: "Gerenciar categorias",
  configure_templates: "Configurar modelos",
  view_occurrences: "Ver ocorrências",
  edit_occurrences_admin: "Editar ocorrências como administrador",
  export_occurrences: "Exportar ocorrências",
  reprocess_occurrences: "Reprocessar ocorrências",
  view_personal_targets: "Ver metas individuais",
  export_personal_targets: "Exportar metas individuais",
  view_collaborator_rankings: "Ver classificação dos colaboradores",
  manage_retention_policy: "Gerenciar política de retenção",
  manage_task_rules: "Gerenciar regras de tarefas",
  resolve_occurrences: "Resolver ocorrências",
  validate_occurrence_resolution: "Validar resolução de ocorrências",
};

function activePermissions(value: unknown, path = ""): string[] {
  if (value === true) return [path];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => activePermissions(child, path ? `${path}.${key}` : key));
}

export function readablePermission(path: string) {
  return path
    .split(".")
    .slice(1)
    .map((segment) => PERMISSION_LABELS[segment] ?? segment
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (letter) => letter.toLocaleUpperCase("pt-BR")))
    .join(" · ");
}

export function AccessProfilesSettings({ canEdit }: AccessProfilesSettingsProps) {
  const { profiles, loading, adminProfileId, deleteProfile } = useProfiles();
  const { firebaseUser, isDefaultAdmin, activeUsers, permissions } = useAuth();
  const [jobCatalog, setJobCatalog] = useState<{ roles: JobRole[]; functions: JobFunction[] } | null>(null);
  const [jobCatalogError, setJobCatalogError] = useState(false);
  const canSeeUsers = isDefaultAdmin || canReadUsersDirectory(permissions);

  useEffect(() => {
    if (!firebaseUser) return;
    let active = true;
    fetchHrJobCatalog(firebaseUser)
      .then((catalog) => { if (active) setJobCatalog(catalog); })
      .catch(() => { if (active) setJobCatalogError(true); });
    return () => { active = false; };
  }, [firebaseUser]);

  const linksByProfile = useMemo(() => {
    const links = new Map<string, { roles: ProfileLinkItem[]; functions: ProfileLinkItem[]; users: ProfileLinkItem[] }>();
    const entry = (profileId: string) => {
      const current = links.get(profileId) ?? { roles: [], functions: [], users: [] };
      links.set(profileId, current);
      return current;
    };
    const byName = (left: ProfileLinkItem, right: ProfileLinkItem) => left.name.localeCompare(right.name, "pt-BR");
    for (const role of jobCatalog?.roles ?? []) {
      if (role.isActive === false || !role.defaultProfileId) continue;
      entry(role.defaultProfileId).roles.push({ id: role.id, name: role.name, detail: role.departmentName });
    }
    for (const fn of jobCatalog?.functions ?? []) {
      if (fn.isActive === false || !fn.defaultProfileId) continue;
      entry(fn.defaultProfileId).functions.push({ id: fn.id, name: fn.name, detail: fn.departmentName });
    }
    if (canSeeUsers) {
      for (const user of activeUsers) {
        if (!user.profileId) continue;
        entry(user.profileId).users.push({ id: user.id, name: user.username, detail: user.jobRoleName || user.email, avatarUrl: user.avatarUrl, color: user.color });
      }
    }
    for (const value of links.values()) {
      value.roles.sort(byName);
      value.functions.sort(byName);
      value.users.sort(byName);
    }
    return links;
  }, [activeUsers, canSeeUsers, jobCatalog]);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerAction, setManagerAction] = useState<"create" | "edit" | "duplicate">("create");
  const [managerProfile, setManagerProfile] = useState<Profile | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState("");
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const selectedIsAdministrator = selectedProfile?.id === adminProfileId || selectedProfile?.isDefaultAdmin === true;
  const selectedPermissions = useMemo(() => activePermissions(selectedProfile?.permissions), [selectedProfile]);
  const permissionAreas = useMemo(() => {
    const areas = new Map<string, string[]>();
    for (const path of selectedPermissions) {
      const [area] = path.split(".");
      areas.set(area, [...(areas.get(area) ?? []), path]);
    }
    return [...areas.entries()];
  }, [selectedPermissions]);
  const copyBlocked = !isDefaultAdmin && (selectedProfile?.permissions.settings?.manageUsers === true || selectedProfile?.permissions.settings?.manageProfiles === true);

  const openManager = (action: "create" | "edit" | "duplicate", profile: Profile | null = null) => {
    if (!canEdit) return;
    setConfirmDelete(false);
    setSelectedProfileId(null);
    setManagerAction(action);
    setManagerProfile(profile);
    setManagerOpen(true);
  };

  const handleDelete = async () => {
    if (!canEdit || !selectedProfile || selectedIsAdministrator || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProfile(selectedProfile.id);
      await logProfileAudit(firebaseUser, "profile_deleted", selectedProfile, {
        name: selectedProfile.name,
        is_default_admin: false,
      });
      setConfirmDelete(false);
      setSelectedProfileId(null);
    } catch {
      setDeleteError("Não foi possível excluir o perfil. Tente novamente.");
    } finally {
      setDeleting(false);
    }
  };

  const sortedProfiles = useMemo(
    () => [...profiles].sort((left, right) => {
      if (left.id === adminProfileId) return -1;
      if (right.id === adminProfileId) return 1;
      return left.name.localeCompare(right.name, "pt-BR");
    }),
    [adminProfileId, profiles],
  );
  const visibleProfiles = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return term ? sortedProfiles.filter((profile) => profile.name.toLocaleLowerCase("pt-BR").includes(term)) : sortedProfiles;
  }, [sortedProfiles, search]);

  return (
    <div className="space-y-5">
      <ControlPanel className="flex flex-col gap-4 px-[26px] pb-5 pt-[22px]">
        <div>
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Perfis de permissão</p>
          <p className="mt-1 font-ds-mono text-[44px] font-bold leading-none tracking-tighter">{loading ? "—" : profiles.length}</p>
          <p className="mt-1 text-base font-extrabold">{profiles.length === 1 ? "Perfil disponível" : "Perfis disponíveis"}</p>
          <p className="mt-2 max-w-2xl text-[13px] text-ds-on-dark-2">
            Defina quais módulos, informações e ações ficam disponíveis para cada perfil de acesso do Coala One.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ControlSearch value={search} onChange={setSearch} placeholder="Buscar perfil" />
          <Button type="button" variant="primary-page" size="xl" disabled={!canEdit} onClick={() => openManager("create")}>
            Novo perfil
          </Button>
        </div>
      </ControlPanel>

      {!canEdit ? (
        <p role="note" className="rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg px-3.5 py-[11px] text-[12.5px] leading-normal text-ds-alert-ink">
          Você pode consultar os perfis, mas não tem permissão para gerenciá-los.
        </p>
      ) : null}

      <ListShell minWidth={760}>
        <ListHead template={ROW_TEMPLATE}>
          <span>Perfil</span>
          <span>Tipo</span>
          <span>Cargos e funções</span>
          <span>Usuários</span>
        </ListHead>
        {loading ? <ListSkeleton rows={3} /> : null}
        {visibleProfiles.map((profile) => {
          const isAdministrator = profile.id === adminProfileId || profile.isDefaultAdmin === true;
          const links = linksByProfile.get(profile.id);
          const jobGroups: ProfileLinkGroup[] = [
            { title: "Cargos", items: links?.roles ?? [] },
            { title: "Funções", items: links?.functions ?? [] },
          ];
          return (
            <LiftRow key={profile.id} selected={selectedProfileId === profile.id} onClick={() => {
              setSelectedProfileId(profile.id);
              setConfirmDelete(false);
              setDeleteError(null);
            }} className="grid items-center gap-3.5 px-5 py-[11px] last:border-b-0" style={{ gridTemplateColumns: ROW_TEMPLATE }}>
              <p className="truncate text-[13.5px] font-bold">{profile.name}</p>
              <div className="flex items-center gap-2">
                <StatusPill variant={isAdministrator ? "info" : "neutral"}>{isAdministrator ? "Administrador do sistema" : "Personalizado"}</StatusPill>
              </div>
              <div>
                {jobCatalogError ? (
                  <span className="text-[12.5px] text-ds-ink-muted">Sem acesso</span>
                ) : !jobCatalog ? (
                  <span className="text-[12.5px] text-ds-ink-muted">—</span>
                ) : (
                  <ProfileLinksPopover icon={<BriefcaseBusiness />} label="Cargos e funções" profileName={profile.name} groups={jobGroups} emptyText="Nenhum" />
                )}
              </div>
              <div>
                {canSeeUsers ? (
                  <ProfileLinksPopover icon={<Users />} label="Usuários" profileName={profile.name} groups={[{ title: "Usuários", items: links?.users ?? [] }]} emptyText="Nenhum" withAvatar />
                ) : (
                  <span className="text-[12.5px] text-ds-ink-muted">Sem acesso</span>
                )}
              </div>
            </LiftRow>
          );
        })}
        {!loading && profiles.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum perfil de permissão cadastrado.</p>
        ) : !loading && visibleProfiles.length === 0 ? (
          <EmptyResults title="Nenhum perfil encontrado com essa busca." onClear={() => setSearch("")} />
        ) : null}
      </ListShell>

      <p role="note" className="rounded-ds-btn border border-ds-info/20 bg-ds-info-bg px-4 py-3 text-xs font-semibold leading-relaxed text-ds-info">
        O perfil é aplicado ao colaborador conforme o cargo e a função configurados em “Cargos e funções”.
      </p>

      <SidePanel
        open={!!selectedProfile}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedProfileId(null);
            setConfirmDelete(false);
            setDeleteError(null);
          }
        }}
        kicker="Perfil de acesso"
        title={selectedProfile?.name ?? "Perfil"}
        subtitle={selectedIsAdministrator ? "Administrador do sistema" : "Perfil personalizado"}
      >
        {selectedProfile ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <PanelField label="Tipo">{selectedIsAdministrator ? "Administrador do sistema" : "Personalizado"}</PanelField>
              <PanelField label="Permissões ativas">{selectedPermissions.length}</PanelField>
            </div>
            <PanelSection title="Permissões ativas" aside={`${selectedPermissions.length} no total`}>
              {permissionAreas.length ? permissionAreas.map(([area, paths]) => (
                <div key={area} className="rounded-ds-md bg-ds-warm px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12.5px] font-black text-ds-ink">{AREA_LABELS[area] ?? area}</p>
                    <span className="rounded-full bg-ds-muted px-2 py-0.5 text-[10.5px] font-bold text-ds-ink-muted">{paths.length}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {paths.map((path) => (
                      <span key={path} className="inline-flex items-center gap-1 rounded-ds-sm border border-ds-border bg-ds-surface px-2 py-1 text-[11px] font-semibold text-ds-ink-muted">
                        <Check className="h-3 w-3 text-ds-ok" />
                        {readablePermission(path)}
                      </span>
                    ))}
                  </div>
                </div>
              )) : <p className="text-[12.5px] text-ds-ink-muted">Nenhuma permissão ativa neste perfil.</p>}
            </PanelSection>
            {canEdit ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="ds-secondary" size="md" disabled={copyBlocked} onClick={() => openManager("duplicate", selectedProfile)}>Copiar perfil</Button>
                  <Button type="button" variant="ds-secondary" size="md" onClick={() => openManager("edit", selectedProfile)}>Editar perfil</Button>
                </div>
                {copyBlocked ? <p className="text-xs text-ds-ink-muted">Somente o administrador pode copiar um perfil com permissões de gestão de usuários ou perfis.</p> : null}
                <div className="mt-auto border-t border-ds-divider pt-4">
                  {selectedIsAdministrator ? (
                    <p className="text-xs text-ds-ink-muted">O perfil administrador do sistema não pode ser excluído.</p>
                  ) : confirmDelete ? (
                    <InlineConfirm
                      message={`Excluir o perfil “${selectedProfile.name}”? Esta ação não pode ser desfeita.`}
                      loading={deleting}
                      onConfirm={() => void handleDelete()}
                      onCancel={() => setConfirmDelete(false)}
                      returnFocusRef={deleteButtonRef}
                    />
                  ) : (
                    <Button ref={deleteButtonRef} type="button" variant="danger-link" size="sm" onClick={() => setConfirmDelete(true)}>Excluir perfil</Button>
                  )}
                  {deleteError ? <p role="alert" className="mt-2 text-xs text-ds-danger">{deleteError}</p> : null}
                </div>
              </>
            ) : <p role="note" className="text-xs text-ds-ink-muted">Você pode consultar este perfil, mas não alterá-lo.</p>}
          </>
        ) : null}
      </SidePanel>

      <ProfileManagementModal open={managerOpen} onOpenChange={setManagerOpen} canEdit={canEdit} initialAction={managerAction} initialProfile={managerProfile} />
    </div>
  );
}
