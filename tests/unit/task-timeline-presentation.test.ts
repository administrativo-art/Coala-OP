import assert from "node:assert/strict";
import test from "node:test";

import {
  groupTimelineTasks,
  parseTimelineTaskBody,
  timelineTaskUrgency,
  toTimelineTaskView,
  type TimelineTaskSource,
} from "../../src/features/tasks/lib/timeline-presentation";

const now = new Date(2026, 9, 18, 15, 0);
const repositionDescription = [
  "Origem: Centro de distribuição - Matriz",
  "Destino: Quiosque João Paulo",
  "Status operacional: Aguardando despacho",
  "10 itens na reposição.",
  "",
  "Itens:",
  "- GRANULADO CHOCOLATE: 500",
  "- PAZINHA: 300",
  "- NUTELLA: 1300",
  "- AMENDOIM: 2100",
].join("\n");

function task(overrides: Partial<TimelineTaskSource>): TimelineTaskSource {
  return { id: "t", type: "Tarefa", title: "Tarefa", description: "", link: "/dashboard/tasks", ...overrides };
}

test("separa rota, itens e total da descrição da reposição, sem repetir o estado", () => {
  const body = parseTimelineTaskBody(repositionDescription);
  assert.deepEqual(body.route, { origin: "Centro de distribuição - Matriz", destination: "Quiosque João Paulo" });
  assert.equal(body.items.length, 4);
  assert.deepEqual(body.items[0], { name: "GRANULADO CHOCOLATE", quantity: "500" });
  assert.equal(body.itemTotal, 10);
  assert.equal(body.text, "");
});

test("descrição livre continua como texto", () => {
  const body = parseTimelineTaskBody("Gere e valide a guia, solicite o PIX no Banco Inter.");
  assert.equal(body.route, null);
  assert.deepEqual(body.items, []);
  assert.equal(body.text, "Gere e valide a guia, solicite o PIX no Banco Inter.");
});

test("prazo em dias de calendário e prioridade sem prazo", () => {
  assert.deepEqual(timelineTaskUrgency(new Date(2026, 9, 16, 23, 0).toISOString(), undefined, now), { level: "overdue", label: "Atrasada há 2 dias" });
  assert.deepEqual(timelineTaskUrgency(new Date(2026, 9, 17, 9, 0).toISOString(), undefined, now), { level: "overdue", label: "Atrasada há 1 dia" });
  assert.equal(timelineTaskUrgency(new Date(2026, 9, 18, 23, 59).toISOString(), undefined, now)?.label, "Vence hoje");
  assert.equal(timelineTaskUrgency(new Date(2026, 9, 19, 0, 1).toISOString(), undefined, now)?.label, "Vence amanhã");
  assert.equal(timelineTaskUrgency(new Date(2026, 9, 23).toISOString(), undefined, now)?.label, "Vence em 5 dias");
  assert.equal(timelineTaskUrgency(new Date(2026, 10, 30).toISOString(), undefined, now)?.label, "Prazo 30/11/2026");
  assert.equal(timelineTaskUrgency(undefined, "high", now)?.label, "Prioridade alta");
  assert.equal(timelineTaskUrgency(undefined, "normal", now), null);
  assert.equal(timelineTaskUrgency("lixo", undefined, now), null);
});

test("reposição: título curto, rota própria, 3 itens e ação de despacho na origem", () => {
  const view = toTimelineTaskView(task({ title: "Despachar reposição: Centro de distribuição - Matriz → Quiosque João Paulo",
    description: repositionDescription, originType: "reposition_activity", originLink: "/dashboard/stock/reposition" }), now);
  assert.equal(view.kind, "reposition");
  assert.equal(view.title, "Despachar reposição");
  assert.equal(view.route?.destination, "Quiosque João Paulo");
  assert.equal(view.items.length, 3);
  assert.equal(view.hiddenItemCount, 7);
  assert.deepEqual(view.action, { label: "Despachar", href: "/dashboard/stock/reposition" });
});

test("ação por origem; Concluir só quando não há tela de origem", () => {
  const people = toTimelineTaskView(task({ title: "Conduzir ASO demissional", originLink: "/dashboard/dp/terminations/p1", priority: "high" }), now);
  assert.equal(people.kind, "people");
  assert.deepEqual(people.action, { label: "Abrir trilha", href: "/dashboard/dp/terminations/p1" });
  assert.equal(people.urgency?.label, "Prioridade alta");
  assert.deepEqual(toTimelineTaskView(task({}), now).action, { label: "Concluir", href: "/dashboard/tasks" });
  assert.equal(toTimelineTaskView(task({ type: "Aprovação" }), now).action.label, "Revisar");
  assert.equal(toTimelineTaskView(task({ type: "Avaria", link: "/dashboard/stock/returns" }), now).action.label, "Abrir chamado");
  assert.equal(toTimelineTaskView(task({ type: "Reposição", title: "Efetivação Pendente", link: "/dashboard/stock/analysis/restock" }), now).action.label, "Efetivar");
});

test("agrupa por origem com os mais urgentes primeiro", () => {
  const views = [
    toTimelineTaskView(task({ id: "a", originType: "reposition_activity", originLink: "/r" }), now),
    toTimelineTaskView(task({ id: "b", originLink: "/dashboard/dp/terminations/p", dueDate: new Date(2026, 9, 10).toISOString() }), now),
    toTimelineTaskView(task({ id: "c", originType: "reposition_activity", originLink: "/r", dueDate: new Date(2026, 9, 18).toISOString() }), now),
  ];
  const groups = groupTimelineTasks(views);
  assert.deepEqual(groups.map((group) => group.kind), ["people", "reposition"]);
  assert.deepEqual(groups[1].tasks.map((view) => view.id), ["c", "a"]);
  assert.equal(groups[1].label, "Despachos de reposição");
});
