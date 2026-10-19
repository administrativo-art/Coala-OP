import { differenceInCalendarDays, format } from "date-fns";

import type { TaskPriority } from "@/types";

/** Origem da tarefa na linha do dia do colaborador; decide grupo e ação. */
export type TimelineTaskKind = "reposition" | "people" | "stock" | "approval" | "other";

export interface TimelineTaskSource {
  id: string;
  type: string;
  title: string;
  description: string;
  link: string;
  dueDate?: string;
  priority?: TaskPriority;
  originLink?: string;
  originType?: string;
}

export interface TimelineTaskItem {
  name: string;
  quantity: string;
}

export interface TimelineTaskUrgency {
  level: "overdue" | "today" | "soon" | "later";
  label: string;
}

export interface TimelineTaskView {
  id: string;
  kind: TimelineTaskKind;
  title: string;
  route: { origin: string; destination: string } | null;
  items: TimelineTaskItem[];
  hiddenItemCount: number;
  text: string;
  urgency: TimelineTaskUrgency | null;
  action: { label: string; href: string };
}

export const TIMELINE_VISIBLE_ITEMS = 3;

export const TIMELINE_GROUP_LABELS: Record<TimelineTaskKind, string> = {
  reposition: "Despachos de reposição",
  people: "Pessoal",
  stock: "Estoque",
  approval: "Aprovações",
  other: "Outras tarefas",
};

const ROUTE_LINE = /^(Origem|Destino):\s*(.+)$/i;
const ITEM_LINE = /^-\s*(.+?):\s*(.+)$/;
const ITEM_TOTAL_LINE = /^(\d+)\s+itens?\b/i;
// Linhas que repetem o que o título e o estado já dizem.
const REDUNDANT_LINE = /^(Status operacional:|Itens:$)/i;

/**
 * Separa a descrição gerada pelas integrações (reposição: "Origem:", "Destino:",
 * "- ITEM: qtd") em rota, itens e texto livre. Descrição sem esse formato vira só texto.
 */
export function parseTimelineTaskBody(description: string) {
  let origin: string | null = null;
  let destination: string | null = null;
  let itemTotal: number | null = null;
  const items: TimelineTaskItem[] = [];
  const text: string[] = [];

  for (const raw of description.split("\n")) {
    const line = raw.trim();
    if (!line || REDUNDANT_LINE.test(line)) continue;
    const route = ROUTE_LINE.exec(line);
    if (route) {
      if (route[1].toLowerCase() === "origem") origin = route[2].trim();
      else destination = route[2].trim();
      continue;
    }
    const item = ITEM_LINE.exec(line);
    if (item) {
      items.push({ name: item[1].trim(), quantity: item[2].trim() });
      continue;
    }
    const total = ITEM_TOTAL_LINE.exec(line);
    if (total) {
      itemTotal = Number(total[1]);
      continue;
    }
    text.push(line);
  }

  return {
    route: origin && destination ? { origin, destination } : null,
    items,
    itemTotal: Math.max(itemTotal ?? 0, items.length),
    text: text.join(" "),
  };
}

/** Prazo em dias de calendário locais; sem prazo, só prioridade alta/urgente vira aviso. */
export function timelineTaskUrgency(dueDate: string | undefined, priority: TaskPriority | undefined, now: Date): TimelineTaskUrgency | null {
  const due = dueDate ? new Date(dueDate) : null;
  if (due && !Number.isNaN(due.getTime())) {
    const days = differenceInCalendarDays(due, now);
    if (days < 0) return { level: "overdue", label: `Atrasada há ${-days} ${days === -1 ? "dia" : "dias"}` };
    if (days === 0) return { level: "today", label: "Vence hoje" };
    if (days === 1) return { level: "soon", label: "Vence amanhã" };
    if (days <= 7) return { level: "soon", label: `Vence em ${days} dias` };
    return { level: "later", label: `Prazo ${format(due, "dd/MM/yyyy")}` };
  }
  if (priority === "urgent") return { level: "today", label: "Urgente" };
  if (priority === "high") return { level: "soon", label: "Prioridade alta" };
  return null;
}

function kindOf(task: TimelineTaskSource): TimelineTaskKind {
  if (task.type === "Aprovação") return "approval";
  if (task.originType === "reposition_activity" || task.type === "Reposição") return "reposition";
  if (task.originType === "termination" || task.originLink?.startsWith("/dashboard/dp/")) return "people";
  if (task.originType === "return_request" || task.originType === "item_addition_request" || task.type === "Avaria") return "stock";
  return "other";
}

function actionOf(task: TimelineTaskSource, kind: TimelineTaskKind) {
  const origin = task.originLink ?? (task.link !== "/dashboard/tasks" ? task.link : undefined);
  if (kind === "approval") return { label: "Revisar", href: task.link };
  if (!origin) return { label: "Concluir", href: task.link };
  if (kind === "reposition") return { label: /efetiva/i.test(task.title) ? "Efetivar" : "Despachar", href: origin };
  if (kind === "people") return { label: "Abrir trilha", href: origin };
  if (kind === "stock") return { label: task.originType === "item_addition_request" ? "Abrir solicitação" : "Abrir chamado", href: origin };
  if (task.originType === "form") return { label: "Abrir formulário", href: origin };
  return { label: "Abrir", href: origin };
}

export function toTimelineTaskView(task: TimelineTaskSource, now: Date): TimelineTaskView {
  const kind = kindOf(task);
  const body = parseTimelineTaskBody(task.description);
  const items = body.items.slice(0, TIMELINE_VISIBLE_ITEMS);
  // "Despachar reposição: A → B" fica "Despachar reposição"; a rota ganha linha própria.
  const title = body.route ? task.title.replace(/:\s*[^:]*→.*$/, "").trim() || task.title : task.title;
  return {
    id: task.id,
    kind,
    title,
    route: body.route,
    items,
    hiddenItemCount: body.itemTotal - items.length,
    text: body.text,
    urgency: timelineTaskUrgency(task.dueDate, task.priority, now),
    action: actionOf(task, kind),
  };
}

const URGENCY_RANK: Record<TimelineTaskUrgency["level"], number> = { overdue: 0, today: 1, soon: 2, later: 3 };

export function compareTimelineTaskUrgency(a: TimelineTaskView, b: TimelineTaskView) {
  return (a.urgency ? URGENCY_RANK[a.urgency.level] : 4) - (b.urgency ? URGENCY_RANK[b.urgency.level] : 4);
}

/** Agrupa por origem, mantendo a ordem de urgência dentro e entre os grupos; grupo de um só fica solto. */
export function groupTimelineTasks(views: TimelineTaskView[]) {
  const groups = new Map<TimelineTaskKind, TimelineTaskView[]>();
  for (const view of [...views].sort(compareTimelineTaskUrgency)) {
    groups.set(view.kind, [...(groups.get(view.kind) ?? []), view]);
  }
  return [...groups.entries()].map(([kind, tasks]) => ({ kind, label: TIMELINE_GROUP_LABELS[kind], tasks }));
}
