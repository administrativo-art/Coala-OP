"use client";

import { useMemo, useState } from "react";

import { EmptyResults, ListHead, ListShell, ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { ControlPanel, ControlSearch } from "@/components/patterns/control-panel";
import { LiftRow } from "@/components/patterns/lift-row";
import { ProfileManagementModal } from "@/components/profile-management-modal";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useProfiles } from "@/hooks/use-profiles";

type AccessProfilesSettingsProps = {
  canEdit: boolean;
};

const ROW_TEMPLATE = "minmax(240px,1.6fr) minmax(200px,1fr)";

export function AccessProfilesSettings({ canEdit }: AccessProfilesSettingsProps) {
  const { profiles, loading, adminProfileId } = useProfiles();
  const [managerOpen, setManagerOpen] = useState(false);
  const [search, setSearch] = useState("");

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
          <p className="mt-1 font-ds-mono text-[44px] font-bold leading-none tracking-[-0.05em]">{loading ? "—" : profiles.length}</p>
          <p className="mt-1 text-base font-extrabold">{profiles.length === 1 ? "Perfil disponível" : "Perfis disponíveis"}</p>
          <p className="mt-2 max-w-2xl text-[13px] text-ds-on-dark-2">
            Defina quais módulos, informações e ações ficam disponíveis para cada perfil de acesso do Coala One.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ControlSearch value={search} onChange={setSearch} placeholder="Buscar perfil" />
          <Button type="button" variant="primary-page" size="xl" disabled={!canEdit} onClick={() => setManagerOpen(true)}>
            Gerenciar perfis
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
            <LiftRow key={profile.id} interactive={false} className="grid items-center gap-3.5 px-5 py-[11px] last:border-b-0" style={{ gridTemplateColumns: ROW_TEMPLATE }}>
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

      <ProfileManagementModal open={managerOpen} onOpenChange={setManagerOpen} canEdit={canEdit} />
    </div>
  );
}
