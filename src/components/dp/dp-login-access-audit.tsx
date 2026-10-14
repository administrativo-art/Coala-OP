"use client";

import React from "react";
import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Chevron, EmptyResults, ListHead, ListRow, ListShell, ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { StatTile } from "@/components/patterns/stat-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { fetchHrLoginAccessAudit, type HrLoginAccessAuditPayload } from "@/features/hr/lib/client";
import { useAuth } from "@/hooks/use-auth";

type Group = HrLoginAccessAuditPayload["groups"][number];

const ROW_TEMPLATE = "minmax(200px,1.3fr) minmax(200px,1.3fr) 140px 150px 150px 16px";

function toDateInputValue(date = new Date()) {
  return format(date, "yyyy-MM-dd");
}

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd/MM/yyyy HH:mm", { locale: ptBR });
  } catch {
    return value;
  }
}

function shiftWindowLabel(group: Group) {
  if (group.shiftDate !== group.shiftEndDate) {
    return `${group.shiftDate} ${group.shiftStartTime} → ${group.shiftEndDate} ${group.shiftEndTime}`;
  }
  return `${group.shiftDate} ${group.shiftStartTime} – ${group.shiftEndTime}`;
}

function byUserName(left: { username: string }, right: { username: string }) {
  return left.username.localeCompare(right.username, "pt-BR");
}

function ExtensionPill({ group }: { group: Group }) {
  return group.limitReached ? (
    <StatusPill variant="danger">Limite atingido</StatusPill>
  ) : (
    <StatusPill variant="ok">{group.remainingExtensions} restante{group.remainingExtensions === 1 ? "" : "s"}</StatusPill>
  );
}

export function DPLoginAccessAudit() {
  const { firebaseUser, activeUsers } = useAuth();
  const [selectedUserId, setSelectedUserId] = React.useState("all");
  const [selectedUnitId, setSelectedUnitId] = React.useState("all");
  const [shiftIdQuery, setShiftIdQuery] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState(toDateInputValue(addDays(new Date(), -30)));
  const [dateTo, setDateTo] = React.useState(toDateInputValue(new Date()));
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<HrLoginAccessAuditPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = React.useState<string | null>(null);

  const users = React.useMemo(() => [...activeUsers].sort(byUserName), [activeUsers]);

  async function loadAudit() {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchHrLoginAccessAudit(firebaseUser, {
        userId: selectedUserId !== "all" ? selectedUserId : undefined,
        unitId: selectedUnitId !== "all" ? selectedUnitId : undefined,
        shiftId: shiftIdQuery.trim() || undefined,
        dateFrom,
        dateTo,
      });
      setResult(payload);
    } catch (requestError) {
      setResult(null);
      setError(requestError instanceof Error ? requestError.message : "Falha ao carregar a auditoria de acesso por escala.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!firebaseUser) return;
    void loadAudit();
    // A primeira consulta roda ao entrar; depois só pelo botão "Atualizar auditoria".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser]);

  function resetFilters() {
    setSelectedUserId("all");
    setSelectedUnitId("all");
    setShiftIdQuery("");
    setDateFrom(toDateInputValue(addDays(new Date(), -30)));
    setDateTo(toDateInputValue(new Date()));
  }

  const openGroup = openGroupId ? result?.groups.find((group) => group.id === openGroupId) ?? null : null;

  return (
    <div className="space-y-5">
      <section className="space-y-5 rounded-ds-card-lg border border-ds-border bg-ds-warm p-6">
        <header>
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">Auditoria do limitador</p>
          <p className="mt-1 text-[13px] text-ds-ink-muted">
            Histórico das justificativas e extensões concedidas por turno. O agrupamento é feito por colaborador + turno.
          </p>
        </header>
        <div className="grid gap-4 lg:grid-cols-4">
          <Field label="Colaborador" htmlFor="audit-user">
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger id="audit-user" className={fieldInputClass}>
                <SelectValue placeholder="Todos os colaboradores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os colaboradores</SelectItem>
                {users.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.username}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Unidade" htmlFor="audit-unit">
            <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
              <SelectTrigger id="audit-unit" className={fieldInputClass}>
                <SelectValue placeholder="Todas as unidades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                {(result?.availableUnits ?? []).map((unit) => (
                  <SelectItem key={unit.id || "__none__"} value={unit.id || "__none__"}>{unit.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Data inicial" htmlFor="audit-from">
            <Input id="audit-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={fieldInputClass} />
          </Field>
          <Field label="Data final" htmlFor="audit-to">
            <Input id="audit-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={fieldInputClass} />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Turno" htmlFor="audit-shift" requirement="opcional" className="min-w-[240px] flex-1">
            <Input id="audit-shift" value={shiftIdQuery} onChange={(event) => setShiftIdQuery(event.target.value)} placeholder="Filtrar por ID do turno" className={fieldInputClass} />
          </Field>
          <Button type="button" variant="ds-secondary" size="md" disabled={loading} onClick={resetFilters}>Limpar filtros</Button>
          <Button type="button" variant="primary-page" size="md" loading={loading} loadingLabel="Atualizando…" onClick={() => void loadAudit()}>
            Atualizar auditoria
          </Button>
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[13px] font-semibold text-ds-confirm-ink">{error}</p>
      ) : null}

      {result?.summary.truncated ? (
        <p role="status" className="rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg px-3.5 py-[11px] text-[12.5px] leading-normal text-ds-alert-ink">
          <strong className="font-extrabold">Resultado parcial.</strong> O período consultado atingiu o limite de leitura desta tela. Refine os filtros para uma auditoria mais completa.
        </p>
      ) : null}

      {result ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile label="Justificativas" value={result.summary.totalJustifications} />
          <StatTile label="Minutos extras" value={result.summary.totalExtensionMinutes} />
          <StatTile label="Colaboradores" value={result.summary.uniqueUsers} />
          <StatTile label="Turnos impactados" value={result.summary.uniqueShifts} />
          <StatTile label="Limite atingido" value={result.summary.limitReachedShifts} />
        </div>
      ) : null}

      <ListShell minWidth={900}>
        <ListHead template={ROW_TEMPLATE}>
          <span>Colaborador</span>
          <span>Turno</span>
          <span>Extensões</span>
          <span>Primeiro bloqueio</span>
          <span>Última liberação</span>
          <span />
        </ListHead>
        {loading && !result ? <ListSkeleton rows={5} /> : null}
        {result?.groups.map((group) => (
          <ListRow
            key={group.id}
            template={ROW_TEMPLATE}
            isOpen={openGroupId === group.id}
            isSelected={false}
            isMuted={false}
            onOpen={() => setOpenGroupId(group.id)}
            label={`Abrir justificativas de ${group.username}`}
          >
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-bold">{group.username}</p>
              <p className="truncate text-xs text-ds-ink-muted">{group.jobRoleName ?? "Sem cargo"} · {group.unitName}</p>
            </div>
            <span className="font-ds-mono text-xs text-ds-ink-2">{shiftWindowLabel(group)}</span>
            <div className="flex flex-col items-start gap-1">
              <span className="text-xs font-bold">{group.extensionCount} extensão{group.extensionCount === 1 ? "" : "ões"}</span>
              <ExtensionPill group={group} />
            </div>
            <span className="text-xs text-ds-ink-muted">{formatTimestamp(group.blockedAtFirst)}</span>
            <span className="text-xs text-ds-ink-muted">{formatTimestamp(group.lastGrantedUntil)}</span>
            <Chevron />
          </ListRow>
        ))}
        {result && result.groups.length === 0 ? (
          <EmptyResults title="Nenhuma justificativa encontrada para os filtros informados." onClear={resetFilters} />
        ) : null}
      </ListShell>

      <SidePanel
        open={!!openGroup}
        onOpenChange={(open) => { if (!open) setOpenGroupId(null); }}
        kicker="Justificativas do limitador"
        title={openGroup?.username ?? ""}
        subtitle={openGroup ? `${openGroup.jobRoleName ?? "Sem cargo"} · ${openGroup.unitName}` : undefined}
      >
        {openGroup ? (
          <>
            <PanelSection title="Turno" aside={<ExtensionPill group={openGroup} />}>
              <PanelField label="Janela"><span className="font-ds-mono text-xs">{shiftWindowLabel(openGroup)}</span></PanelField>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <PanelField label="Primeiro bloqueio">{formatTimestamp(openGroup.blockedAtFirst)}</PanelField>
                <PanelField label="Última liberação">{formatTimestamp(openGroup.lastGrantedUntil)}</PanelField>
                <PanelField label="Escala">{openGroup.scheduleId || "Não informada"}</PanelField>
                <PanelField label="ID do turno"><span className="break-all font-ds-mono text-xs">{openGroup.shiftId}</span></PanelField>
              </div>
            </PanelSection>
            {openGroup.items.map((item) => (
              <PanelSection key={item.id} title={`Extensão #${item.sequence}`} aside={`${item.grantedMinutes} min concedidos`}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                  <PanelField label="Bloqueado em">{formatTimestamp(item.blockedAt)}</PanelField>
                  <PanelField label="Justificou em">{formatTimestamp(item.submittedAt)}</PanelField>
                  <PanelField label="Liberado até">{formatTimestamp(item.grantedUntil)}</PanelField>
                  <PanelField label="Registrado por">
                    {item.actorUserId === item.userId ? "Autojustificativa" : item.actorUserId ?? "Sistema"}
                  </PanelField>
                </div>
                <PanelField label="Justificativa">
                  <span className="block whitespace-pre-wrap font-medium leading-5">{item.justificationText}</span>
                </PanelField>
              </PanelSection>
            ))}
          </>
        ) : null}
      </SidePanel>
    </div>
  );
}
