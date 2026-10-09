"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Chevron, EmptyResults, ListHead, ListRow, ListShell, ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { ControlIndicator, ControlPanel, ControlSearch } from "@/components/patterns/control-panel";
import { FilterChips } from "@/components/patterns/filter-chips";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { fetchAuditLogs } from "@/features/audit/client";
import type { AuditLogEntry } from "@/features/audit/types";
import { useAuth } from "@/hooks/use-auth";

const MODULE_LABELS: Record<string, string> = {
  "settings.users": "Usuários",
  "settings.profiles": "Perfis",
  "dp.collaborators": "Colaboradores",
  "dp.schedules": "Escalas",
  "recruitment.candidates": "Candidatos",
  "recruitment.openings": "Vagas",
  "privacy.requests": "Pedidos LGPD",
  "privacy.incidents": "Incidentes",
  "system.cli": "Operações por CLI",
  tasks: "Tarefas",
};

const ACTION_LABELS: Record<string, string> = {
  user_created: "Usuário criado",
  user_updated: "Usuário atualizado",
  user_deleted: "Usuário excluído",
  profile_created: "Perfil criado",
  profile_updated: "Perfil atualizado",
  profile_deleted: "Perfil excluído",
  profile_duplicated: "Perfil duplicado",
  password_reset_email_sent: "Redefinição de senha",
  invite_resent: "Convite reenviado",
  collaborator_profile_viewed: "Perfil visualizado",
  schedule_export_created: "Exportação de escala",
  candidate_created: "Candidato criado",
  candidate_updated: "Candidato atualizado",
  candidate_deleted: "Candidato excluído",
  opening_created: "Vaga criada",
  opening_updated: "Vaga atualizada",
  opening_deleted: "Vaga excluída",
  privacy_request_created: "Pedido LGPD criado",
  privacy_request_updated: "Pedido LGPD atualizado",
  security_incident_created: "Incidente criado",
  security_incident_updated: "Incidente atualizado",
  cli_session_started: "Sessão de CLI iniciada",
  cli_session_completed: "Sessão de CLI concluída",
  cli_session_failed: "Sessão de CLI encerrada com erro",
  cli_operation_recorded: "Operação registrada pela CLI",
};

/** Filtros por módulo consultados no servidor. */
const MODULE_CHIPS = [
  { value: "settings.users", label: "Usuários" },
  { value: "settings.profiles", label: "Perfis" },
  { value: "dp.collaborators", label: "Colaboradores" },
  { value: "dp.schedules", label: "Escalas" },
  { value: "recruitment", label: "Recrutamento" },
  { value: "privacy", label: "Privacidade" },
  { value: "system.cli", label: "Operações por CLI" },
  { value: "tasks", label: "Tarefas" },
];

const ROW_TEMPLATE = "150px minmax(160px,1fr) minmax(210px,1.2fr) minmax(160px,1fr) 120px 16px";
const LOG_LIMIT = 120;

type FocusFilter = "all" | "users" | "password" | "views";

const isPasswordEvent = (log: AuditLogEntry) => log.action === "password_reset_email_sent" || log.action === "invite_resent";
const isUserEvent = (log: AuditLogEntry) => log.module === "settings.users";
const isSensitiveView = (log: AuditLogEntry) => log.action === "collaborator_profile_viewed";

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

function getTarget(metadata: Record<string, unknown>) {
  const name = typeof metadata.target_name === "string" ? metadata.target_name : "";
  const id = typeof metadata.target_id === "string" ? metadata.target_id : "";
  return name || id || "-";
}

export function InternalAuditPanel() {
  const { firebaseUser } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  // A busca consulta o servidor: só vale ao confirmar (Enter) e não a cada tecla.
  const [appliedSearch, setAppliedSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusFilter>("all");
  const [openLogId, setOpenLogId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchAuditLogs(firebaseUser, {
        search: appliedSearch,
        module: moduleFilter ?? undefined,
        limit: LOG_LIMIT,
      });
      setLogs(payload.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar auditoria.");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, moduleFilter, appliedSearch]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const visibleLogs = useMemo(() => {
    if (focus === "users") return logs.filter(isUserEvent);
    if (focus === "password") return logs.filter(isPasswordEvent);
    if (focus === "views") return logs.filter(isSensitiveView);
    return logs;
  }, [logs, focus]);

  const indicators: Array<{ id: FocusFilter; label: string; value: number; tone: "info" | "warning" | "danger" | "neutral" }> = [
    { id: "all", label: "Eventos listados", value: logs.length, tone: "neutral" },
    { id: "users", label: "Usuários", value: logs.filter(isUserEvent).length, tone: "info" },
    { id: "password", label: "Senha e convites", value: logs.filter(isPasswordEvent).length, tone: "warning" },
    { id: "views", label: "Visualizações sensíveis", value: logs.filter(isSensitiveView).length, tone: "danger" },
  ];

  const openLog = openLogId ? logs.find((log) => log.id === openLogId) ?? null : null;

  return (
    <div className="space-y-5">
      <ControlPanel className="flex flex-col gap-5 px-[26px] pb-5 pt-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Auditoria interna</p>
            <p className="mt-1.5 text-[13.5px] text-ds-on-dark-2">
              Registro de acessos e alterações relevantes para LGPD, segurança e governança.
            </p>
          </div>
          <Button type="button" variant="on-dark-secondary" size="md" loading={loading} loadingLabel="Atualizando…" onClick={() => void loadLogs()}>
            Atualizar
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-1 border-b border-white/10 lg:grid-cols-4">
          {indicators.map((item) => (
            <ControlIndicator
              key={item.id}
              value={item.value}
              label={item.label}
              tone={item.tone}
              active={focus === item.id && item.id !== "all"}
              onClick={() => setFocus((current) => (current === item.id ? "all" : item.id))}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ControlSearch
            value={searchText}
            onChange={(value) => {
              setSearchText(value);
              if (value === "") setAppliedSearch("");
            }}
            onSubmit={() => setAppliedSearch(searchText.trim())}
            placeholder="Buscar por usuário, ação, IP ou destino e pressionar Enter"
          />
          <Button type="button" variant="on-dark-secondary" size="xl" onClick={() => setAppliedSearch(searchText.trim())}>
            Filtrar
          </Button>
        </div>
        <FilterChips chips={MODULE_CHIPS} value={moduleFilter} onChange={setModuleFilter} allLabel="Todos os módulos" />
      </ControlPanel>

      {error ? (
        <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[13px] font-semibold text-ds-confirm-ink">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{visibleLogs.length}</span>
        <span className="text-[13px] text-ds-ink-faint">
          {focus === "all" ? "eventos" : `de ${logs.length} eventos`}
          {logs.length >= LOG_LIMIT ? ` · mostrando os ${LOG_LIMIT} mais recentes; refine a busca para ver outros` : ""}
        </span>
      </div>

      <ListShell minWidth={900}>
        <ListHead template={ROW_TEMPLATE}>
          <span>Data</span>
          <span>Ator</span>
          <span>Ação</span>
          <span>Destino</span>
          <span>IP</span>
          <span />
        </ListHead>
        {loading && logs.length === 0 ? <ListSkeleton rows={6} /> : null}
        {visibleLogs.map((log) => (
          <ListRow
            key={log.id}
            template={ROW_TEMPLATE}
            isOpen={openLogId === log.id}
            isSelected={false}
            isMuted={false}
            onOpen={() => setOpenLogId(log.id)}
            label={`Abrir evento de ${formatDate(log.timestamp)}`}
          >
            <span className="text-xs font-semibold text-ds-ink-muted">{formatDate(log.timestamp)}</span>
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-bold">{log.username ?? "Sistema"}</p>
              <p className="truncate text-xs text-ds-ink-faint">{log.user_id ?? "-"}</p>
            </div>
            <div className="min-w-0 space-y-1">
              <StatusPill variant="neutral">{MODULE_LABELS[log.module] ?? log.module}</StatusPill>
              <p className="truncate text-xs font-bold text-ds-ink-2">{ACTION_LABELS[log.action] ?? log.action}</p>
            </div>
            <span className="truncate text-[13px] font-semibold">{getTarget(log.metadata)}</span>
            <span className="truncate font-ds-mono text-xs text-ds-ink-muted">{log.ip_address ?? "-"}</span>
            <Chevron />
          </ListRow>
        ))}
        {!loading && visibleLogs.length === 0 ? (
          <EmptyResults
            title="Nenhum evento encontrado com esses filtros."
            onClear={() => { setSearchText(""); setAppliedSearch(""); setModuleFilter(null); setFocus("all"); }}
          />
        ) : null}
      </ListShell>

      <SidePanel
        open={!!openLog}
        onOpenChange={(open) => { if (!open) setOpenLogId(null); }}
        kicker={openLog ? (MODULE_LABELS[openLog.module] ?? openLog.module) : "Evento"}
        title={openLog ? (ACTION_LABELS[openLog.action] ?? openLog.action) : ""}
        subtitle={openLog ? formatDate(openLog.timestamp) : undefined}
      >
        {openLog ? (
          <PanelSection title="Registro">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="Ator">{openLog.username ?? "Sistema"}</PanelField>
              <PanelField label="ID do usuário"><span className="break-all font-ds-mono text-xs">{openLog.user_id ?? "-"}</span></PanelField>
              <PanelField label="Destino">{getTarget(openLog.metadata)}</PanelField>
              <PanelField label="IP"><span className="font-ds-mono text-xs">{openLog.ip_address ?? "-"}</span></PanelField>
            </div>
          </PanelSection>
        ) : null}
      </SidePanel>
    </div>
  );
}
