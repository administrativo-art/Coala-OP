"use client";

import React from "react";
import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, Clock3, History, ShieldAlert, TimerReset, Users } from "lucide-react";

import {
  fetchHrLoginAccessAudit,
  type HrLoginAccessAuditPayload,
} from "@/features/hr/lib/client";
import { useAuth } from "@/hooks/use-auth";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

function toDateInputValue(date = new Date()) {
  return format(date, "yyyy-MM-dd");
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "—";
  }

  try {
    return format(parseISO(value), "dd/MM/yyyy HH:mm", { locale: ptBR });
  } catch {
    return value;
  }
}

function shiftWindowLabel(
  group: HrLoginAccessAuditPayload["groups"][number]
) {
  if (group.shiftDate !== group.shiftEndDate) {
    return `${group.shiftDate} ${group.shiftStartTime} -> ${group.shiftEndDate} ${group.shiftEndTime}`;
  }

  return `${group.shiftDate} ${group.shiftStartTime} - ${group.shiftEndTime}`;
}

function byUserName(
  left: { username: string },
  right: { username: string }
) {
  return left.username.localeCompare(right.username, "pt-BR");
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

  const users = React.useMemo(() => [...activeUsers].sort(byUserName), [activeUsers]);

  async function loadAudit() {
    if (!firebaseUser) {
      return;
    }

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
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Falha ao carregar a auditoria de acesso por escala."
      );
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!firebaseUser) {
      return;
    }

    void loadAudit();
  }, [firebaseUser]);

  function resetFilters() {
    setSelectedUserId("all");
    setSelectedUnitId("all");
    setShiftIdQuery("");
    setDateFrom(toDateInputValue(addDays(new Date(), -30)));
    setDateTo(toDateInputValue(new Date()));
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <History className="h-5 w-5" />
            Auditoria do limitador
          </CardTitle>
          <CardDescription>
            Histórico das justificativas e extensões concedidas por turno. O agrupamento é feito por colaborador + turno.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px_220px]">
          <div className="space-y-2">
            <label className="text-sm font-medium">Colaborador</label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Todos os colaboradores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os colaboradores</SelectItem>
                {users.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Unidade</label>
            <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
              <SelectTrigger>
                <SelectValue placeholder="Todas as unidades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                {(result?.availableUnits ?? []).map((unit) => (
                  <SelectItem key={unit.id || "__none__"} value={unit.id || "__none__"}>
                    {unit.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Data inicial</label>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Data final</label>
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>

          <div className="space-y-2 lg:col-span-2">
            <label className="text-sm font-medium">Turno</label>
            <Input
              value={shiftIdQuery}
              onChange={(event) => setShiftIdQuery(event.target.value)}
              placeholder="Filtrar por ID do turno"
            />
          </div>

          <div className="flex items-end gap-2 lg:col-span-2 lg:justify-end">
            <Button type="button" variant="outline" onClick={resetFilters} disabled={loading}>
              Limpar
            </Button>
            <Button type="button" onClick={() => void loadAudit()} disabled={loading}>
              {loading ? "Atualizando..." : "Atualizar auditoria"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading && !result && (
        <div className="space-y-4">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {result && (
        <>
          {result.summary.truncated && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Resultado parcial</AlertTitle>
              <AlertDescription>
                O período consultado atingiu o limite de leitura desta tela. Refine os filtros para uma auditoria mais completa.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Justificativas</p>
                  <p className="text-2xl font-semibold">{result.summary.totalJustifications}</p>
                </div>
                <History className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Minutos extras</p>
                  <p className="text-2xl font-semibold">{result.summary.totalExtensionMinutes}</p>
                </div>
                <Clock3 className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Colaboradores</p>
                  <p className="text-2xl font-semibold">{result.summary.uniqueUsers}</p>
                </div>
                <Users className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Turnos impactados</p>
                  <p className="text-2xl font-semibold">{result.summary.uniqueShifts}</p>
                </div>
                <ShieldAlert className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Limite atingido</p>
                  <p className="text-2xl font-semibold">{result.summary.limitReachedShifts}</p>
                </div>
                <TimerReset className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </div>

          {result.groups.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Nenhuma justificativa encontrada para os filtros informados.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {result.groups.map((group) => (
                <Card key={group.id}>
                  <CardHeader className="gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <CardTitle className="text-base">{group.username}</CardTitle>
                        <CardDescription>
                          {group.jobRoleName ?? "Sem cargo"} • {group.unitName}
                        </CardDescription>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {group.extensionCount} extensão{group.extensionCount === 1 ? "" : "ões"}
                        </Badge>
                        {group.limitReached ? (
                          <Badge className="border-red-200 bg-red-50 text-red-700 hover:bg-red-50" variant="outline">
                            Limite atingido
                          </Badge>
                        ) : (
                          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50" variant="outline">
                            {group.remainingExtensions} restante{group.remainingExtensions === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <p className="font-medium text-foreground">Turno</p>
                        <p>{shiftWindowLabel(group)}</p>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">Primeiro bloqueio</p>
                        <p>{formatTimestamp(group.blockedAtFirst)}</p>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">Última liberação</p>
                        <p>{formatTimestamp(group.lastGrantedUntil)}</p>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">Referências</p>
                        <p>Escala: {group.scheduleId || "não informada"}</p>
                        <p className="text-xs">Turno: {group.shiftId}</p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {group.items.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-slate-200 bg-slate-50/70 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">#{item.sequence}</Badge>
                            <span className="text-sm font-medium text-foreground">
                              {item.grantedMinutes} min concedidos
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            Registrado por {item.actorUserId === item.userId ? "autojustificativa" : item.actorUserId ?? "sistema"}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
                          <div>
                            <p className="font-medium text-foreground">Bloqueado em</p>
                            <p>{formatTimestamp(item.blockedAt)}</p>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">Justificou em</p>
                            <p>{formatTimestamp(item.submittedAt)}</p>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">Liberado até</p>
                            <p>{formatTimestamp(item.grantedUntil)}</p>
                          </div>
                        </div>

                        <div className="mt-3">
                          <p className="text-sm font-medium text-foreground">Justificativa</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                            {item.justificationText}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
