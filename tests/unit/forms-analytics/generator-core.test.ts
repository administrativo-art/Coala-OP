import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateOccurrenceCondition,
  generateDraftsForExecution,
  GenerationError,
  isItemVisible,
  type ExecutionView,
  type GenerationContext,
  type GenerationLookups,
} from "../../../src/features/forms/analytics/generator-core";
import type { AnalyticsItemView } from "../../../src/features/forms/analytics/analytics-config-schema";
import {
  buildTargetIdentityKey,
  localDateParts,
} from "../../../src/features/forms/analytics/occurrence-model";

const lookups: GenerationLookups = {
  domains: new Map([["dom_uniforme", { name: "Uniforme", is_active: true }]]),
  criteria: new Map([
    ["quesito_uniforme", { name: "Uniforme completo", domain_id: "dom_uniforme", is_active: true }],
    ["quesito_camisa", { name: "Camisa", domain_id: "dom_uniforme", is_active: true }],
    ["quesito_touca", { name: "Touca", domain_id: "dom_uniforme", is_active: true }],
    ["quesito_sapato", { name: "Sapato", domain_id: "dom_uniforme", is_active: true }],
  ]),
  results: new Map([
    [
      "res_conforme",
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
      "res_nao_conforme",
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

const childOptions = [
  { id: "camisa", label: "Camisa", analytics: { criterion_id: "quesito_camisa" } },
  { id: "touca", label: "Touca", analytics: { criterion_id: "quesito_touca" } },
  { id: "sapato", label: "Sapato", analytics: { criterion_id: "quesito_sapato" } },
  { id: "outro", label: "Outro (sem quesito)" },
];

function buildItems(overrides?: {
  parentCreateTask?: boolean;
  childCreateTask?: boolean;
}): AnalyticsItemView[] {
  return [
    {
      id: "p1",
      type: "yes_no",
      title: "Uniforme completo?",
      analytics_config: {
        enabled: true,
        domain_id: "dom_uniforme",
        criterion_id: "quesito_uniforme",
        target_type: "unit",
        target_source: "execution_unit",
        occurrence_mode: "single",
        occurrence_condition: { operator: "equals", value: false },
        evaluation_mode: "positive_and_negative",
        positive_result_id: "res_conforme",
        negative_result_id: "res_nao_conforme",
        resolution_behavior: "none",
        ...(overrides?.parentCreateTask ? { create_task: true } : {}),
        cascade_evaluations: {
          enabled: true,
          trigger: { operator: "equals", value: true },
          expands_from_item_id: "p2",
          expansion_source: "child_item_options",
          expansion_mode: "generate_positive_evaluations_for_all_options",
          result_id: "res_conforme",
          denominator_scope: "absolute",
          require_mutual_exclusion_with_child_visibility: true,
        },
      },
    },
    {
      id: "p2",
      type: "multi_select",
      title: "Quais itens estão com problema?",
      options: childOptions,
      show_if: { item_id: "p1", operator: "equals", value: false },
      analytics_config: {
        enabled: true,
        domain_id: "dom_uniforme",
        target_type: "unit",
        target_source: "execution_unit",
        occurrence_mode: "per_selected_option",
        occurrence_condition: { operator: "always" },
        evaluation_mode: "all_options_when_visible",
        positive_result_id: "res_conforme",
        negative_result_id: "res_nao_conforme",
        resolution_behavior: "auto_resolve_on_task_completion",
        ...(overrides?.childCreateTask
          ? { create_task: true, task_trigger_id: "trig_1" }
          : {}),
      },
    },
  ];
}

function buildExecution(
  answers: Array<[string, unknown, string[]?]>,
  unitId = "unit_a"
): ExecutionView {
  return {
    id: "exec_1",
    workspace_id: "ws1",
    template_id: "tpl_1",
    template_version: 3,
    completed_at: new Date("2026-07-03T18:00:00Z"),
    unit_id: unitId,
    unit_name: `Unidade ${unitId}`,
    answers: new Map(
      answers.map(([itemId, value, selected]) => [
        itemId,
        { value, selected_option_ids: selected },
      ])
    ),
  };
}

const context: GenerationContext = {
  workspace_timezone: "America/Belem",
  analytics_revision: 1,
  generation_batch_id: "batch_1",
  created_from: "form_execution",
};

describe("cascata de avaliações conformes (28.2)", () => {
  test("'Sim' no pai gera conformes para todas as opções analíticas do filho", () => {
    const drafts = generateDraftsForExecution(
      buildExecution([["p1", true]]),
      buildItems(),
      lookups,
      context
    );

    const cascade = drafts.filter((d) => d.generated_by === "cascade_from_parent");
    // "outro" não tem criterion_id e fica de fora.
    assert.equal(cascade.length, 3);
    assert.deepEqual(
      cascade.map((d) => d.criterion_id).sort(),
      ["quesito_camisa", "quesito_sapato", "quesito_touca"]
    );
    for (const draft of cascade) {
      assert.equal(draft.record_type, "evaluation");
      assert.equal(draft.counts_as_evaluation, true);
      assert.equal(draft.counts_as_occurrence, false);
      assert.equal(draft.denominator_scope, "absolute");
      assert.equal(draft.resolution_status, "not_required");
      assert.equal(draft.expanded_from_item_id, "p1");
      assert.equal(draft.expanded_from_child_item_id, "p2");
    }
  });

  test("avaliações da cascata herdam o alvo resolvido do pai", () => {
    const drafts = generateDraftsForExecution(
      buildExecution([["p1", true]]),
      buildItems(),
      lookups,
      context
    );
    const parentEval = drafts.find(
      (d) => d.template_item_id === "p1" && d.generated_by === "direct_item"
    );
    const cascade = drafts.filter((d) => d.generated_by === "cascade_from_parent");
    assert.ok(parentEval);
    for (const draft of cascade) {
      assert.equal(draft.target_identity_key, parentEval.target_identity_key);
      assert.equal(draft.target_type, parentEval.target_type);
      assert.equal(draft.unit_id, "unit_a");
    }
  });

  test("adicionar opção ao filho estende a cascata sem tocar no pai", () => {
    const items = buildItems();
    const child = items[1];
    child.options = [
      ...childOptions,
      { id: "cracha", label: "Crachá", analytics: { criterion_id: "quesito_camisa" } },
    ];
    // quesito reutilizado só para o teste; o que importa é a contagem.
    const drafts = generateDraftsForExecution(
      buildExecution([["p1", true]]),
      items,
      lookups,
      context
    );
    const cascade = drafts.filter((d) => d.generated_by === "cascade_from_parent");
    assert.equal(cascade.length, 4);
  });

  test("'Não' no pai não dispara cascata e o filho fica visível", () => {
    const drafts = generateDraftsForExecution(
      buildExecution([["p1", false], ["p2", ["touca"], ["touca"]]]),
      buildItems(),
      lookups,
      context
    );
    assert.equal(
      drafts.filter((d) => d.generated_by === "cascade_from_parent").length,
      0
    );
  });
});

describe("per_selected_option e denominador (28.2)", () => {
  test("selecionadas geram ocorrências negativas; não selecionadas geram conformes", () => {
    const drafts = generateDraftsForExecution(
      buildExecution([
        ["p1", false],
        ["p2", ["touca", "sapato"], ["touca", "sapato"]],
      ]),
      buildItems(),
      lookups,
      context
    );

    const fromChild = drafts.filter((d) => d.template_item_id === "p2");
    const occurrences = fromChild.filter((d) => d.record_type === "occurrence");
    const evaluations = fromChild.filter((d) => d.record_type === "evaluation");

    assert.deepEqual(
      occurrences.map((d) => d.option_id).sort(),
      ["sapato", "touca"]
    );
    for (const occurrence of occurrences) {
      assert.equal(occurrence.counts_as_non_conformity, true);
      assert.equal(occurrence.resolution_status, "open");
      assert.equal(
        occurrence.resolution_behavior,
        "auto_resolve_on_task_completion"
      );
    }
    // camisa não selecionada → conforme (denominador absoluto)
    assert.deepEqual(evaluations.map((d) => d.option_id), ["camisa"]);
    assert.equal(evaluations[0].resolution_status, "not_required");
  });

  test("filho invisível (show_if) não gera registros diretos", () => {
    const drafts = generateDraftsForExecution(
      buildExecution([["p1", true], ["p2", ["touca"], ["touca"]]]),
      buildItems(),
      lookups,
      context
    );
    assert.equal(
      drafts.filter(
        (d) => d.template_item_id === "p2" && d.generated_by === "direct_item"
      ).length,
      0
    );
  });

  test("create_task só marca ocorrências, nunca avaliações", () => {
    const drafts = generateDraftsForExecution(
      buildExecution([
        ["p1", false],
        ["p2", ["touca"], ["touca"]],
      ]),
      buildItems({ childCreateTask: true }),
      lookups,
      context
    );
    const occurrence = drafts.find(
      (d) => d.record_type === "occurrence" && d.template_item_id === "p2"
    );
    const evaluation = drafts.find(
      (d) => d.record_type === "evaluation" && d.template_item_id === "p2"
    );
    assert.equal(occurrence?.create_task, true);
    assert.equal(occurrence?.task_trigger_id, "trig_1");
    assert.equal(evaluation?.create_task, undefined);
    assert.equal(drafts.every((d) => d.has_active_task === false), true);
  });
});

describe("identidade e dedupe (28.1/28.4)", () => {
  test("dedupe_key inclui a revisão", () => {
    const [draft] = generateDraftsForExecution(
      buildExecution([["p1", true]]),
      buildItems(),
      lookups,
      context
    );
    assert.ok(draft.dedupe_key.endsWith(":rev:1"));
    assert.equal(
      draft.dedupe_key,
      `${draft.occurrence_identity_key}:rev:1`
    );

    const [draftRev2] = generateDraftsForExecution(
      buildExecution([["p1", true]]),
      buildItems(),
      lookups,
      { ...context, analytics_revision: 2 }
    );
    assert.equal(draftRev2.occurrence_identity_key, draft.occurrence_identity_key);
    assert.notEqual(draftRev2.dedupe_key, draft.dedupe_key);
  });

  test("Porta 09 da unidade A não soma com a da unidade B", () => {
    const keyA = buildTargetIdentityKey({
      workspace_id: "ws1",
      target_type: "location",
      target_id: "door_09",
      unit_id: "unit_a",
    });
    const keyB = buildTargetIdentityKey({
      workspace_id: "ws1",
      target_type: "location",
      target_id: "door_09",
      unit_id: "unit_b",
    });
    assert.notEqual(keyA, keyB);

    const draftsA = generateDraftsForExecution(
      buildExecution([["p1", true]], "unit_a"),
      buildItems(),
      lookups,
      context
    );
    const draftsB = generateDraftsForExecution(
      buildExecution([["p1", true]], "unit_b"),
      buildItems(),
      lookups,
      context
    );
    assert.notEqual(
      draftsA[0].target_identity_key,
      draftsB[0].target_identity_key
    );
  });

  test("resultado inexistente falha a geração com GenerationError", () => {
    const items = buildItems();
    items[0].analytics_config!.positive_result_id = "res_inexistente";
    assert.throws(
      () =>
        generateDraftsForExecution(
          buildExecution([["p1", true]]),
          items,
          lookups,
          context
        ),
      GenerationError
    );
  });
});

describe("timezone e bucketing (28.7)", () => {
  test("22h em America/Belem cai no dia local correto, não no dia UTC", () => {
    // 2026-07-04T01:00Z = 2026-07-03 22:00 em Belém (UTC-3)
    const parts = localDateParts(new Date("2026-07-04T01:00:00Z"), "America/Belem");
    assert.equal(parts.occurred_local_date, "2026-07-03");
    assert.equal(parts.occurred_year_month, "2026-07");
  });

  test("bucket é gravado com o timezone do contexto", () => {
    const drafts = generateDraftsForExecution(
      {
        ...buildExecution([["p1", true]]),
        completed_at: new Date("2026-07-04T01:00:00Z"),
      },
      buildItems(),
      lookups,
      context
    );
    assert.equal(drafts[0].bucket_timezone, "America/Belem");
    assert.equal(drafts[0].occurred_local_date, "2026-07-03");
  });
});

describe("condições de ocorrência", () => {
  test("operadores básicos", () => {
    assert.equal(
      evaluateOccurrenceCondition({ operator: "always" }, { value: null }),
      true
    );
    assert.equal(
      evaluateOccurrenceCondition(
        { operator: "equals", value: false },
        { value: "false" }
      ),
      true
    );
    assert.equal(
      evaluateOccurrenceCondition({ operator: "out_of_range" }, {
        value: 12,
        is_out_of_range: true,
      }),
      true
    );
    assert.equal(
      evaluateOccurrenceCondition({ operator: "is_empty" }, { value: [] }),
      true
    );
  });

  test("visibilidade respeita show_if", () => {
    const items = buildItems();
    const answers = new Map([["p1", { value: true }]]);
    assert.equal(isItemVisible(items[0], answers), true);
    assert.equal(isItemVisible(items[1], answers), false);
  });
});
