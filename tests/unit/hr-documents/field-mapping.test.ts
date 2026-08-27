import assert from "node:assert/strict";
import { describe, test } from "node:test";

const brl = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

import {
  applyFieldMapping,
  formatManualValue,
  normalizeFieldMapping,
  parseManualNumber,
  pendingPlaceholders,
  suggestSystemKey,
  type TemplateFieldMapping,
} from "../../../src/features/hr/documents/field-mapping";

describe("mapeamento de campos de modelos", () => {
  test("pendingPlaceholders ignora catálogo, loops legados e mapeados", () => {
    const mapping: TemplateFieldMapping = {
      valor_recibo: { kind: "manual", label: "Valor do recibo", format: "currency_br", required: true },
    };
    const pending = pendingPlaceholders(
      ["employee.name", "name", "cpf", "valor_recibo", "mes_referencia"],
      mapping,
    );
    assert.deepEqual(pending, ["mes_referencia"]);
  });

  test("normalizeFieldMapping descarta entradas inválidas e limita opções", () => {
    const mapping = normalizeFieldMapping(
      {
        valor: { kind: "manual", label: "  Valor  ", format: "currency_br", required: true },
        semLabel: { kind: "manual", label: "   ", format: "text" },
        sistema: { kind: "system", key: "employee.name" },
        chaveInvalida: { kind: "system", key: "employee.inexistente" },
        foraDoModelo: { kind: "manual", label: "X", format: "text" },
        lista: { kind: "manual", label: "Tipo", format: "select", options: ["A", " B ", "", 3] },
      },
      ["valor", "semLabel", "sistema", "chaveInvalida", "lista"],
    );
    assert.deepEqual(Object.keys(mapping).sort(), ["lista", "sistema", "valor"]);
    assert.deepEqual(mapping.sistema, { kind: "system", key: "employee.name" });
    assert.equal(mapping.valor.kind, "manual");
    if (mapping.valor.kind === "manual") {
      assert.equal(mapping.valor.label, "Valor");
      assert.equal(mapping.valor.required, true);
    }
    if (mapping.lista.kind === "manual") assert.deepEqual(mapping.lista.options, ["A", "B"]);
  });

  test("parseManualNumber entende formato pt-BR e numérico", () => {
    assert.equal(parseManualNumber("1.412,50"), 1412.5);
    assert.equal(parseManualNumber("R$ 220,00"), 220);
    assert.equal(parseManualNumber("1412.5"), 1412.5);
    assert.equal(parseManualNumber(88), 88);
    assert.equal(parseManualNumber("abc"), null);
    assert.equal(parseManualNumber(""), null);
  });

  test("formatManualValue formata por tipo", () => {
    assert.equal(formatManualValue("2026-07-20", "date_br"), "20/07/2026");
    assert.equal(formatManualValue("220,5", "currency_br"), brl(220.5));
    assert.equal(formatManualValue("true", "boolean_br"), "Sim");
    assert.equal(formatManualValue(false, "boolean_br"), "Não");
    assert.equal(formatManualValue("  texto  ", "text"), "texto");
    assert.equal(formatManualValue("", "currency_br"), "");
    assert.equal(formatManualValue("513415", "cbo"), "CBO\u00A05134-15");
    assert.equal(formatManualValue("66055123", "cep"), "66055-123");
    assert.equal(formatManualValue("08:30", "time_br"), "08:30");
    assert.equal(formatManualValue("25:00", "time_br"), "");
  });

  test("applyFieldMapping injeta sistema e manual, acusando obrigatórios vazios", () => {
    const mapping: TemplateFieldMapping = {
      nome: { kind: "system", key: "employee.name" },
      valor: { kind: "manual", label: "Valor do recibo", format: "currency_br", required: true },
      obs: { kind: "manual", label: "Observações", format: "text", required: false },
      "recibo.mes": { kind: "manual", label: "Mês", format: "text", required: true },
    };
    const result = applyFieldMapping({
      data: {},
      flat: { "employee.name": "Maria dos Santos" },
      mapping,
      manualValues: { valor: "220,00", "recibo.mes": "" },
    });
    assert.equal(result.data.nome, "Maria dos Santos");
    assert.equal(result.data.valor, brl(220));
    assert.equal(result.data.obs, "");
    assert.deepEqual((result.data.recibo as Record<string, unknown>).mes, "");
    assert.deepEqual(result.missingManual, ["Mês"]);
    assert.deepEqual(result.missingSystem, []);
  });

  test("applyFieldMapping bloqueia origem obrigatória do sistema vazia", () => {
    const mapping: TemplateFieldMapping = {
      cbo: { kind: "system", key: "integration.job_cbo" },
      opcional: { kind: "system", key: "integration.cct_registry", required: false },
    };
    const result = applyFieldMapping({
      data: {},
      flat: { "integration.job_cbo": "", "integration.cct_registry": "" },
      mapping,
    });
    assert.deepEqual(result.missingSystem, ["cbo"]);
  });

  test("applyFieldMapping usa defaultValue quando não informado", () => {
    const mapping: TemplateFieldMapping = {
      cidade: { kind: "manual", label: "Cidade", format: "text", required: true, defaultValue: "São Luís" },
    };
    const result = applyFieldMapping({ data: {}, flat: {}, mapping, manualValues: {} });
    assert.equal(result.data.cidade, "São Luís");
    assert.deepEqual(result.missingManual, []);
  });

  test("suggestSystemKey encontra variável por label aproximado", () => {
    assert.equal(suggestSystemKey("nome_completo"), "employee.name");
    assert.equal(suggestSystemKey("cpf"), "employee.cpf");
    assert.equal(suggestSystemKey("xyz_totalmente_desconhecido"), null);
  });
});
