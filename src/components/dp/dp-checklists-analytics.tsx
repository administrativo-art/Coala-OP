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
  Settings2,
  ShieldAlert,
  Users,
  Wrench,
} from "lucide-react";

import type { DPChecklistTemplate, DPChecklistType, DPUnit } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchDPChecklistAnalytics,
  type DPChecklistAnalyticsPayload,
} from "@/features/dp-checklists/lib/client";
import { cn } from "@/lib/utils";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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

function formatSparkline(values: number[], size = 6) {
  const series = values.slice(-size);
  if (series.length === 0) return Array.from({ length: size }, () => 24);
  const max = Math.max(...series, 1);
  return series.map((value) => Math.max(24, Math.round((value / max) * 100)));
}

function formatTrend(current: number, previous: number, suffix = "") {
  const delta = Number((current - previous).toFixed(1));
  if (delta > 0) return { label: `▲ +${delta}${suffix}`, tone: "up" as const };
  if (delta < 0) return { label: `▼ ${delta}${suffix}`, tone: "down" as const };
  return { label: "→ estável", tone: "neutral" as const };
}

function AnalyticsMetricCard({
  label,
  value,
  tone,
  trend,
  sparkline,
}: {
  label: string;
  value: string;
  tone: "emerald" | "amber" | "red" | "blue";
  trend: { label: string; tone: "up" | "down" | "neutral" };
  sparkline: number[];
}) {
  const toneClasses = {
    emerald: {
      value: "text-emerald-700",
      border: "before:bg-emerald-500",
      bar: "bg-emerald-500/90",
    },
    amber: {
      value: "text-amber-700",
      border: "before:bg-amber-500",
      bar: "bg-amber-500/90",
    },
    red: {
      value: "text-red-700",
      border: "before:bg-red-500",
      bar: "bg-red-500/90",
    },
    blue: {
      value: "text-blue-700",
      border: "before:bg-blue-500",
      bar: "bg-blue-500/90",
    },
  } as const;

  return (
    <Card
      className={cn(
        "relative overflow-hidden before:absolute before:bottom-0 before:left-0 before:right-0 before:h-1",
        toneClasses[tone].border
      )}
    >
      <CardContent className="space-y-3 p-5">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={cn("text-3xl font-semibold tracking-tight", toneClasses[tone].value)}>
            {value}
          </p>
        </div>
        <p
          className={cn(
            "text-xs font-medium",
            trend.tone === "up"
              ? "text-emerald-700"
              : trend.tone === "down"
                ? "text-red-700"
                : "text-muted-foreground"
          )}
        >
          {trend.label}
        </p>
        <div className="flex h-8 items-end gap-1">
          {sparkline.map((height, index) => (
            <div
              key={`${label}-${index}`}
              className={cn("flex-1 rounded-t-sm", toneClasses[tone].bar)}
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type KpiWidgetId = "kpi_completion" | "kpi_score" | "kpi_overdue" | "kpi_volume" | "kpi_pending" | "kpi_tasks";
type SectionWidgetId = "section_daily" | "section_overdue_list" | "section_by_unit" | "section_by_template" | "section_by_user" | "section_audit" | "section_conformidade";

const KPI_WIDGET_META: Record<KpiWidgetId, { label: string; description: string }> = {
  kpi_completion: { label: "Taxa de conclusão", description: "% de execuções concluídas no período" },
  kpi_score: { label: "Score médio", description: "Pontuação média das execuções" },
  kpi_overdue: { label: "Atrasados", description: "Execuções em atraso" },
  kpi_volume: { label: "Total", description: "Total de execuções no período" },
  kpi_pending: { label: "Pendentes", description: "Execuções ainda não iniciadas" },
  kpi_tasks: { label: "Tarefas abertas", description: "Tarefas operacionais em aberto" },
};

const SECTION_WIDGET_META: Record<SectionWidgetId, { label: string; description: string }> = {
  section_daily: { label: "Tendência diária", description: "Gráfico de barras por dia" },
  section_overdue_list: { label: "Execuções em atraso", description: "Lista detalhada dos atrasados" },
  section_by_unit: { label: "Por unidade", description: "Ranking de unidades" },
  section_by_template: { label: "Por template", description: "Volume por template" },
  section_by_user: { label: "Por colaborador", description: "Ranking de usuários" },
  section_audit: { label: "Alertas de auditoria", description: "Unidades abaixo do threshold" },
  section_conformidade: { label: "Conformidade", description: "Taxa de conclusão por unidade, template e dia da semana" },
};

const DEFAULT_KPIS: KpiWidgetId[] = ["kpi_completion", "kpi_score", "kpi_overdue", "kpi_tasks"];
const DEFAULT_SECTIONS: SectionWidgetId[] = ["section_daily", "section_overdue_list", "section_by_unit", "section_by_template", "section_by_user", "section_audit", "section_conformidade"];
const LS_KEY = "checklist-analytics-config";

type AnalyticsConfig = { kpis: KpiWidgetId[]; sections: SectionWidgetId[] };

function loadAnalyticsConfig(): AnalyticsConfig {
  if (typeof window === "undefined") return { kpis: DEFAULT_KPIS, sections: DEFAULT_SECTIONS };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AnalyticsConfig>;
      return {
        kpis: Array.isArray(parsed.kpis) && parsed.kpis.length > 0 ? parsed.kpis : DEFAULT_KPIS,
        sections: Array.isArray(parsed.sections) ? parsed.sections : DEFAULT_SECTIONS,
      };
    }
  } catch { /* ignore */ }
  return { kpis: DEFAULT_KPIS, sections: DEFAULT_SECTIONS };
}

function saveAnalyticsConfig(config: AnalyticsConfig) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(config)); } catch { /* ignore */ }
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function conformanceColor(pct: number) {
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 60) return "bg-amber-400";
  return "bg-red-500";
}

function HorizontalConformanceBar({
  label,
  pct,
  total,
}: {
  label: string;
  pct: number;
  total: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate max-w-[180px] text-muted-foreground">{label}</span>
        <span className="shrink-0 font-medium">{formatPercent(pct)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn("h-full rounded-full transition-all", conformanceColor(pct))}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
          <div
            className="absolute inset-y-0 border-r-2 border-dashed border-slate-400"
            style={{ left: "80%" }}
          />
        </div>
        <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">
          {total} exec.
        </span>
      </div>
    </div>
  );
}

function ConformidadeSection({
  byUnit,
  byTemplate,
  dailyTrend,
}: {
  byUnit: Array<{ unitId: string; unitName: string; totalExecutions: number; completedExecutions: number }>;
  byTemplate: Array<{ templateId: string; templateName: string; totalExecutions: number; completedExecutions: number }>;
  dailyTrend: Array<{ date: string; totalExecutions: number; completedExecutions: number }>;
}) {
  const unitConformance = byUnit
    .filter((u) => u.totalExecutions > 0)
    .map((u) => ({
      id: u.unitId,
      label: u.unitName,
      pct: (u.completedExecutions / u.totalExecutions) * 100,
      total: u.totalExecutions,
    }))
    .sort((a, b) => b.pct - a.pct);

  const templateConformance = byTemplate
    .filter((t) => t.totalExecutions > 0)
    .map((t) => ({
      id: t.templateId,
      label: t.templateName,
      pct: (t.completedExecutions / t.totalExecutions) * 100,
      total: t.totalExecutions,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const weekdayAgg = Array.from({ length: 7 }, (_, i) => ({
    day: i,
    total: 0,
    completed: 0,
  }));
  for (const entry of dailyTrend) {
    try {
      const dow = new Date(entry.date).getDay();
      weekdayAgg[dow].total += entry.totalExecutions;
      weekdayAgg[dow].completed += entry.completedExecutions;
    } catch { /* skip */ }
  }
  const maxWeekdayTotal = Math.max(...weekdayAgg.map((w) => w.total), 1);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conformidade por unidade</CardTitle>
            <CardDescription>
              % de execuções concluídas — linha tracejada em 80%.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {unitConformance.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Sem dados de unidade no período.
              </p>
            ) : (
              unitConformance.map((u) => (
                <HorizontalConformanceBar
                  key={u.id}
                  label={u.label}
                  pct={u.pct}
                  total={u.total}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conformidade por template</CardTitle>
            <CardDescription>
              Top 10 por volume — % concluídas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {templateConformance.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Sem dados de template no período.
              </p>
            ) : (
              templateConformance.map((t) => (
                <HorizontalConformanceBar
                  key={t.id}
                  label={t.label}
                  pct={t.pct}
                  total={t.total}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conformidade por dia da semana</CardTitle>
          <CardDescription>
            Média histórica de conclusões por dia da semana no período filtrado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-around gap-2 h-36">
            {weekdayAgg.map((w) => {
              const barHeight = maxWeekdayTotal > 0
                ? Math.max(8, Math.round((w.total / maxWeekdayTotal) * 100))
                : 8;
              const pct = w.total > 0 ? (w.completed / w.total) * 100 : 0;
              return (
                <div key={w.day} className="flex flex-1 flex-col items-center gap-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {w.total > 0 ? formatPercent(pct) : "—"}
                  </p>
                  <div className="w-full max-w-[44px] overflow-hidden rounded-t-lg bg-slate-100" style={{ height: `${barHeight}%` }}>
                    <div
                      className={cn("w-full rounded-t-lg transition-all", conformanceColor(pct))}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs font-semibold">{WEEKDAY_LABELS[w.day]}</p>
                  <p className="text-[10px] text-muted-foreground">{w.total} exec.</p>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              ≥ 80% — bom
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              60–79% — atenção
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              &lt; 60% — crítico
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function DPChecklistsAnalytics({
  units,
  templates,
  checklistTypes = [],
}: {
  units: DPUnit[];
  templates: DPChecklistTemplate[];
  checklistTypes?: DPChecklistType[];
}) {
  const { firebaseUser } = useAuth();
  const [dateFrom, setDateFrom] = React.useState(
    toDateInputValue(addDays(new Date(), -30))
  );
  const [dateTo, setDateTo] = React.useState(toDateInputValue(new Date()));
  const [selectedUnitId, setSelectedUnitId] = React.useState("all");
  const [selectedTemplateId, setSelectedTemplateId] = React.useState("all");
  const [selectedTypeId, setSelectedTypeId] = React.useState("all");
  const [selectedStatus, setSelectedStatus] = React.useState<
    "all" | "pending" | "claimed" | "completed" | "overdue"
  >("all");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [payload, setPayload] = React.useState<DPChecklistAnalyticsPayload | null>(null);
  const [widgetConfig, setWidgetConfig] = React.useState<AnalyticsConfig>(loadAnalyticsConfig);
  const [configOpen, setConfigOpen] = React.useState(false);

  function hasKpi(id: KpiWidgetId) { return widgetConfig.kpis.includes(id); }
  function hasSection(id: SectionWidgetId) { return widgetConfig.sections.includes(id); }

  function toggleKpi(id: KpiWidgetId) {
    setWidgetConfig((prev) => {
      const next = prev.kpis.includes(id)
        ? prev.kpis.filter((k) => k !== id)
        : [...prev.kpis, id];
      const updated = { ...prev, kpis: next.length > 0 ? next : prev.kpis };
      saveAnalyticsConfig(updated);
      return updated;
    });
  }

  function toggleSection(id: SectionWidgetId) {
    setWidgetConfig((prev) => {
      const next = prev.sections.includes(id)
        ? prev.sections.filter((s) => s !== id)
        : [...prev.sections, id];
      const updated = { ...prev, sections: next };
      saveAnalyticsConfig(updated);
      return updated;
    });
  }

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
        typeId: selectedTypeId !== "all" ? selectedTypeId : undefined,
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
  const analyticsOverview = React.useMemo(() => {
    if (!payload || !summary) return null;

    const midpoint = Math.max(1, Math.floor(payload.dailyTrend.length / 2));
    const firstSlice = payload.dailyTrend.slice(0, midpoint);
    const secondSlice = payload.dailyTrend.slice(midpoint);

    const average = (values: number[]) =>
      values.length > 0
        ? values.reduce((sum, item) => sum + item, 0) / values.length
        : 0;

    const completionSeries = payload.dailyTrend.map((item) =>
      item.totalExecutions > 0
        ? (item.completedExecutions / item.totalExecutions) * 100
        : 0
    );
    const scoreSeries = payload.dailyTrend.map((item) => item.averageScore);
    const overdueSeries = payload.dailyTrend.map((item) => item.overdueExecutions);
    const volumeSeries = payload.dailyTrend.map((item) => item.totalExecutions);

    return {
      completionTrend: formatTrend(
        average(secondSlice.map((item) =>
          item.totalExecutions > 0
            ? (item.completedExecutions / item.totalExecutions) * 100
            : 0
        )),
        average(firstSlice.map((item) =>
          item.totalExecutions > 0
            ? (item.completedExecutions / item.totalExecutions) * 100
            : 0
        )),
        "pp"
      ),
      scoreTrend: formatTrend(
        average(secondSlice.map((item) => item.averageScore)),
        average(firstSlice.map((item) => item.averageScore)),
        "pp"
      ),
      overdueTrend: formatTrend(
        average(secondSlice.map((item) => item.overdueExecutions)),
        average(firstSlice.map((item) => item.overdueExecutions))
      ),
      alertTrend: formatTrend(
        summary.openOperationalTasks +
          summary.inProgressOperationalTasks +
          summary.escalatedOperationalTasks,
        Math.max(0, summary.openOperationalTasks)
      ),
      completionSparkline: formatSparkline(completionSeries),
      scoreSparkline: formatSparkline(scoreSeries),
      overdueSparkline: formatSparkline(overdueSeries),
      volumeSparkline: formatSparkline(volumeSeries),
      maxDailyVolume: Math.max(...volumeSeries, 1),
    };
  }, [payload, summary]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Painel gerencial
              </CardTitle>
              <CardDescription className="mt-1">
                Score médio, atrasos e agregados dos checklists gerados no período.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setConfigOpen(true)}
            >
              <Settings2 className="mr-1.5 h-4 w-4" />
              Configurar widgets
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
        {checklistTypes.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedTypeId("all")}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                selectedTypeId === "all"
                  ? "border-indigo-300 bg-indigo-600 text-white"
                  : "border-border bg-card hover:bg-muted"
              )}
            >
              Todos os tipos
            </button>
            {checklistTypes.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTypeId(t.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  selectedTypeId === t.id
                    ? "border-indigo-300 bg-indigo-600 text-white"
                    : "border-border bg-card hover:bg-muted"
                )}
              >
                {t.emoji ? `${t.emoji} ` : ""}{t.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[220px_220px_220px_220px_minmax(0,1fr)]">
          <div className="space-y-2">
            <label className="text-sm font-medium">Data inicial</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className={cn(dateFrom !== toDateInputValue(addDays(new Date(), -30)) && "border-indigo-200 bg-indigo-50 text-indigo-700")}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Data final</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className={cn(dateTo !== toDateInputValue(new Date()) && "border-indigo-200 bg-indigo-50 text-indigo-700")}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Unidade</label>
            <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
              <SelectTrigger className={cn(selectedUnitId !== "all" && "border-indigo-200 bg-indigo-50 text-indigo-700")}>
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
              <SelectTrigger className={cn(selectedTemplateId !== "all" && "border-indigo-200 bg-indigo-50 text-indigo-700")}>
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
                <SelectTrigger className={cn(selectedStatus !== "all" && "border-indigo-200 bg-indigo-50 text-indigo-700")}>
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
          {widgetConfig.kpis.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {hasKpi("kpi_completion") ? (
              <AnalyticsMetricCard
                label="Taxa de conclusão"
                value={formatPercent(summary.completionRate)}
                tone="emerald"
                trend={analyticsOverview?.completionTrend ?? { label: "→ estável", tone: "neutral" }}
                sparkline={analyticsOverview?.completionSparkline ?? formatSparkline([])}
              />
            ) : null}
            {hasKpi("kpi_score") ? (
              <AnalyticsMetricCard
                label="Score médio"
                value={formatPercent(summary.averageScore)}
                tone="amber"
                trend={analyticsOverview?.scoreTrend ?? { label: "→ estável", tone: "neutral" }}
                sparkline={analyticsOverview?.scoreSparkline ?? formatSparkline([])}
              />
            ) : null}
            {hasKpi("kpi_overdue") ? (
              <AnalyticsMetricCard
                label="Atrasados"
                value={String(summary.overdueExecutions)}
                tone="red"
                trend={analyticsOverview?.overdueTrend ?? { label: "→ estável", tone: "neutral" }}
                sparkline={analyticsOverview?.overdueSparkline ?? formatSparkline([])}
              />
            ) : null}
            {hasKpi("kpi_tasks") ? (
              <AnalyticsMetricCard
                label="Tarefas abertas"
                value={String(
                  summary.openOperationalTasks +
                    summary.inProgressOperationalTasks +
                    summary.escalatedOperationalTasks
                )}
                tone="blue"
                trend={analyticsOverview?.alertTrend ?? { label: "→ estável", tone: "neutral" }}
                sparkline={analyticsOverview?.volumeSparkline ?? formatSparkline([])}
              />
            ) : null}
            {hasKpi("kpi_volume") ? (
              <AnalyticsMetricCard
                label="Total de execuções"
                value={String(summary.totalExecutions)}
                tone="blue"
                trend={{ label: "→ período atual", tone: "neutral" }}
                sparkline={analyticsOverview?.volumeSparkline ?? formatSparkline([])}
              />
            ) : null}
            {hasKpi("kpi_pending") ? (
              <AnalyticsMetricCard
                label="Pendentes"
                value={String(summary.pendingExecutions)}
                tone="amber"
                trend={{ label: "→ aguardando início", tone: "neutral" }}
                sparkline={formatSparkline([])}
              />
            ) : null}
          </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              <ClipboardList className="mr-1.5 h-3.5 w-3.5" />
              {summary.totalExecutions} execuções
            </Badge>
            <Badge variant="secondary">
              <Users className="mr-1.5 h-3.5 w-3.5" />
              {summary.uniqueUsers} colaboradores
            </Badge>
            <Badge variant="secondary">
              <Wrench className="mr-1.5 h-3.5 w-3.5" />
              {summary.openOperationalTasks + summary.inProgressOperationalTasks} tarefas em curso
            </Badge>
            <Badge variant="secondary">
              <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
              {summary.criticalAlerts} alertas críticos
            </Badge>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            {hasSection("section_overdue_list") ? (
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
            ) : null}

            {hasSection("section_by_unit") || hasSection("section_by_template") ? (
            <div className="grid gap-4">
              {hasSection("section_by_unit") ? (
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
              ) : null}

              {hasSection("section_by_template") ? (
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
              ) : null}
            </div>
            ) : null}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {hasSection("section_daily") ? (
            <Card>
              <CardHeader>
                <CardTitle>Tendência diária</CardTitle>
                <CardDescription>
                  Evolução de volume por dia, com total visível em cada barra.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-7 gap-3">
                    {payload.dailyTrend.map((item) => {
                      const totalHeight =
                        analyticsOverview && analyticsOverview.maxDailyVolume > 0
                          ? Math.max(
                              20,
                              Math.round(
                                (item.totalExecutions / analyticsOverview.maxDailyVolume) * 100
                              )
                            )
                          : 20;
                      const completedHeight =
                        item.totalExecutions > 0
                          ? Math.max(
                              8,
                              Math.round(
                                (item.completedExecutions / item.totalExecutions) * totalHeight
                              )
                            )
                          : 0;
                      const overdueHeight =
                        item.totalExecutions > 0
                          ? Math.max(
                              item.overdueExecutions > 0 ? 6 : 0,
                              Math.round(
                                (item.overdueExecutions / item.totalExecutions) * totalHeight
                              )
                            )
                          : 0;

                      return (
                        <div key={item.date} className="space-y-2 text-center">
                          <p className="text-xs font-semibold text-foreground">
                            {item.totalExecutions}
                          </p>
                          <div className="flex h-44 items-end justify-center">
                            <div className="flex w-full max-w-[44px] flex-col overflow-hidden rounded-t-xl bg-slate-100">
                              <div
                                className="w-full bg-red-200"
                                style={{ height: `${overdueHeight}%` }}
                              />
                              <div
                                className="w-full bg-emerald-200"
                                style={{
                                  height: `${Math.max(
                                    totalHeight - overdueHeight,
                                    completedHeight
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs font-medium">{formatDateLabel(item.date)}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {item.completedExecutions} concluídos • {item.overdueExecutions} atrasos
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                      Concluídos
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-red-200" />
                      Atrasados
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            ) : null}

            {hasSection("section_by_user") ? (
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
            ) : null}
          </div>

          {hasSection("section_conformidade") ? (
          <ConformidadeSection
            byUnit={payload.byUnit}
            byTemplate={payload.byTemplate}
            dailyTrend={payload.dailyTrend}
          />
          ) : null}

          {hasSection("section_audit") ? (
          <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5" />
                  Alertas de auditoria
                </CardTitle>
                <CardDescription>
                  Unidades com score médio de auditoria abaixo do threshold configurado.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {payload.audit.alerts.length === 0 ? (
                  <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhuma unidade abaixo do threshold de auditoria no período.
                  </div>
                ) : (
                  payload.audit.alerts.map((alert) => (
                    <div
                      key={alert.unitId}
                      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{alert.unitName}</p>
                          <p className="text-xs opacity-80">
                            {alert.totalExecutions} auditorias • threshold {formatPercent(alert.threshold)}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className="border-red-300 bg-white/70 text-red-700 dark:border-red-800 dark:bg-transparent dark:text-red-300"
                        >
                          {formatPercent(alert.averageScore)}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ranking de auditoria por unidade</CardTitle>
                <CardDescription>
                  Score médio separado das auditorias no período filtrado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Auditorias</TableHead>
                      <TableHead>Threshold</TableHead>
                      <TableHead>Score médio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payload.audit.byUnit.map((item) => (
                      <TableRow key={item.unitId}>
                        <TableCell>{item.unitName}</TableCell>
                        <TableCell>{item.totalExecutions}</TableCell>
                        <TableCell>{formatPercent(item.threshold)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={item.belowThreshold ? "destructive" : "secondary"}
                          >
                            {formatPercent(item.averageScore)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Evolução mensal de auditoria</CardTitle>
              <CardDescription>
                Tendência mensal por unidade considerando apenas templates do tipo audit.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mês</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Auditorias</TableHead>
                    <TableHead>Score médio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.audit.monthlyTrend.map((item) => (
                    <TableRow key={`${item.month}-${item.unitId}`}>
                      <TableCell>{item.month}</TableCell>
                      <TableCell>{item.unitName}</TableCell>
                      <TableCell>{item.totalExecutions}</TableCell>
                      <TableCell>{formatPercent(item.averageScore)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          </>
          ) : null}
        </>
      ) : null}

      <Sheet open={configOpen} onOpenChange={setConfigOpen}>
        <SheetContent className="w-[360px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Configurar widgets</SheetTitle>
            <SheetDescription>
              Escolha quais indicadores e seções exibir no painel.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            <div className="space-y-3">
              <p className="text-sm font-semibold">Indicadores (KPIs)</p>
              {(Object.keys(KPI_WIDGET_META) as KpiWidgetId[]).map((id) => (
                <div key={id} className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor={`kpi-${id}`} className="font-medium">
                      {KPI_WIDGET_META[id].label}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {KPI_WIDGET_META[id].description}
                    </p>
                  </div>
                  <Switch
                    id={`kpi-${id}`}
                    checked={hasKpi(id)}
                    onCheckedChange={() => toggleKpi(id)}
                  />
                </div>
              ))}
            </div>
            <div className="h-px bg-border" />
            <div className="space-y-3">
              <p className="text-sm font-semibold">Seções</p>
              {(Object.keys(SECTION_WIDGET_META) as SectionWidgetId[]).map((id) => (
                <div key={id} className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor={`section-${id}`} className="font-medium">
                      {SECTION_WIDGET_META[id].label}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {SECTION_WIDGET_META[id].description}
                    </p>
                  </div>
                  <Switch
                    id={`section-${id}`}
                    checked={hasSection(id)}
                    onCheckedChange={() => toggleSection(id)}
                  />
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
