import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  generateDraftsForExecution,
  type ExecutionView,
  type GenerationContext,
  type GenerationLookups,
} from "../../../src/features/forms/analytics/generator-core";
import type { AnalyticsItemView } from "../../../src/features/forms/analytics/analytics-config-schema";

const lookups: GenerationLookups = {
  domains: new Map([["dom", { name: "Uniforme", is_active: true }]]),
  criteria: new Map([
    ["c_touca", { name: "Touca", domain_id: "dom", is_active: true }],
    ["c_sapato", { name: "Sapato", domain_id: "dom", is_active: true }],
  ]),
  results: new Map([
    [
      "r_ok",
      {
        name: "Conforme",
        polarity: "positive",
        counts_as_evaluation: true,
        counts_as_occurrence: false,
        counts_as_non_conformity: false,
        is_active: true,
      },
    ],
    [
      "r_nc",
      {
        name: "Não conforme",
        polarity: "negative",
        counts_as_evaluation: true,
        counts_as_occurrence: true,
        counts_as_non_conformity: true,
        is_active: true,
      },
    ],
  ]),
  freeTargets: new Map(),
};

const context: GenerationContext = {
  workspace_timezone: "America/Belem",
  analytics_revision: 1,
  generation_batch_id: "b1",
  created_from: "form_execution",
};

const COMPLETED_AT = new Date("2026-07-03T18:00:00Z");

function multiSelectItem(
  descriptionMode: "shared_text" | "prefix_parser" | "per_option_detail",
  extra?: Partial<Record<string, unknown>>
): AnalyticsItemView[] {
  return [
    {
      id: "p_itens",
      type: "multi_select",
      title: "Itens com problema",
      options: [
        { id: "touca", label: "Touca", analytics: { criterion_id: "c_touca" } },
        { id: "sapato", label: "Sapato", analytics: { criterion_id: "c_sapato" } },
      ],
      analytics_config: {
        enabled: true,
        domain_id: "dom",
        target_type: "unit",
        target_source: "execution_unit",
        occurrence_mode: "per_selected_option",
        occurrence_condition: { operator: "always" },
        evaluation_mode: "negative_only",
        positive_result_id: "r_ok",
        negative_result_id: "r_nc",
        resolution_behavior: "none",
        description_item_id: "p_desc",
        description_mapping_mode: descriptionMode,
        ...(extra ?? {}),
      },
    },
    { id: "p_desc", type: "text", title: "Descreva" },
  ];
}

function execution(
  descAnswer: unknown,
  selected: string[] = ["touca", "sapato"]
): ExecutionView {
  return {
    id: "e1",
    workspace_id: "ws1",
    template_id: "t1",
    template_version: 1,
    completed_at: COMPLETED_AT,
    unit_id: "u1",
    unit_name: "Unidade 1",
    answers: new Map<string, { value: unknown; selected_option_ids?: string[] }>([
      ["p_itens", { value: selected, selected_option_ids: selected }],
      ["p_desc", { value: descAnswer }],
    ]),
  };
}

describe("description mapping (§9)", () => {
  test("shared_text aplica o mesmo texto a todas as ocorrências", () => {
    const drafts = generateDraftsForExecution(
      execution("Verificar itens"),
      multiSelectItem("shared_text"),
      lookups,
      context
    );
    const occ = drafts.filter((d) => d.record_type === "occurrence");
    assert.equal(occ.length, 2);
    for (const draft of occ) {
      assert.equal(draft.description, "Verificar itens");
      assert.equal(draft.description_extraction, "shared_text");
    }
  });

  test("prefix_parser extrai a linha da opção pelo rótulo", () => {
    const drafts = generateDraftsForExecution(
      execution("Touca: rasgada\nSapato: sujo"),
      multiSelectItem("prefix_parser"),
      lookups,
      context
    );
    const byOption = new Map(
      drafts
        .filter((d) => d.record_type === "occurrence")
        .map((d) => [d.option_id, d])
    );
    assert.equal(byOption.get("touca")?.description, "rasgada");
    assert.equal(byOption.get("touca")?.description_extraction, "parsed_by_prefix");
    assert.equal(byOption.get("sapato")?.description, "sujo");
  });

  test("prefix_parser ignora opção sem linha correspondente", () => {
    const drafts = generateDraftsForExecution(
      execution("Touca: rasgada"),
      multiSelectItem("prefix_parser"),
      lookups,
      context
    );
    const sapato = drafts.find(
      (d) => d.record_type === "occurrence" && d.option_id === "sapato"
    );
    assert.equal(sapato?.description, undefined);
  });

  test("per_option_detail usa o mapa por option_id/label", () => {
    const drafts = generateDraftsForExecution(
      execution({ touca: "furada", Sapato: "molhado" }),
      multiSelectItem("per_option_detail"),
      lookups,
      context
    );
    const byOption = new Map(
      drafts
        .filter((d) => d.record_type === "occurrence")
        .map((d) => [d.option_id, d])
    );
    assert.equal(byOption.get("touca")?.description, "furada");
    assert.equal(byOption.get("sapato")?.description, "molhado");
    assert.equal(
      byOption.get("touca")?.description_extraction,
      "per_option_detail"
    );
  });
});

describe("SLA / due_at (§18.5)", () => {
  test("sla_hours grava due_at = occurred_at + horas na ocorrência", () => {
    const drafts = generateDraftsForExecution(
      execution("x"),
      multiSelectItem("shared_text", { sla_hours: 5 }),
      lookups,
      context
    );
    const occ = drafts.find((d) => d.record_type === "occurrence");
    assert.ok(occ?.due_at instanceof Date);
    assert.equal(
      occ!.due_at!.getTime(),
      COMPLETED_AT.getTime() + 5 * 3600000
    );
  });

  test("sem sla_hours não há due_at", () => {
    const drafts = generateDraftsForExecution(
      execution("x"),
      multiSelectItem("shared_text"),
      lookups,
      context
    );
    assert.equal(drafts.every((d) => d.due_at === undefined), true);
  });

  test("avaliações (conformes) nunca recebem due_at mesmo com sla", () => {
    const items = multiSelectItem("shared_text", {
      evaluation_mode: "all_options_when_visible",
      sla_hours: 3,
    });
    const exec = execution("x", ["touca"]);
    const drafts = generateDraftsForExecution(exec, items, lookups, context);
    const evaluation = drafts.find((d) => d.record_type === "evaluation");
    assert.ok(evaluation);
    assert.equal(evaluation!.due_at, undefined);
  });
});
