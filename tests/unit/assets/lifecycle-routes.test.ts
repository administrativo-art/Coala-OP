import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const movements = readFileSync("src/app/api/assets/[assetId]/movements/route.ts", "utf8");
const transfers = readFileSync("src/app/api/assets/[assetId]/custody-transfers/route.ts", "utf8");
const assetDetail = readFileSync("src/app/api/assets/[assetId]/route.ts", "utf8");
const assets = readFileSync("src/app/api/assets/route.ts", "utf8");
const transferList = readFileSync("src/app/api/assets/[assetId]/custody-transfers/list/route.ts", "utf8");
const termFile = readFileSync("src/app/api/assets/[assetId]/custody-transfers/[transferId]/term/file/route.ts", "utf8");

test("movimentação e transferência de posse têm rotas seguras e transacionais separadas", () => {
  assert.match(movements, /export const POST = secureRoute/);
  assert.match(transfers, /export const POST = secureRoute/);
  assert.match(movements, /type: "MOVIMENTACAO"/);
  assert.match(transfers, /type: "TRANSFERENCIA_POSSE"/);
  assert.match(movements, /runTransaction/);
  assert.match(transfers, /runTransaction/);
  assert.match(movements, /expectedVersion/);
  assert.match(transfers, /expectedVersion/);
});

test("ator autenticado e executor informado são persistidos separadamente", () => {
  assert.match(movements, /actor: \{ userId: actor\.userDoc\.id/);
  assert.match(movements, /performedBy: resolvedPerformer/);
  assert.match(transfers, /actor: \{ userId: actor\.userDoc\.id/);
  assert.match(transfers, /performedBy: resolvedPerformer/);
});

test("termo fica somente pendente e fluxo legado não contorna as rotas novas", () => {
  assert.match(transfers, /term_generation_pending/);
  assert.doesNotMatch(transfers, /Autentique|generatedDocuments|createDocument/);
  assert.match(assetDetail, /Use a rota de movimentação com versão esperada/);
  assert.match(assetDetail, /Escolha Registrar movimentação ou Transferir posse/);
});

test("cadastro nasce sob propriedade e posse da empresa e aquisição vinculada é imutável no PATCH genérico", () => {
  assert.match(assets, /ownershipRegime: "owned"/);
  assert.match(assets, /companyCustody\(now, movementReference\.id\)/);
  assert.match(assetDetail, /changedPurchaseLinkedFields/);
  assert.match(assetDetail, /Dados de aquisição vinculados à compra são somente leitura/);
});

test("trilha e PDF do termo exigem histórico, workspace e não expõem caminhos internos", () => {
  assert.match(transferList, /export const GET = secureRoute/);
  assert.match(transferList, /assets\.view-history/);
  assert.match(transferList, /actor: item\.actor \? \{ nameSnapshot:/);
  assert.doesNotMatch(transferList, /providerDocumentId:/);
  assert.doesNotMatch(transferList, /pdfStoragePath:/);
  assert.match(termFile, /export const GET = secureRoute/);
  assert.match(termFile, /document\.get\("sourceAssetId"\) !== assetId/);
  assert.match(termFile, /actor\.workspace_id !== resource\.workspaceId/);
  assert.match(termFile, /Cache-Control": "private, no-store"/);
});
