"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Clock, Loader2, UserCheck, Users } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useProfiles } from "@/hooks/use-profiles";
import { useKiosks } from "@/hooks/use-kiosks";
import type { User } from "@/types";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";

const USERS_TAB_HREF = "/dashboard/settings?department=pessoal&tab=users";

function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function lastAccessLabel(value: unknown) {
  if (!value) return "Nunca acessou";
  try {
    const date =
      typeof value === "object" && value && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : new Date(value as string);
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 60) return `há ${Math.max(minutes, 1)} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `há ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "ontem";
    return `há ${days} dias`;
  } catch {
    return "Nunca acessou";
  }
}

function InactiveUserRow({
  user,
  profileName,
  kioskNames,
  canManage,
  onReactivate,
  saving,
}: {
  user: User;
  profileName: string;
  kioskNames: string;
  canManage: boolean;
  onReactivate: (user: User) => void;
  saving: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: user.color || "#94a3b8" }}
        >
          {initialsOf(user.username || "?")}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-slate-900">{user.username}</p>
            <span className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              Inativo
            </span>
          </div>
          <p className="truncate text-xs text-slate-500">{user.email}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {profileName}
            {kioskNames ? ` · ${kioskNames}` : ""}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          <Clock className="h-3.5 w-3.5" />
          {lastAccessLabel(user.lastLoginAt)}
        </span>
        {canManage ? (
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => onReactivate(user)}
            className="rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
            Reativar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function InactiveUsersScreen() {
  const { users, permissions, updateUser } = useAuth();
  const { profiles } = useProfiles();
  const { kiosks } = useKiosks();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canView = !!permissions.settings?.view || !!permissions.settings?.manageUsers;
  const canManage = !!permissions.settings?.manageUsers;

  const inactiveUsers = useMemo(
    () => users.filter((user) => user.isActive === false).sort((a, b) => a.username.localeCompare(b.username)),
    [users]
  );

  const profileName = (profileId: string) => profiles.find((profile) => profile.id === profileId)?.name ?? "Sem perfil";
  const kioskNames = (ids: string[] = []) =>
    ids
      .map((id) => kiosks.find((kiosk) => kiosk.id === id)?.name ?? id)
      .filter(Boolean)
      .join(", ");

  const handleReactivate = async (user: User) => {
    try {
      setSavingId(user.id);
      setError(null);
      await updateUser({ ...user, isActive: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao reativar o usuário.");
    } finally {
      setSavingId(null);
    }
  };

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Acesso negado</h1>
          <p className="mt-1 text-sm text-slate-500">Você não tem permissão para visualizar os usuários.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <BackButton
        fallbackHref={USERS_TAB_HREF}
        variant="ghost"
        iconOnly
        className="h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
        ariaLabel="Voltar para usuários"
      />

      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Usuários inativos</h1>
          <p className="text-sm text-slate-500">
            {inactiveUsers.length} usuário(s) inativo(s) · sem acesso ao sistema
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      ) : null}

      {inactiveUsers.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          Nenhum usuário inativo. Todos os usuários estão ativos.
        </div>
      ) : (
        <div className="space-y-3">
          {inactiveUsers.map((user) => (
            <InactiveUserRow
              key={user.id}
              user={user}
              profileName={profileName(user.profileId)}
              kioskNames={kioskNames(user.assignedKioskIds)}
              canManage={canManage}
              onReactivate={handleReactivate}
              saving={savingId === user.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
