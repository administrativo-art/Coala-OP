"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RefreshCcw, Search, ShieldCheck } from "lucide-react";

import { fetchAuditLogs } from "@/features/audit/client";
import type { AuditLogEntry } from "@/features/audit/types";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MODULE_LABELS: Record<string, string> = {
  "settings.users": "Usuarios",
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
  user_created: "Usuario criado",
  user_updated: "Usuario atualizado",
  user_deleted: "Usuario excluido",
  profile_created: "Perfil criado",
  profile_updated: "Perfil atualizado",
  profile_deleted: "Perfil excluido",
  profile_duplicated: "Perfil duplicado",
  password_reset_email_sent: "Redefinicao de senha",
  invite_resent: "Convite reenviado",
  collaborator_profile_viewed: "Perfil visualizado",
  schedule_export_created: "Exportacao de escala",
  candidate_created: "Candidato criado",
  candidate_updated: "Candidato atualizado",
  candidate_deleted: "Candidato excluido",
  opening_created: "Vaga criada",
  opening_updated: "Vaga atualizada",
  opening_deleted: "Vaga excluida",
  privacy_request_created: "Pedido LGPD criado",
  privacy_request_updated: "Pedido LGPD atualizado",
  security_incident_created: "Incidente criado",
  security_incident_updated: "Incidente atualizado",
  cli_session_started: "Sessão de CLI iniciada",
  cli_session_completed: "Sessão de CLI concluída",
  cli_session_failed: "Sessão de CLI encerrada com erro",
  cli_operation_recorded: "Operação registrada pela CLI",
};

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
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");

  const loadLogs = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchAuditLogs(firebaseUser, {
        search,
        module: moduleFilter === "all" ? undefined : moduleFilter,
        limit: 120,
      });
      setLogs(payload.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar auditoria.");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, moduleFilter, search]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const stats = useMemo(() => {
    const passwordEvents = logs.filter((log) => log.action === "password_reset_email_sent" || log.action === "invite_resent").length;
    const userEvents = logs.filter((log) => log.module === "settings.users").length;
    const views = logs.filter((log) => log.action === "collaborator_profile_viewed").length;
    return [
      { label: "Eventos listados", value: logs.length },
      { label: "Usuarios", value: userEvents },
      { label: "Senha e convites", value: passwordEvents },
      { label: "Visualizacoes sensiveis", value: views },
    ];
  }, [logs]);

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-slate-200 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-100 text-pink-600">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-lg font-black text-slate-950">Auditoria interna</h2>
                <p className="text-sm font-medium text-slate-500">
                  Registro de acessos e alteracoes relevantes para LGPD, seguranca e governanca.
                </p>
              </div>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadLogs()} disabled={loading}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-[11px] font-black uppercase text-slate-500">{stat.label}</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{stat.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="rounded-2xl border-slate-200 p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void loadLogs();
              }}
              placeholder="Buscar por usuario, acao, IP ou destino..."
              className="h-10 rounded-xl border-slate-100 bg-slate-50 pl-10"
            />
          </div>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="h-10 rounded-xl border-slate-100 bg-slate-50 md:w-[220px]">
              <SelectValue placeholder="Modulo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os modulos</SelectItem>
              <SelectItem value="settings.users">Usuarios</SelectItem>
              <SelectItem value="settings.profiles">Perfis</SelectItem>
              <SelectItem value="dp.collaborators">Colaboradores</SelectItem>
              <SelectItem value="dp.schedules">Escalas</SelectItem>
              <SelectItem value="recruitment">Recrutamento</SelectItem>
              <SelectItem value="privacy">Privacidade</SelectItem>
              <SelectItem value="system.cli">Operações por CLI</SelectItem>
              <SelectItem value="tasks">Tarefas</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" onClick={() => void loadLogs()} className="h-10 rounded-xl bg-slate-950 text-white">
            Filtrar
          </Button>
        </div>
      </Card>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[180px_1fr_1fr_1fr_120px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase text-slate-500">
          <span>Data</span>
          <span>Ator</span>
          <span>Acao</span>
          <span>Destino</span>
          <span>IP</span>
        </div>
        {loading && logs.length === 0 ? (
          <div className="p-8 text-center text-sm font-semibold text-slate-500">Carregando eventos...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-sm font-semibold text-slate-500">Nenhum evento encontrado.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {logs.map((log) => (
              <div key={log.id} className="grid grid-cols-[180px_1fr_1fr_1fr_120px] gap-3 px-4 py-3 text-sm">
                <span className="font-semibold text-slate-500">{formatDate(log.timestamp)}</span>
                <div className="min-w-0">
                  <p className="truncate font-black text-slate-950">{log.username ?? "Sistema"}</p>
                  <p className="truncate text-xs font-medium text-slate-400">{log.user_id ?? "-"}</p>
                </div>
                <div className="min-w-0">
                  <Badge variant="outline" className="mb-1 border-pink-200 bg-pink-50 text-pink-600">
                    {MODULE_LABELS[log.module] ?? log.module}
                  </Badge>
                  <p className="truncate text-xs font-black text-slate-700">{ACTION_LABELS[log.action] ?? log.action}</p>
                </div>
                <span className="truncate font-semibold text-slate-700">{getTarget(log.metadata)}</span>
                <span className="truncate text-xs font-semibold text-slate-500">{log.ip_address ?? "-"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
