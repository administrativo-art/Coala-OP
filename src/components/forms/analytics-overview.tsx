"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Info,
  ListChecks,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { activeOperationalUnits } from "@/lib/dp-units";
import { useToast } from "@/hooks/use-toast";
import {
  cancelAnalyticsOccurrence,
  fetchAnalyticsOccurrences,
  fetchAnalyticsSummary,
  fetchAnalyticsTaxonomy,
  rejectAnalyticsOccurrence,
  resolveAnalyticsOccurrence,
  validateAnalyticsOccurrence,
  type AnalyticsBrandRankingRow,
  type AnalyticsDashboardCards,
  type AnalyticsDashboardFilters,
  type AnalyticsExtendedMetrics,
  type AnalyticsOccurrenceRow,
  type AnalyticsRankingRow,
  type AnalyticsRecurrenceRow,
  type AnalyticsTaxonomyEntry,
} from "@/features/forms/lib/client";

const STATUS_LABELS: Record<string, string> = {
  open: "Aberta",
  in_progress: "Em andamento",
  waiting: "Aguardando",
  blocked: "Bloqueada",
  pending_validation: "Aguardando validação",
  resolved: "Resolvida",
  cancelled: "Cancelada",
  not_required: "Sem tratativa",
};

const SEVERITY_LABELS: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

const OPEN_STATUSES = new Set([
  "open",
  "in_progress",
  "waiting",
  "blocked",
]);

function statusBadgeVariant(status: string) {
  if (status === "resolved") return "default" as const;
  if (status === "cancelled") return "secondary" as const;
  if (status === "pending_validation") return "outline" as const;
  return "destructive" as const;
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 3600000);
  const toInput = (date: Date) => date.toISOString().slice(0, 10);
  return { from: toInput(from), to: toInput(to) };
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}min`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function MiniMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-600"
        : "text-foreground";
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

export function FormsAnalyticsOverview({
  canResolve,
  canValidate,
}: {
  canResolve: boolean;
  canValidate: boolean;
}) {
  const { firebaseUser } = useAuth();
  const { units } = useDPBootstrap();
  const { toast } = useToast();

  const [filters, setFilters] = useState<AnalyticsDashboardFilters>(() => ({
    ...defaultDateRange(),
    domainId: "all",
    unitId: "all",
    statusGroup: "all",
  }));
  const [domains, setDomains] = useState<AnalyticsTaxonomyEntry[]>([]);
  const [cards, setCards] = useState<AnalyticsDashboardCards | null>(null);
  const [cardsSource, setCardsSource] = useState<"live" | "daily">("live");
  const [extended, setExtended] = useState<AnalyticsExtendedMetrics | null>(null);
  const [recurrence, setRecurrence] = useState<AnalyticsRecurrenceRow[]>([]);
  const [brandRanking, setBrandRanking] = useState<AnalyticsBrandRankingRow[]>([]);
  const [ranking, setRanking] = useState<AnalyticsRankingRow[]>([]);
  const [rankingGroupBy, setRankingGroupBy] = useState<"criterion" | "target">(
    "criterion"
  );
  const [rows, setRows] = useState<AnalyticsOccurrenceRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AnalyticsOccurrenceRow | null>(
    null
  );
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    const [summaryResult, pageResult] = await Promise.allSettled([
      fetchAnalyticsSummary(firebaseUser, filters, {
        groupBy: rankingGroupBy,
        extended: true,
        recurrence: true,
        brandRanking: true,
      }),
      fetchAnalyticsOccurrences(firebaseUser, filters, { pageSize: 25 }),
    ]);
    if (summaryResult.status === "fulfilled") {
      setCards(summaryResult.value.cards);
      setCardsSource(summaryResult.value.cards_source);
      setExtended(summaryResult.value.extended);
      setRecurrence(summaryResult.value.recurrence ?? []);
      setBrandRanking(summaryResult.value.brand_ranking ?? []);
      setRanking(summaryResult.value.ranking ?? []);
    } else {
      toast({
        variant: "destructive",
        title:
          summaryResult.reason instanceof Error
            ? summaryResult.reason.message
            : "Falha ao carregar indicadores.",
      });
    }
    if (pageResult.status === "fulfilled") {
      setRows(pageResult.value.items);
      setNextCursor(pageResult.value.next_cursor);
    } else {
      // sem permissão de lista de ocorrências: mantém só os cards
      setRows([]);
      setNextCursor(null);
    }
    setLoading(false);
  }, [firebaseUser, filters, rankingGroupBy, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!firebaseUser) return;
    fetchAnalyticsTaxonomy(firebaseUser, "domains")
      .then(setDomains)
      .catch(() => setDomains([]));
  }, [firebaseUser]);

  async function loadMore() {
    if (!firebaseUser || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchAnalyticsOccurrences(firebaseUser, filters, {
        cursor: nextCursor,
        pageSize: 25,
      });
      setRows((current) => [...current, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (error) {
      toast({
        variant: "destructive",
        title:
          error instanceof Error ? error.message : "Falha ao carregar mais.",
      });
    } finally {
      setLoadingMore(false);
    }
  }

  async function runAction(
    row: AnalyticsOccurrenceRow,
    action: "resolve" | "cancel" | "validate"
  ) {
    if (!firebaseUser) return;
    setActionBusyId(row.id);
    try {
      if (action === "resolve") {
        await resolveAnalyticsOccurrence(firebaseUser, row.id);
        toast({ title: "Ocorrência resolvida." });
      } else if (action === "cancel") {
        await cancelAnalyticsOccurrence(firebaseUser, row.id);
        toast({ title: "Ocorrência cancelada." });
      } else {
        await validateAnalyticsOccurrence(firebaseUser, row.id);
        toast({ title: "Resolução validada." });
      }
      await load();
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Falha na ação.",
      });
    } finally {
      setActionBusyId(null);
    }
  }

  async function submitRejection() {
    if (!firebaseUser || !rejectTarget || !rejectReason.trim()) return;
    setActionBusyId(rejectTarget.id);
    try {
      const result = await rejectAnalyticsOccurrence(
        firebaseUser,
        rejectTarget.id,
        rejectReason.trim()
      );
      toast({
        title: result.follow_up_task_id
          ? "Resolução rejeitada — tarefa de follow-up criada."
          : "Resolução rejeitada.",
      });
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch (error) {
      toast({
        variant: "destructive",
        title:
          error instanceof Error ? error.message : "Falha ao rejeitar resolução.",
      });
    } finally {
      setActionBusyId(null);
    }
  }

  const conformityLabel = useMemo(() => {
    if (!cards || cards.conformity_rate === null) return "—";
    return `${(cards.conformity_rate * 100).toFixed(1)}%`;
  }, [cards]);

  const avgResolutionLabel = useMemo(() => {
    const value = extended?.avg_resolution_time_minutes;
    if (value === null || value === undefined) return "—";
    return formatMinutes(Math.round(value));
  }, [extended]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Indicadores de ocorrências
          </CardTitle>
          <CardDescription>
            Registros estruturados gerados pelos formulários no período.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <Label>De</Label>
              <Input
                type="date"
                value={filters.from}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, from: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Até</Label>
              <Input
                type="date"
                value={filters.to}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, to: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Domínio</Label>
              <Select
                value={filters.domainId}
                onValueChange={(value) =>
                  setFilters((current) => ({ ...current, domainId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {domains.map((domain) => (
                    <SelectItem key={domain.id} value={domain.id}>
                      {domain.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Unidade</Label>
              <Select
                value={filters.unitId}
                onValueChange={(value) =>
                  setFilters((current) => ({ ...current, unitId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {activeOperationalUnits(units).map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={filters.statusGroup}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    statusGroup: value as AnalyticsDashboardFilters["statusGroup"],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="open">Abertas</SelectItem>
                  <SelectItem value="resolved">Resolvidas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ListChecks className="h-4 w-4" />
                Avaliações
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {cards ? cards.evaluations : "—"}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                Não conformidades
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {cards ? cards.non_conformities : "—"}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ClipboardList className="h-4 w-4" />
                Ocorrências abertas
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {cards ? cards.open_occurrences : "—"}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                Conformidade das avaliações
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Esta taxa considera cada quesito avaliado como uma
                      avaliação. Formulários com mais quesitos têm maior peso no
                      indicador. Para comparação fina, use a taxa por domínio,
                      quesito ou unidade.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <p className="mt-2 text-2xl font-semibold">{conformityLabel}</p>
              {cardsSource === "daily" ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  via agregados diários
                </p>
              ) : null}
            </div>
          </div>

          {extended ? (
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <MiniMetric label="Resolvidas" value={extended.resolved_occurrences} />
              <MiniMetric
                label="Tempo médio de resolução"
                value={avgResolutionLabel}
              />
              <MiniMetric
                label="Vencidas (SLA)"
                value={extended.overdue_occurrences}
                tone={extended.overdue_occurrences > 0 ? "danger" : "default"}
              />
              <MiniMetric
                label="Pendentes de validação"
                value={extended.pending_validation}
              />
              <MiniMetric
                label="Abertas sem tarefa"
                value={extended.open_without_task}
                tone={extended.open_without_task > 0 ? "warn" : "default"}
              />
              <MiniMetric
                label="Tarefa cancelada"
                value={extended.open_with_cancelled_task}
                tone={extended.open_with_cancelled_task > 0 ? "warn" : "default"}
              />
            </div>
          ) : null}

          {recurrence.length > 0 || brandRanking.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {recurrence.length > 0 ? (
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">
                    Reincidência por alvo (2+ ocorrências no período)
                  </p>
                  <div className="mt-3 space-y-2">
                    {recurrence.map((row) => (
                      <div
                        key={row.target_identity_key}
                        className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm"
                      >
                        <span className="truncate">{row.target_name_snapshot}</span>
                        <Badge variant="destructive">{row.occurrences}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {brandRanking.length > 0 ? (
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">
                    Não conformidades por marca/modelo
                  </p>
                  <div className="mt-3 space-y-2">
                    {brandRanking.map((row) => (
                      <div
                        key={row.brand}
                        className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm"
                      >
                        <span className="truncate">{row.brand}</span>
                        <Badge variant="secondary">{row.non_conformities}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-lg border p-4 xl:col-span-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Ranking de não conformidades</p>
                <Select
                  value={rankingGroupBy}
                  onValueChange={(value) =>
                    setRankingGroupBy(value as "criterion" | "target")
                  }
                >
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="criterion">Por quesito</SelectItem>
                    <SelectItem value="target">Por alvo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-3 space-y-2">
                {ranking.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Sem não conformidades no período.
                  </p>
                ) : (
                  ranking.map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm"
                    >
                      <span className="truncate">{row.label}</span>
                      <Badge variant="secondary">{row.non_conformities}</Badge>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg border xl:col-span-2">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <p className="text-sm font-semibold">Ocorrências</p>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : null}
              </div>
              <div className="max-h-[28rem] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Domínio · Quesito</TableHead>
                      <TableHead>Alvo</TableHead>
                      <TableHead>Resultado</TableHead>
                      <TableHead>Status</TableHead>
                      {canResolve || canValidate ? (
                        <TableHead className="text-right">Ações</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          Nenhuma ocorrência no período.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((row) => {
                        const busy = actionBusyId === row.id;
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="whitespace-nowrap text-xs">
                              {row.occurred_local_date}
                            </TableCell>
                            <TableCell className="text-xs">
                              <span className="font-medium">
                                {row.domain_name_snapshot}
                              </span>
                              {row.criterion_name_snapshot ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  · {row.criterion_name_snapshot}
                                </span>
                              ) : null}
                              {row.severity ? (
                                <span className="ml-1 text-muted-foreground">
                                  ({SEVERITY_LABELS[row.severity] ?? row.severity})
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-xs">
                              {row.target_name_snapshot}
                              {row.unit_name_snapshot ? (
                                <span className="block text-muted-foreground">
                                  {row.unit_name_snapshot}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-xs">
                              {row.result_name_snapshot}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusBadgeVariant(row.resolution_status)}>
                                {STATUS_LABELS[row.resolution_status] ??
                                  row.resolution_status}
                              </Badge>
                            </TableCell>
                            {canResolve || canValidate ? (
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  {canResolve &&
                                  OPEN_STATUSES.has(row.resolution_status) ? (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={busy}
                                        onClick={() => runAction(row, "resolve")}
                                      >
                                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                        Resolver
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() => runAction(row, "cancel")}
                                      >
                                        Cancelar
                                      </Button>
                                    </>
                                  ) : null}
                                  {canValidate &&
                                  row.resolution_status === "pending_validation" ? (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={busy}
                                        onClick={() => runAction(row, "validate")}
                                      >
                                        Validar
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() => {
                                          setRejectTarget(row);
                                          setRejectReason("");
                                        }}
                                      >
                                        Rejeitar
                                      </Button>
                                    </>
                                  ) : null}
                                </div>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              {nextCursor ? (
                <div className="border-t px-4 py-3 text-center">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    {loadingMore ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Carregar mais
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rejeitar resolução</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Motivo da rejeição</Label>
            <Textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Descreva o que ainda precisa ser tratado"
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Uma tarefa de follow-up será criada automaticamente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>
              Voltar
            </Button>
            <Button
              disabled={!rejectReason.trim() || actionBusyId === rejectTarget?.id}
              onClick={() => void submitRejection()}
            >
              Rejeitar e reabrir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
