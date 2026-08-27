"use client";

import { useMemo, useState } from "react";
import { ShieldCheck, UsersRound } from "lucide-react";

import { useProfiles } from "@/hooks/use-profiles";
import { Button } from "@/components/ui/button";
import { ProfileManagementModal } from "@/components/profile-management-modal";

type AccessProfilesSettingsProps = {
  canEdit: boolean;
};

export function AccessProfilesSettings({ canEdit }: AccessProfilesSettingsProps) {
  const { profiles, loading, adminProfileId } = useProfiles();
  const [managerOpen, setManagerOpen] = useState(false);

  const sortedProfiles = useMemo(
    () => [...profiles].sort((left, right) => {
      if (left.id === adminProfileId) return -1;
      if (right.id === adminProfileId) return 1;
      return left.name.localeCompare(right.name, "pt-BR");
    }),
    [adminProfileId, profiles],
  );

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-pink-50 text-pink-600">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-black text-slate-950">Perfis de permissão</h3>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Defina quais módulos, informações e ações ficam disponíveis para cada perfil de acesso do Coala One.
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => setManagerOpen(true)}
            disabled={!canEdit}
            className="shrink-0 rounded-xl"
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            Gerenciar perfis
          </Button>
        </div>

        <div className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-slate-400">Perfis cadastrados</p>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                {loading
                  ? "Carregando perfis..."
                  : profiles.length === 1
                    ? "1 perfil disponível"
                    : `${profiles.length} perfis disponíveis`}
              </p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500">
              <UsersRound className="h-5 w-5" />
            </span>
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-16 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : sortedProfiles.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sortedProfiles.map((profile) => {
                const isAdministrator = profile.id === adminProfileId || profile.isDefaultAdmin === true;
                return (
                  <div key={profile.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${isAdministrator ? "bg-pink-100 text-pink-700" : "bg-white text-slate-500"}`}>
                      <ShieldCheck className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900">{profile.name}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                        {isAdministrator ? "Perfil administrador do sistema" : "Perfil personalizado"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-medium text-slate-500">
              Nenhum perfil de permissão cadastrado.
            </div>
          )}

          <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-xs font-semibold leading-relaxed text-blue-800">
            O perfil é aplicado ao colaborador conforme o cargo e a função configurados em “Cargos e funções”.
          </p>
        </div>
      </section>

      <ProfileManagementModal
        open={managerOpen}
        onOpenChange={setManagerOpen}
        canEdit={canEdit}
      />
    </>
  );
}
