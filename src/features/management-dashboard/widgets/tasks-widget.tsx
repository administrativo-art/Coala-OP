"use client";

import { cn } from "@/lib/utils";

import { widgetIcons } from "./icons";
import { IconChip, KpiTile, Pill, WidgetCard, WidgetEmpty, WidgetHead, type Tone } from "./kit";

export type TaskItem = { id: string; title: string; statusLabel: string; dueLabel: string; overdue: boolean };

export type TasksWidgetProps = {
  loading: boolean;
  pendingCount: number;
  overdueCount: number;
  approvalCount: number;
  dueTodayCount: number;
  taskCount: number;
  receiptCount: number;
  /** Ordenadas por prazo; já limitadas pelo chamador. */
  pending: TaskItem[];
  approvals: TaskItem[];
  overdue: TaskItem[];
};

function TaskRow({ task, tone }: { task: TaskItem; tone: Tone }) {
  return (
    <li className="flex items-center gap-3 rounded-ds-card border border-ds-divider bg-ds-surface p-3">
      <IconChip icon={task.overdue ? widgetIcons.alerts : widgetIcons.tasks} tone={task.overdue ? "danger" : tone} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-ds-ink">{task.title}</p>
        <p className="truncate text-xs font-medium text-ds-ink-faint">{task.statusLabel}</p>
      </div>
      <Pill tone={task.overdue ? "danger" : "muted"}>{task.dueLabel}</Pill>
    </li>
  );
}

function Column({ title, tone, count, items, empty }: { title: string; tone: Tone; count: number; items: TaskItem[]; empty: string }) {
  const dot = tone === "danger" ? "bg-ds-danger" : tone === "warn" ? "bg-ds-warn" : "bg-ds-info";
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-ds-card bg-ds-muted p-3">
      <div className="flex items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
        <h4 className="text-sm font-extrabold text-ds-ink">{title}</h4>
        <span className="ml-auto text-xs font-black tabular-nums text-ds-ink-muted">{count}</span>
      </div>
      {items.length === 0 ? <p className="rounded-ds-card border border-dashed border-ds-border px-3 py-3 text-xs font-medium text-ds-ink-faint">{empty}</p> : <ul className="space-y-2">{items.map((task) => <TaskRow key={task.id} task={task} tone={tone} />)}</ul>}
    </div>
  );
}

export function TasksWidget(props: TasksWidgetProps) {
  const { loading, pendingCount, overdueCount, approvalCount, dueTodayCount, taskCount, receiptCount, pending, approvals, overdue } = props;
  const number = (value: number) => (loading ? "..." : String(value));
  return (
    <WidgetCard widgetId="pending-tasks">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.tasks} tone="info" title={density === "compact" ? "Tarefas" : "Tarefas pendentes"} subtitle="Demandas, aprovações e recebimentos" href="/dashboard/tasks" density={density} />

          {loading ? (
            <WidgetEmpty>Carregando tarefas...</WidgetEmpty>
          ) : pendingCount === 0 ? (
            <WidgetEmpty>Nenhuma tarefa pendente no momento.</WidgetEmpty>
          ) : density === "compact" ? (
            <>
              <div className="flex items-center gap-4">
                <p className="text-5xl font-black leading-none tracking-tight tabular-nums text-ds-ink">{pendingCount}</p>
                <div className="flex flex-col items-start gap-1.5">
                  <Pill tone={overdueCount > 0 ? "danger" : "muted"}>{overdueCount} vencida(s)</Pill>
                  <Pill tone={approvalCount > 0 ? "warn" : "muted"}>{approvalCount} p/ aprovar</Pill>
                </div>
              </div>
              <ul className="space-y-2">{pending.slice(0, 2).map((task) => <TaskRow key={task.id} task={task} tone="info" />)}</ul>
            </>
          ) : density === "medium" ? (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                <KpiTile label="Pendentes" value={number(pendingCount)} note={`${taskCount} tarefa(s)`} icon={widgetIcons.tasks} tone="info" />
                <KpiTile label="Vencidas" value={number(overdueCount)} tone={overdueCount > 0 ? "danger" : "muted"} icon={widgetIcons.alerts} />
                <KpiTile label="Aprovações" value={number(approvalCount)} note={`${dueTodayCount} hoje`} tone={approvalCount > 0 ? "warn" : "muted"} icon={widgetIcons.processes} />
              </div>
              <ul className="space-y-2">{pending.slice(0, 4).map((task) => <TaskRow key={task.id} task={task} tone="info" />)}</ul>
            </>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-3">
                <KpiTile label="Pendentes" value={number(pendingCount)} note={`${taskCount} tarefa(s)`} icon={widgetIcons.tasks} tone="info" />
                <KpiTile label="Vencidas" value={number(overdueCount)} tone={overdueCount > 0 ? "danger" : "muted"} icon={widgetIcons.alerts} />
                <KpiTile label="Aprovações" value={number(approvalCount)} tone={approvalCount > 0 ? "warn" : "muted"} icon={widgetIcons.processes} />
                <KpiTile label="Recebimentos" value={number(receiptCount)} note={`${dueTodayCount} vencem hoje`} icon={widgetIcons.received} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Column title="Em aberto" tone="info" count={pendingCount} items={pending.slice(0, 3)} empty="Nada em aberto." />
                <Column title="Aguardando aprovação" tone="warn" count={approvalCount} items={approvals.slice(0, 3)} empty="Nenhuma aprovação pendente." />
                <Column title="Vencidas" tone="danger" count={overdueCount} items={overdue.slice(0, 3)} empty="Nenhuma tarefa vencida." />
              </div>
            </>
          )}
        </>
      )}
    </WidgetCard>
  );
}
