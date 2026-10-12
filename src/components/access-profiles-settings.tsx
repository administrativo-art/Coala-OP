"use client";

import { useMemo, useRef, useState } from "react";

import { EmptyResults, ListHead, ListShell, ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { ControlPanel, ControlSearch } from "@/components/patterns/control-panel";
import { LiftRow } from "@/components/patterns/lift-row";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { ProfileManagementModal, logProfileAudit } from "@/components/profile-management-modal";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useAuth } from "@/hooks/use-auth";
import { useProfiles } from "@/hooks/use-profiles";
import type { Profile } from "@/types";

type AccessProfilesSettingsProps = {
  canEdit: boolean;
};

const ROW_TEMPLATE = "minmax(240px,1.6fr) minmax(200px,1fr)";

const AREA_LABELS: Record<string, string> = {
  dashboard: "Painel", registration: "Cadastros", stock: "Estoque", assets: "Patrimônio",
  pricing: "Precificação", commercial: "Comercial", settings: "Configurações", tasks: "Tarefas",
  goals: "Metas", help: "Ajuda", reposition: "Reposição", itemRequests: "Solicitações",
  signage: "Sinalização", dp: "Pessoal", financial: "Financeiro", hr: "RH", app: "Aplicativo",
};

function activePermissions(value: unknown, path = ""): string[] {
  if (value === true) return [path];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => activePermissions(child, path ? `${path}.${key}` : key));
}

function readablePermission(path: string) {
  return path.split(".").slice(1).map((segment) => segment.replace(/([a-z])([A-Z])/g, "$1 $2")).join(" · ");
}

export function AccessProfilesSettings({ canEdit }: AccessProfilesSettingsProps) {
  const { profiles, loading, adminProfileId, deleteProfile } = useProfiles();
  const { firebaseUser, isDefaultAdmin } = useAuth();
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

      <ListShell minWidth={520}>
        <ListHead template={ROW_TEMPLATE}>
          <span>Perfil</span>
          <span>Tipo</span>
        </ListHead>
        {loading ? <ListSkeleton rows={3} /> : null}
        {visibleProfiles.map((profile) => {
          const isAdministrator = profile.id === adminProfileId || profile.isDefaultAdmin === true;
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
                <div key={area}>
                  <p className="text-[12.5px] font-bold text-ds-ink">{AREA_LABELS[area] ?? area} · {paths.length}</p>
                  <ul className="mt-1 space-y-1 pl-4 text-[12px] text-ds-ink-muted">
                    {paths.map((path) => <li key={path} className="list-disc">{readablePermission(path)}</li>)}
                  </ul>
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
