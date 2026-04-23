"use client";

import React from "react";
import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Users,
} from "lucide-react";

import type { DPChecklistTemplate, DPUnit } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchDPChecklistAnalytics,
  type DPChecklistAnalyticsPayload,
} from "@/features/dp-checklists/lib/client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function toDateInputValue(date = new Date()) {
  return format(date, "yyyy-MM-dd");
}

function formatDateLabel(value: string) {
  try {
    return format(parseISO(value), "dd/MM", { locale: ptBR });
  } catch {
    return value;
  }
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export function DPChecklistsAnalytics({
  units,
  templates,
}: {
  units: DPUnit[];
  templates: DPChecklistTemplate[];
}) {
  const { firebaseUser } = useAuth();
  const [dateFrom, setDateFrom] = React.useState(
    toDateInputValue(addDays(new Date(), -30))
  );
  const [dateTo, setDateTo] = React.useState(toDateInputValue(new Date()));
  const [selectedUnitId, setSelectedUnitId] = React.useState("all");
  const [selectedTemplateId, setSelectedTemplateId] = React.useState("all");
  const [selectedStatus, setSelectedStatus] = React.useState<
    "all" | "pending" | "claimed" | "completed" | "overdue"
  >("all");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [payload, setPayload] = React.useState<DPChecklistAnalyticsPayload | null>(
    null
  );

  async function loadAnalytics() {
    if (!firebaseUser) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextPayload = await fetchDPChecklistAnalytics(firebaseUser, {
        dateFrom,
        dateTo,
        unitId: selectedUnitId !== "all" ? selectedUnitId : undefined,
        templateId: selectedTemplateId !== "all" ? selectedTemplateId : undefined,
        status: selectedStatus,
        timeZone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Belem",
      });
      setPayload(nextPayload);
    } catch (requestError) {
      setPayload(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Falha ao carregar o painel gerencial dos checklists."
      );
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!firebaseUser) return;
    void loadAnalytics();
  }, [firebaseUser]);

  const summary = payload?.summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Painel gerencial
          </CardTitle>
          <CardDescription>
            Score médio, atrasos e agregados dos checklists gerados no período.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[220px_220px_220px_220px_minmax(0,1fr)]">
          <div className="space-y-2">
            <label className="text-sm font-medium">Data inicial</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Data final</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Unidade</label>
            <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                {units.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {unit.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Template</label>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os templates</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>
            <div className="flex gap-2">
              <Select
                value={selectedStatus}
                onValueChange={(value) =>
                  setSelectedStatus(value as "all" | "pending" | "claimed" | "completed" | "overdue")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pending">Pendentes</SelectItem>
                  <SelectItem value="claimed">Em andamento</SelectItem>
                  <SelectItem value="completed">Concluídos</SelectItem>
                  <SelectItem value="overdue">Em atraso</SelectItem>
                </SelectContent>
              </Select>

              <Button type="button" onClick={() => void loadAnalytics()} disabled={loading}>
                {loading ? "Atualizando..." : "Atualizar"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && !payload ? (
        <div className="space-y-4">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Falha ao carregar painel gerencial</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {payload && summary ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Execuções</p>
                  <p className="text-2xl font-semibold">{summary.totalExecutions}</p>
                </div>
                <ClipboardList className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Taxa de conclusão</p>
                  <p className="text-2xl font-semibold">
                    {formatPercent(summary.completionRate)}
                  </p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Score médio</p>
                  <p className="text-2xl font-semibold">
                    {formatPercent(summary.averageScore)}
                  </p>
                </div>
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Em atraso</p>
                  <p className="text-2xl font-semibold">{summary.overdueExecutions}</p>
                </div>
                <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Colaboradores</p>
                  <p className="text-2xl font-semibold">{summary.uniqueUsers}</p>
                </div>
                <Users className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Execuções em atraso</CardTitle>
                <CardDescription>
                  Checklists ainda abertos após o fim do turno.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {payload.overdueExecutions.length === 0 ? (
                  <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhuma execução em atraso no período filtrado.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Checklist</TableHead>
                        <TableHead>Responsável</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Atraso</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payload.overdueExecutions.map((execution) => (
                        <TableRow key={execution.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium">{execution.templateName}</p>
                              <p className="text-xs text-muted-foreground">
                                {execution.unitName} • {execution.checklistDate} •{" "}
                                {execution.shiftStartTime} - {execution.shiftEndTime}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p>{execution.assignedUsername}</p>
                              {execution.claimedByUsername ? (
                                <p className="text-xs text-muted-foreground">
                                  Em uso por {execution.claimedByUsername}
                                </p>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <Badge variant="outline">
                                {execution.completionPercent}% geral
                              </Badge>
                              <p className="text-xs text-muted-foreground">
                                {execution.requiredCompletionPercent}% obrigatório
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <Badge
                                variant="outline"
                                className="border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
                              >
                                {execution.status === "claimed"
                                  ? "Em andamento"
                                  : "Pendente"}
                              </Badge>
                              <p className="text-xs text-muted-foreground">
                                Desde {execution.overdueSinceLocal ?? "—"}
                              </p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Por unidade</CardTitle>
                  <CardDescription>
                    Unidades com mais execuções no período.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {payload.byUnit.slice(0, 5).map((item) => (
                    <div
                      key={item.unitId || "__none__"}
                      className="flex items-center justify-between rounded-lg border px-3 py-3"
                    >
                      <div>
                        <p className="font-medium">{item.unitName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.completedExecutions}/{item.totalExecutions} concluídos •{" "}
                          {item.overdueExecutions} atrasados
                        </p>
                      </div>
                      <Badge variant="secondary">{formatPercent(item.averageScore)}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Por template</CardTitle>
                  <CardDescription>
                    Templates com maior volume no período.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {payload.byTemplate.slice(0, 5).map((item) => (
                    <div
                      key={item.templateId}
                      className="flex items-center justify-between rounded-lg border px-3 py-3"
                    >
                      <div>
                        <p className="font-medium">{item.templateName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.completedExecutions}/{item.totalExecutions} concluídos •{" "}
                          {item.overdueExecutions} atrasados
                        </p>
                      </div>
                      <Badge variant="secondary">{formatPercent(item.averageScore)}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Tendência diária</CardTitle>
                <CardDescription>
                  Evolução de volume, conclusão e atrasos por dia.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dia</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Concluídos</TableHead>
                      <TableHead>Atrasos</TableHead>
                      <TableHead>Score médio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payload.dailyTrend.map((item) => (
                      <TableRow key={item.date}>
                        <TableCell>{formatDateLabel(item.date)}</TableCell>
                        <TableCell>{item.totalExecutions}</TableCell>
                        <TableCell>{item.completedExecutions}</TableCell>
                        <TableCell>{item.overdueExecutions}</TableCell>
                        <TableCell>{formatPercent(item.averageScore)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Por colaborador</CardTitle>
                <CardDescription>
                  Execuções atribuídas no período filtrado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Colaborador</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Concluídos</TableHead>
                      <TableHead>Atrasos</TableHead>
                      <TableHead>Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payload.byUser.slice(0, 10).map((item) => (
                      <TableRow key={item.userId}>
                        <TableCell>{item.username}</TableCell>
                        <TableCell>{item.totalExecutions}</TableCell>
                        <TableCell>{item.completedExecutions}</TableCell>
                        <TableCell>{item.overdueExecutions}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                            {formatPercent(item.averageScore)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
