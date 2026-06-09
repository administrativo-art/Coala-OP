"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  ListOrdered,
  Loader2,
  Target,
} from "lucide-react";

import { fetchMyFormExecutions } from "@/features/forms/lib/client";
import { useAuth } from "@/hooks/use-auth";
import type { FormExecution } from "@/types/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const STATUS_LABELS: Record<FormExecution["status"], string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  completed: "Concluído",
  overdue: "Atrasado",
  canceled: "Cancelado",
};

const STATUS_CLASS: Record<FormExecution["status"], string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  in_progress: "border-blue-200 bg-blue-50 text-blue-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  overdue: "border-red-200 bg-red-50 text-red-700",
  canceled: "border-slate-200 bg-slate-100 text-slate-600",
};

function formatDateTime(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function SummaryTile({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function FormExecutionRow({ execution }: { execution: FormExecution }) {
  return (
    <Link href={`/dashboard/forms/${execution.id}/view`} className="block">
      <div className="rounded-xl border p-4 transition-colors hover:bg-muted/40">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{execution.template_name}</p>
              <Badge className={STATUS_CLASS[execution.status]}>{STATUS_LABELS[execution.status]}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {execution.unit_name ?? execution.unit_id}
              {execution.shift_definition_name ? ` · ${execution.shift_definition_name}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground md:text-right">
            <Clock className="h-3.5 w-3.5" />
            {formatDateTime(execution.due_at)}
          </div>
        </div>
      </div>
    </Link>
  );
}

function RoutineCard({
  title,
  description,
  icon,
  badge,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="h-full text-left">
          <Card className="h-full border-muted/50 shadow-sm transition-all hover:border-primary/20 hover:shadow-md">
            <CardContent className="flex h-full flex-col gap-4 p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/10 p-3 text-primary">{icon}</div>
                <div className="min-w-0">
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between">
                <Badge variant="secondary">{badge}</Badge>
                <span className="inline-flex items-center text-sm font-medium">
                  Abrir resumo
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </span>
              </div>
            </CardContent>
          </Card>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-3xl">
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function CollaboratorDashboardPanel() {
  const { firebaseUser, permissions } = useAuth();
  const [executions, setExecutions] = useState<FormExecution[]>([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [formsError, setFormsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) {
        setLoadingForms(false);
        return;
      }

      try {
        setLoadingForms(true);
        setFormsError(null);
        const payload = await fetchMyFormExecutions(firebaseUser);
        if (!cancelled) setExecutions(payload.executions);
      } catch (error) {
        if (!cancelled) {
          setFormsError(error instanceof Error ? error.message : "Falha ao carregar formulários.");
        }
      } finally {
        if (!cancelled) setLoadingForms(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  const groups = useMemo(
    () => ({
      pending: executions.filter((execution) => execution.status === "pending" || execution.status === "overdue"),
      inProgress: executions.filter((execution) => execution.status === "in_progress"),
      completed: executions.filter((execution) => execution.status === "completed"),
    }),
    [executions]
  );

  const canOpenStockCount = !!(permissions.stock?.stockCount?.view || permissions.stock?.stockCount?.perform);
  const canOpenSchedule = !!permissions.dp?.schedules?.view;
  const canOpenGoals = !!permissions.goals?.view;

  return (
    <section id="painel-colaborador" className="scroll-mt-6 space-y-4">
      <div className="flex flex-col gap-2 border-b border-border/50 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            Painel do colaborador
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Rotinas do dia</h2>
          <p className="text-sm text-muted-foreground">
            Formulários, contagem, escala e metas resolvidos neste painel, sem depender da navegação completa dos módulos.
          </p>
        </div>
      </div>

      <Card className="border-muted/50 shadow-sm">
        <CardHeader className="border-b border-muted/30 pb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-primary" />
                Formulários a preencher
              </CardTitle>
              <CardDescription>Pendentes e atrasados atribuídos ao colaborador.</CardDescription>
            </div>
            <Badge className={groups.pending.length > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
              {groups.pending.length} pendente(s)
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {loadingForms ? (
            <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando formulários...
            </div>
          ) : formsError ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              {formsError}
            </div>
          ) : groups.pending.length === 0 ? (
            <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" />
              Nenhum formulário pendente agora.
            </div>
          ) : (
            <div className="space-y-3">
              {groups.pending.slice(0, 3).map((execution) => (
                <FormExecutionRow key={execution.id} execution={execution} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <RoutineCard
          title="Contagem"
          description="Resumo da rotina de contagem do colaborador."
          icon={<ListOrdered className="h-5 w-5" />}
          badge={canOpenStockCount ? "Disponível" : "Resumo"}
        >
          <DialogHeader>
            <DialogTitle>Contagem de estoque</DialogTitle>
            <DialogDescription>Entrada rápida para executar ou acompanhar a contagem operacional.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2 md:grid-cols-3">
            <SummaryTile label="Status" value={canOpenStockCount ? "Liberada" : "Sem acesso direto"} />
            <SummaryTile label="Sessões" value="Painel" />
            <SummaryTile label="Ação" value="Contar" />
          </div>
          <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            A contagem aparece aqui como rotina do colaborador. Quando houver uma sessão direcionada para ele, este card deve priorizar essa sessão antes de abrir o módulo completo.
          </div>
          <div className="flex justify-end">
            <Button asChild disabled={!canOpenStockCount}>
              <Link href="/dashboard/stock/count">Abrir contagem</Link>
            </Button>
          </div>
        </RoutineCard>

        <RoutineCard
          title="Minha escala"
          description="Resumo de turnos e período atual."
          icon={<CalendarDays className="h-5 w-5" />}
          badge={canOpenSchedule ? "Disponível" : "Resumo"}
        >
          <DialogHeader>
            <DialogTitle>Minha escala</DialogTitle>
            <DialogDescription>Resumo operacional da escala do colaborador.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2 md:grid-cols-3">
            <SummaryTile label="Hoje" value="A conferir" />
            <SummaryTile label="Unidade" value="Vinculada" />
            <SummaryTile label="Próximo turno" value="Resumo" />
          </div>
          <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            Este modal fica reservado para mostrar a escala do próprio colaborador, mesmo quando ele não puder acessar o módulo gerencial de escalas.
          </div>
          <div className="flex justify-end">
            <Button asChild disabled={!canOpenSchedule}>
              <Link href="/dashboard/dp/schedules">Abrir escala completa</Link>
            </Button>
          </div>
        </RoutineCard>

        <RoutineCard
          title="Metas"
          description="Resumo das metas vinculadas ao colaborador."
          icon={<Target className="h-5 w-5" />}
          badge={canOpenGoals ? "Disponível" : "Resumo"}
        >
          <DialogHeader>
            <DialogTitle>Minhas metas</DialogTitle>
            <DialogDescription>Resumo das metas operacionais associadas ao usuário.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2 md:grid-cols-3">
            <SummaryTile label="Meta atual" value="A conferir" />
            <SummaryTile label="Progresso" value="Resumo" />
            <SummaryTile label="Período" value="Atual" />
          </div>
          <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            Este modal concentra a leitura de metas do colaborador. O acesso ao painel gerencial continua separado por permissão.
          </div>
          <div className="flex justify-end">
            <Button asChild disabled={!canOpenGoals}>
              <Link href="/dashboard/goals/tracking">Abrir metas completas</Link>
            </Button>
          </div>
        </RoutineCard>
      </div>
    </section>
  );
}
