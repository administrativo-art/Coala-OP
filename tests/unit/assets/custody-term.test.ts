import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assetCustodyTermPdfInputSchema, renderAssetCustodyTermPdf, safeAssetCustodyTermText } from "../../../src/features/assets/custody-term-pdf";
import { SYSTEM_DOCUMENT_TEMPLATES } from "../../../src/features/hr/documents/system-template-catalog";
import { resolvePublicationPolicy } from "../../../src/lib/hr/employee-document-publication";

const input = {
  protocol: "CT-PAT-2026-000001",
  issuedAt: "2026-10-30T12:00:00.000-03:00",
  effectiveAt: "2026-10-30T11:00:00.000-03:00",
  company: { legalName: "CT Sorvetes Ltda.", cnpj: "00.000.000/0001-00" },
  employee: { name: "Pessoa Colaboradora" },
  asset: { code: "PAT-000001", name: "Celular corporativo", brand: "Samsung", model: "Galaxy" },
  condition: "Novo e funcionando",
  accessories: ["Carregador"],
};

test("catálogo registra termo patrimonial contextual, timbrado e independente", () => {
  const template = SYSTEM_DOCUMENT_TEMPLATES.find((item) => item.id === "system-asset-custody-term");
  assert.equal(template?.sourceModule, "assets");
  assert.equal(template?.generationMode, "contextual");
  assert.equal(template?.letterheadVersion, "coala-letterhead-v2");
  assert.equal(template?.signatureScope, "independent");
  assert.equal(template?.retentionPolicyId, "employment_plus_5y");
  assert.deepEqual(resolvePublicationPolicy("ASSET_CUSTODY_TERM"), { mode: "automatic", trigger: "signed" });
});

test("renderer usa allowlist estrita e omite campos sensíveis em texto livre", async () => {
  assert.equal(assetCustodyTermPdfInputSchema.safeParse({ ...input, imei: "123" }).success, false);
  assert.equal(assetCustodyTermPdfInputSchema.safeParse({ ...input, employee: { ...input.employee, phone: "9999" } }).success, false);
  assert.equal(safeAssetCustodyTermText("IMEI 123456789012345"), "[dado omitido]");
  assert.equal(safeAssetCustodyTermText("98987846117"), "[dado omitido]");
  assert.equal(safeAssetCustodyTermText("senha: abc"), "[dado omitido]");
  const pdf = await renderAssetCustodyTermPdf(input);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});

test("rota é segura e serviço mantém idempotência, recuperação e metadados de origem", () => {
  const route = readFileSync("src/app/api/assets/[assetId]/custody-transfers/[transferId]/term/route.ts", "utf8");
  const service = readFileSync("src/features/assets/custody-term.server.ts", "utf8");
  assert.match(route, /export const POST = secureRoute/);
  assert.match(route, /assets\.transfer/);
  assert.match(service, /allocateIdempotentDocumentProtocol/);
  assert.match(service, /asset_custody_term_/);
  assert.match(service, /generatedId\(params\.transferId\)/);
  assert.match(service, /sourceAssetId/);
  assert.match(service, /sourceCustodyTransferId/);
  assert.match(service, /term_generation_failed/);
  assert.match(service, /createFailureTask/);
  assert.match(service, /currentStatus === "signed"/);
  assert.match(service, /ASSET_CUSTODY_TERM_RESEND_REQUIRED/);
});

test("webhook arquiva, projeta o processo e a publicação guarda a origem patrimonial", () => {
  const webhook = readFileSync("src/app/api/webhooks/autentique/route.ts", "utf8");
  const workflow = readFileSync("src/features/hr/documents/signature-workflow.server.ts", "utf8");
  assert.match(webhook, /archiveAndProjectAssetCustodyTerm/);
  assert.match(webhook, /projectAssetCustodyTermSignature/);
  assert.match(webhook, /export const POST = secureRoute/);
  assert.match(workflow, /sourceAssetId: generated\.get\("sourceAssetId"\)/);
  assert.match(workflow, /sourceCustodyTransferId: generated\.get\("sourceCustodyTransferId"\)/);
  assert.match(workflow, /autoPublishDocument\(archivedDocumentId, "signed"\)/);
});
