import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailsSource = readFileSync(
  "src/features/financial/components/expenses/expense-expanded-details.tsx",
  "utf8",
);
const pageSource = readFileSync(
  "src/features/financial/pages/expenses-page.tsx",
  "utf8",
);

test("expansão da despesa segue o painel de duas colunas do handoff", () => {
  assert.match(detailsSource, /data-testid="expense-expanded-details"/);
  assert.match(detailsSource, /lg:grid-cols-\[minmax\(0,1fr\)_300px\]/);

  for (const section of [
    "Origem · NF-e",
    "Pedido vinculado",
    "Parcelas",
    "Documentos",
    "Observações",
    "Pendências de auditoria",
  ]) {
    assert.match(detailsSource, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("expansão preserva os recursos financeiros posteriores ao protótipo", () => {
  assert.match(detailsSource, /Centro de referência/);
  assert.match(detailsSource, /Rateio da DRE/);
  assert.match(detailsSource, /Individualização auditável/);
  assert.match(detailsSource, /personAllocationAnalysisLabel\(allocation\.analysisType\)/);
  assert.match(detailsSource, /allocation\.payrollDocumentId/);
  assert.match(detailsSource, /ExpenseFinancialSummary expense=\{expense\} compact/);
  assert.match(detailsSource, /relatedPurchaseExpense/);
  assert.match(detailsSource, /Finalizar auditoria/);
  assert.match(detailsSource, /Registrar pagamento/);
  assert.match(pageSource, /<ExpenseExpandedDetails/);
});
