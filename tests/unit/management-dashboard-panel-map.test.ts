import assert from "node:assert/strict";
import test from "node:test";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createDefaultManagementLayout } from "../../src/features/management-dashboard/default-layout";
import { PanelMap, WidgetControls, mapHeight, mapSpan, sizeLabelOf } from "../../src/features/management-dashboard/panel-map";

const noop = () => undefined;

function render(props: Partial<Parameters<typeof PanelMap>[0]> = {}) {
  Object.assign(globalThis, { React: { createElement, Fragment } });
  const layout = createDefaultManagementLayout("u1", "Ana");
  return {
    layout,
    html: renderToStaticMarkup(createElement(PanelMap, { widgets: layout.widgets, selectedId: null, recentId: null, lockedIds: [], onSelect: noop, onReorder: noop, onResize: noop, onRemove: noop, ...props })),
  };
}

test("mapa usa as mesmas proporções do grid de 12 colunas", () => {
  assert.equal(mapSpan(3), 3);
  assert.equal(mapSpan(12), 12);
  assert.equal(mapSpan(40), 12);
  assert.equal(mapSpan(0), 1);
  assert.ok(mapHeight(4) > mapHeight(2));
});

test("mapa mostra um bloco por widget, com nome e tamanho", () => {
  const { layout, html } = render();
  for (const placement of layout.widgets) assert.ok(html.includes(`Mover `), "cada bloco tem alça de arraste");
  assert.equal((html.match(/Mover /g) ?? []).length, layout.widgets.length);
  assert.ok(html.includes("Faturamento e metas"));
  assert.ok(html.includes("grid-cols-12"));
  assert.match(html, /grid-column:span 6 \/ span 6/);
});

test("rótulo de tamanho vem do catálogo", () => {
  const { layout } = render();
  const goals = layout.widgets.find((item) => item.widgetId === "goals-revenue")!;
  assert.equal(sizeLabelOf(goals), "Médio");
  const hub = layout.widgets.find((item) => item.widgetId === "financial-shortcuts")!;
  assert.equal(sizeLabelOf(hub), "Compacto");
});

test("cada bloco tem botão de ajustes no próprio widget", () => {
  const { layout, html } = render();
  assert.equal((html.match(/Ajustar /g) ?? []).length, layout.widgets.length);
  assert.ok(!html.includes("Remover do painel"), "controles só aparecem ao abrir o bloco");
});

test("controles do widget mostram os três tamanhos e a remoção", () => {
  Object.assign(globalThis, { React: { createElement, Fragment } });
  const first = createDefaultManagementLayout("u1", "Ana").widgets[0]!;
  const html = renderToStaticMarkup(createElement(WidgetControls, { placement: first, locked: false, onResize: noop, onRemove: noop }));
  for (const label of ["Compacto", "Médio", "Amplo"]) assert.ok(html.includes(label));
  assert.ok(html.includes("Remover do painel"));
});

test("widget travado não pode ser removido", () => {
  Object.assign(globalThis, { React: { createElement, Fragment } });
  const first = createDefaultManagementLayout("u1", "Ana").widgets[0]!;
  const html = renderToStaticMarkup(createElement(WidgetControls, { placement: first, locked: true, onResize: noop, onRemove: noop }));
  assert.match(html, /<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Remover do painel/);
});

test("widget recém-adicionado é sinalizado", () => {
  const first = createDefaultManagementLayout("u1", "Ana").widgets[0]!;
  assert.ok(render({ recentId: first.instanceId }).html.includes("Novo"));
});
