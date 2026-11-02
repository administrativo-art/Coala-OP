import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { absenceFlowItem } from "../../src/features/documents/central/adapters/absence";
import { financialWorkItem } from "../../src/features/documents/central/adapters/financial";
import { generatedWorkItem } from "../../src/features/documents/central/adapters/generated";
import { admissionSignatureItem } from "../../src/features/documents/central/adapters/admission-signature";
import { onboardingClassificationItems, onboardingFlowItem } from "../../src/features/documents/central/adapters/onboarding";
import { centralRefKey } from "../../src/features/documents/central/types";
import { uploadOutcome } from "../../src/features/documents/central/upload-outcome";

describe("central documental", () => {
  test("assinatura admissional usa evidências registradas sem expor destinatários", () => {
    const request = { id: "request", onboardingId: "process", status: "sent", provider: "autentique", providerDocumentId: "private-provider-id", signers: [{ email: "private@example.test" }], participants: { employee: { emailDeliveredAt: "2026-11-02", signedAt: null, email: "private@example.test", signatureUrl: "private-link" } } };
    const item = admissionSignatureItem(request, { candidateName: "Pessoa" });
    assert.ok(item);
    assert.equal(item.metadata.provider, "Autentique");
    assert.match(item.detail ?? "", /1 entregas, 0 visualizações e 0 assinaturas/);
    assert.equal(JSON.stringify(item).includes("private"), false);
    assert.match(admissionSignatureItem({ ...request, participants: {} }, {})!.detail ?? "", /ainda não registrados/);
    assert.equal(admissionSignatureItem({ ...request, status: "signed" }, {}), null);
    assert.equal(admissionSignatureItem({ ...request, status: "failed" }, {})!.dimensions.signature, "failed");
  });
  test("não apresenta sugestão ou arquivamento incompleto como nome aplicado", () => {
    const destination = { downloadName: "Contrato.pdf", pathSegments: ["Contratos"] };
    assert.equal(uploadOutcome({ status: "ready", destination }).appliedName, null);
    assert.equal(uploadOutcome({ status: "filed", destination }).appliedName, null);
    assert.equal(uploadOutcome({ status: "filed", filedDocumentId: "doc-1", destination }).appliedName, "Contrato.pdf");
  });
  test("mantém identidades iguais separadas por origem", () => {
    assert.notEqual(
      centralRefKey({ source: "company", sourceId: "same-id" }),
      centralRefKey({ source: "generated", sourceId: "same-id" }),
    );
  });

  test("representa requisito admissional antes de existir arquivo", () => {
    const flow = onboardingFlowItem({
      id: "onboarding-1",
      candidateName: "Pessoa",
      status: "collecting_documents",
      currentStage: "documents",
      documents: [
        { id: "rg", label: "RG", required: true, status: "pending" },
        { id: "optional", label: "Documento opcional", required: false, status: "pending" },
      ],
    });
    assert.deepEqual(flow.missingFields, ["RG"]);
    assert.equal(flow.metadata.requirementCount, 1);
    assert.equal(flow.documentRef, null);
  });

  test("um requisito pode ter arquivo e continuar em revisão", () => {
    const items = onboardingClassificationItems({
      id: "onboarding-2",
      candidateName: "Pessoa",
      currentStage: "documents",
      documents: [
        { id: "contract", label: "Contrato", status: "review_required", filePath: "private/path.pdf" },
      ],
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].dimensions.classification, "pending");
    assert.equal(items[0].processRef?.processId, "onboarding-2");
  });

  test("assinatura concluída sai da pendência sem concluir outro fluxo", () => {
    assert.equal(generatedWorkItem({ id: "doc-1", status: "final", signatureStatus: "signed" }, "signatures"), null);
    const flow = onboardingFlowItem({
      id: "onboarding-3",
      status: "contract_pending",
      documents: [{ id: "registry", label: "Ficha de registro", required: true, status: "pending" }],
    });
    assert.equal(flow.status, "contract_pending");
    assert.deepEqual(flow.missingFields, ["Ficha de registro"]);
  });

  test("documento gerado abre a gestão detalhada sem voltar para a fila central", () => {
    const item = generatedWorkItem({ id: "doc-2", status: "review_pending" }, "preparation");
    assert.equal(item?.href, "/dashboard/documents/generated/manage?document=doc-2&tab=preparation");
  });

  test("não transforma boleto pendente em requisito documental genérico", () => {
    const item = financialWorkItem({
      id: "mail-1",
      status: "awaiting_authorization",
      subject: "Boleto",
      classification: { documentType: "charge", supplierName: "Fornecedor" },
      attachments: [],
    });
    assert.equal(item?.tab, "preparation");
    assert.deepEqual(item?.missingFields, []);
    assert.equal(item?.href, "/dashboard/financial/inbox?sourceId=mail-1");
  });

  test("ausência expõe somente metadados mínimos do comprovante", () => {
    const item = absenceFlowItem({ id: "absence-1", status: "in_review", typeName: "Ausência", beneficiaryName: "Pessoa", attachmentCount: 1 });
    assert.equal(item.metadata.documentType, "COMPROVANTE-AUSENCIA");
    assert.equal(item.detail?.includes("diagnóstico"), false);
  });
});
