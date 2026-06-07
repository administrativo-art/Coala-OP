"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock, ClipboardCheck, FileText, Loader2 } from "lucide-react";

import type { FormExecution } from "@/types/forms";
import { fetchMyFormExecutions } from "@/features/forms/lib/client";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

function ExecutionCard({ execution }: { execution: FormExecution }) {
  return (
    <Link href={`/dashboard/forms/${execution.id}/view`}>
      <div className="rounded-xl border p-4 transition-colors hover:bg-muted/40">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{execution.template_name}</p>
              <Badge className={STATUS_CLASS[execution.status]}>{STATUS_LABELS[execution.status]}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {execution.unit_name ?? execution.unit_id}
              {execution.shift_definition_name ? ` · ${execution.shift_definition_name}` : ""}
            </p>
          </div>
          <div className="text-xs text-muted-foreground md:text-right">
            <p>Previsto: {execution.scheduled_for ?? "-"}</p>
            <p>Prazo: {formatDateTime(execution.due_at)}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function MyFormsShell() {
  const { firebaseUser } = useAuth();
  const [executions, setExecutions] = useState<FormExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const payload = await fetchMyFormExecutions(firebaseUser);
        if (!cancelled) setExecutions(payload.executions);
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Falha ao carregar formulários.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  const groups = useMemo(() => {
    return {
      pending: executions.filter((execution) => execution.status === "pending" || execution.status === "overdue"),
      inProgress: executions.filter((execution) => execution.status === "in_progress"),
      completed: executions.filter((execution) => execution.status === "completed"),
    };
  }, [executions]);

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando formulários...
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Meus formulários</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Meus formulários</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Preenchimentos atribuídos a você, organizados por prioridade operacional.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pendentes</p>
            <p className="mt-2 text-3xl font-semibold">{groups.pending.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Em andamento</p>
            <p className="mt-2 text-3xl font-semibold">{groups.inProgress.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Concluídos</p>
            <p className="mt-2 text-3xl font-semibold">{groups.completed.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Para responder
            </CardTitle>
            <CardDescription>Pendentes e atrasados aparecem primeiro.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {groups.pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum formulário pendente.</p>
            ) : (
              groups.pending.map((execution) => <ExecutionCard key={execution.id} execution={execution} />)
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Em andamento e concluídos
            </CardTitle>
            <CardDescription>Continue preenchimentos iniciados ou consulte os finalizados.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[...groups.inProgress, ...groups.completed].length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum histórico recente.</p>
            ) : (
              [...groups.inProgress, ...groups.completed].map((execution) => (
                <ExecutionCard key={execution.id} execution={execution} />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Button variant="outline" asChild>
        <Link href="/dashboard/forms">Ver painel de formulários</Link>
      </Button>
    </div>
  );
}
