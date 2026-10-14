import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bankAccountSummary,
  buildPlanTree,
  budgetRuleModeLabel,
  collectDescendantIds,
  describeCardCycle,
  flattenPlan,
  isCompetenceMonth,
  matchesFinanceQuery,
  summarizeBudgets,
  summarizePlan,
  usagePercent,
} from "../../src/features/financial/components/settings/settings-model";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const items = [
  { id: "a", name: "Pessoal", order: 1 },
  { id: "b", name: "Receitas", order: 0 },
  { id: "a1", name: "Salários", parentId: "a", order: 0 },
  { id: "a2", name: "Encargos", parentId: "a", order: 1 },
  { id: "a1x", name: "13º", parentId: "a1", order: 0 },
  { id: "orphan", name: "Sem pai", parentId: "removed", order: 2 },
];

describe("busca", () => {
  it("ignora acento e caixa, e sem termo tudo corresponde", () => {
    assert.equal(matchesFinanceQuery("SALARIO", "Salários"), true);
    assert.equal(matchesFinanceQuery("  ", "qualquer"), true);
    assert.equal(matchesFinanceQuery("xyz", "Salários", null, undefined), false);
  });
});

describe("plano de contas", () => {
  it("monta a árvore por ordem e promove órfãos a raiz", () => {
    const tree = buildPlanTree(items);
    assert.deepEqual(tree.map((node) => node.id), ["b", "a", "orphan"]);
    assert.deepEqual(tree[1].children.map((node) => node.id), ["a1", "a2"]);
  });

  it("numera a hierarquia e respeita o recolhimento", () => {
    const tree = buildPlanTree(items);
    const collapsed = flattenPlan(tree, new Set(), null);
    assert.deepEqual(collapsed.map((row) => row.number), ["1", "2", "3"]);
    const open = flattenPlan(tree, new Set(["a", "a1"]), null);
    assert.deepEqual(open.map((row) => `${row.number}:${row.item.id}`), ["1:b", "2:a", "2.1:a1", "2.1.1:a1x", "2.2:a2", "3:orphan"]);
    assert.equal(open.find((row) => row.item.id === "a1x")?.rootIndex, 1);
  });

  it("com busca ativa lista só os itens que correspondem, sem hierarquia", () => {
    const tree = buildPlanTree(items);
    const rows = flattenPlan(tree, new Set(), (item) => item.name.includes("13") || item.name === "Encargos");
    assert.deepEqual(rows.map((row) => row.item.id), ["a1x", "a2"]);
    assert.equal(rows.every((row) => row.depth === 0), true);
  });

  it("não deixa escolher descendentes como pai", () => {
    assert.deepEqual([...collectDescendantIds(items, "a")].sort(), ["a1", "a1x", "a2"]);
  });

  it("resume a classificação sem contar conta patrimonial como sem classificação", () => {
    assert.deepEqual(summarizePlan([{ dre_position: "pessoal" }, { is_dre_account: false }, {}, { dre_position: null, is_dre_account: true }]),
      { total: 4, dre: 1, patrimonial: 1, unclassified: 2 });
  });
});

describe("contas bancárias", () => {
  it("resume contas e formas de pagamento", () => {
    assert.deepEqual(bankAccountSummary([{ active: true, paymentMethods: [1, 2] }, { active: false, paymentMethods: [1] }, { paymentMethods: undefined }]),
      { total: 3, active: 2, inactive: 1, methods: 3 });
  });

  it("descreve fechamento e vencimento só no cartão de crédito", () => {
    assert.equal(describeCardCycle({ type: "credit_card", closingDay: 20, dueDay: 10 }), "Fecha dia 20 · Vence dia 10");
    assert.equal(describeCardCycle({ type: "credit_card", dueDay: 10 }), "Vence dia 10");
    assert.equal(describeCardCycle({ type: "pix", closingDay: 20 }), "");
  });
});

describe("orçamentos", () => {
  it("valida a competência e limita a barra de consumo", () => {
    assert.equal(isCompetenceMonth("2026-10"), true);
    assert.equal(isCompetenceMonth("2026-13"), false);
    assert.equal(usagePercent(0.5), 50);
    assert.equal(usagePercent(3), 100);
    assert.equal(usagePercent(-1), 0);
    assert.equal(usagePercent(Number.NaN), 0);
    assert.equal(usagePercent(undefined), 0);
  });

  it("soma apenas orçamentos ativos e nomeia o modo da regra", () => {
    assert.deepEqual(summarizeBudgets([
      { active: true, budgetedAmountCents: 1000, consumedAmountCents: 400, balanceAmountCents: 600 },
      { active: false, budgetedAmountCents: 9999, consumedAmountCents: 1, balanceAmountCents: 9998 },
    ]), { count: 2, activeCount: 1, budgetedCents: 1000, consumedCents: 400, balanceCents: 600 });
    assert.equal(budgetRuleModeLabel({ mode: "expense_average", averageMonths: 3 }), "Média de 3 meses");
    assert.equal(budgetRuleModeLabel({ mode: "fixed" }), "Valor fixo");
  });
});

describe("contrato visual das telas do Financeiro", () => {
  const files = [
    "src/features/financial/components/settings/account-plans-management.tsx",
    "src/features/financial/components/settings/result-centers-management.tsx",
    "src/features/financial/components/settings/expense-descriptions-management.tsx",
    "src/features/financial/components/settings/bank-accounts-management.tsx",
    "src/features/financial/components/settings/import-aliases-management.tsx",
    "src/features/financial/components/settings/budgets-management.tsx",
    "src/features/financial/components/settings/accounting-settings.tsx",
    "src/components/patterns/panel-form.tsx",
  ];
  // A etiqueta impressa (45x15mm) tem cores e CSS de impressão próprios; só a interface de tela segue os tokens.
  const assetPanel = "src/components/assets/asset-barcode-labels-panel.tsx";

  for (const file of files) {
    it(`${file} não usa hex, diálogo nativo, toast nem cores fora dos tokens`, () => {
      const source = read(file);
      assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
      assert.doesNotMatch(source, /\b(alert|confirm)\(/);
      assert.doesNotMatch(source, /useToast/);
      assert.doesNotMatch(source, /\b(?:text|bg|border)-(?:red|rose|emerald|amber|blue|slate|zinc|indigo|pink)-\d{2,3}\b/);
      assert.doesNotMatch(source, /AlertDialog/);
    });
  }

  it("o painel de etiquetas patrimoniais não usa toast nem diálogos de confirmação", () => {
    const source = read(assetPanel);
    assert.doesNotMatch(source, /useToast|AlertDialog|\b(alert|confirm)\(/);
    assert.match(source, /InlineConfirm/);
    assert.match(source, /SidePanel/);
  });

  it("listas de cadastro abrem painel lateral e confirmam exclusão inline", () => {
    for (const file of files.slice(0, 5)) {
      const source = read(file);
      assert.match(source, /SidePanel/);
      assert.match(source, /InlineConfirm/);
    }
  });

  it("a página de configurações oferece Contabilidade em uma única tela", () => {
    const page = read("src/app/dashboard/settings/page.tsx");
    assert.match(page, /AccountingSettings/);
    assert.doesNotMatch(page, /<AccountPlansManagement|<ResultCentersManagement|<ExpenseDescriptionsManagement/);
  });
});
