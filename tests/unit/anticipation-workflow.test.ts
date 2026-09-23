import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertMappingSave, mappingsIntersect, mappingSaveSchema } from "@/features/financial/agent/configuration";
import { anticipationAnswer, formatStoneMoney, type FinancialAgentResult } from "@/features/financial/agent/presentation";
import type { FinancialAgentMapping } from "@/features/financial/agent/contracts";

const mapping: FinancialAgentMapping = { id: "one", workspaceId: "coala", kioskId: "unit", accountId: "account", stoneCodes: ["123"],
  terminalIds: [], status: "active", validFrom: "2026-01-01", validTo: null };
const draft = { id: "one", revision: 0, kioskId: "unit", accountId: "account", stoneCodes: ["123"],
  status: "active", validFrom: "2026-01-01", validTo: null, reason: "Confirmado oficialmente" };
test("cadastro valida datas, revisão, IDs, códigos, justificativa e rejeita campos extras", () => {
  assert.equal(mappingSaveSchema.safeParse(draft).success, true);
  for (const value of [{ ...draft, validFrom: "2026-02-30" }, { ...draft, validTo: "2025-12-31" },
    { ...draft, revision: -1 }, { ...draft, kioskId: "a/b" }, { ...draft, stoneCodes: ["123", "123"] },
    { ...draft, stoneCodes: ["0123"] }, { ...draft, reason: "" }, { ...draft, workspaceId: "other" },
    { ...draft, secretReference: "secret" }]) assert.equal(mappingSaveSchema.safeParse(value).success, false);
});
test("vigências sobrepostas incluem limites, histórico inativo e código legado com zero", () => {
  assert.equal(mappingsIntersect(mapping, { ...mapping, id: "two" }), true);
  assert.equal(mappingsIntersect({ ...mapping, validTo: "2026-09-21", status: "inactive" }, { ...mapping, validFrom: "2026-09-21" }), true);
  assert.equal(mappingsIntersect({ ...mapping, validTo: "2026-09-20" }, { ...mapping, validFrom: "2026-09-21" }), false);
  assert.equal(mappingsIntersect(mapping, { ...mapping, stoneCodes: ["0123"] }), true);
  assert.equal(mappingsIntersect(mapping, { ...mapping, status: "inactive" }), false);
});
test("revisão impede sobrescrita silenciosa e limite tem sentinela", () => {
  assert.doesNotThrow(() => assertMappingSave(mapping, [], 0, null));
  assert.throws(() => assertMappingSave(mapping, [], 1, null), { code: "STONE_MAPPING_STALE" });
  assert.throws(() => assertMappingSave(mapping, [mapping], 0, 1), { code: "STONE_MAPPING_STALE" });
  assert.throws(() => assertMappingSave(mapping, [{ ...mapping, id: "other" }], 0, null), { code: "STONE_MAPPING_OVERLAP" });
  assert.throws(() => assertMappingSave(mapping, Array(100).fill(mapping), 0, null), { code: "STONE_MAPPING_LIMIT" });
});
test("valores mantêm arredondamento decimal exato, inclusive totais validados da antecipação", () => {
  assert.equal(formatStoneMoney("599.276752000000"), "R$ 599,28");
  assert.equal(formatStoneMoney("3.536948000000"), "R$ 3,54");
  assert.equal(formatStoneMoney("1.005000000000"), "R$ 1,01");
  assert.equal(formatStoneMoney("-1.005"), "-R$ 1,01");
  assert.equal(formatStoneMoney(null), "Não informado");
  assert.equal(formatStoneMoney("0.000000000000"), "R$ 0,00");
});
test("respostas guiadas preservam pendências e não afirmam saldo futuro nem deduzem taxa novamente", () => {
  const result = { evidence: { conclusion: "Há dados pendentes.", summary: { earlyCount: 46, pendingCount: 1,
    gross: "616.5", paidNet: "599.276752", mdr: "13.6863", anticipationFee: null } } } as FinancialAgentResult;
  assert.match(anticipationAnswer(result, "fees"), /Não informado/);
  assert.match(anticipationAnswer(result, "fees"), /não desconte as taxas novamente/);
  assert.match(anticipationAnswer(result, "future"), /não apura o saldo restante/);
  assert.match(anticipationAnswer(result, "summary"), /Há dados pendentes/);
  assert.match(anticipationAnswer(result, "installments"), /1 vínculo\(s\) pendente/);
  result.evidence.quality = "empty_file_not_proof_of_absence";
  assert.match(anticipationAnswer(result, "fees"), /Não há base suficiente/);
  assert.doesNotMatch(anticipationAnswer(result, "fees"), /R\$/);
});
test("tela usa transporte autenticado e consulta guiada, sem polling, pagamentos ou texto livre como comando", () => {
  const source = readFileSync(new URL("../../src/features/financial/agent/anticipation-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /useAuthenticatedApi/);
  assert.match(source, /intent: "review_anticipations"/);
  assert.match(source, /response\.scope\.accountId !== mapping!\.accountId/);
  assert.match(source, /Conferi unidade, StoneCodes, conta e vigência em fonte oficial/);
  assert.doesNotMatch(source, /setInterval|onSnapshot|fetch\(/);
  const page = readFileSync(new URL("../../src/features/financial/pages/stone-anticipations-page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(!isDefaultAdmin\)/);
  assert.match(page, /PageContainer variant="wide"/);
});

test("cadastro manual de conta grava workspace e não reassocia conta de outro workspace", () => {
  const source = readFileSync(new URL("../../src/features/financial/components/settings/bank-accounts-management.tsx", import.meta.url), "utf8");
  assert.match(source, /editTarget\.workspaceId !== WORKSPACE_ID/);
  assert.match(source, /workspaceId: WORKSPACE_ID/);
  assert.ok(source.indexOf("editTarget.workspaceId !== WORKSPACE_ID") < source.indexOf("await updateDoc(financialDoc(\"bankAccounts\""));
});
