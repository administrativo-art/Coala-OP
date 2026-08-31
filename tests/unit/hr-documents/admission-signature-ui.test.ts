import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [componentSource, routeSource] = await Promise.all([
  readFile(
    new URL("../../../src/components/hr/recruitment/recruitment-shell.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../src/app/api/hr/onboarding/[id]/signature-documents/route.ts", import.meta.url),
    "utf8",
  ),
]);

test("trata o kit como unidade com revisão única e prévia completa", () => {
  const selectionStart = componentSource.indexOf("1. Documentos do pacote");
  const trackingStart = componentSource.indexOf(
    "activePhaseId !== 'signature_preparation' ? selectedSignatureDocuments.length > 0",
  );
  assert.ok(selectionStart >= 0 && trackingStart > selectionStart);

  const selectionSource = componentSource.slice(selectionStart, trackingStart);
  assert.match(selectionSource, /selectedSignatureDocuments\.find\(document => document\.templateId === template\.id\)/);
  assert.match(selectionSource, /Visualizar/);
  assert.match(selectionSource, /Marcar pacote como revisado/);
  assert.match(selectionSource, /Gerar pacote/);
  assert.match(selectionSource, /Gerar novamente/);
  assert.match(selectionSource, /Ver pacote completo/);
  assert.match(selectionSource, /flex flex-col items-end gap-2/);
  assert.match(selectionSource, /Configurar e enviar/);
  assert.match(componentSource, /prepare_positions/);
  assert.doesNotMatch(selectionSource, /type="checkbox"/);
  assert.doesNotMatch(selectionSource, /documentId: workflowDocument\.id/);
  assert.doesNotMatch(selectionSource, /h-11 w-full/);
  assert.doesNotMatch(componentSource, /Baixar Word/);
  assert.doesNotMatch(selectionSource, /title="Atualizar documentos"/);
  assert.doesNotMatch(selectionSource, /h-10 w-full/);
  assert.doesNotMatch(componentSource, /2\. Revisão do RH/);
  assert.doesNotMatch(routeSource, /Documento não informado/);
});

test("prévia autenticada entrega o PDF gerado inline", () => {
  assert.match(componentSource, /download=preview/);
  assert.match(routeSource, /document\.get\("generatedPdfStoragePath"\)/);
  assert.match(routeSource, /preview \? "inline" : "attachment"/);
  assert.match(routeSource, /signed \|\| preview/);
});

test("prévia do pacote completo usa POST autenticado e PDF inline", () => {
  assert.match(componentSource, /body: JSON\.stringify\(\{ action: 'preview_bundle' \}\)/);
  assert.match(componentSource, /signatureScope !== 'independent'/);
  assert.match(routeSource, /previewAdmissionBundle/);
  assert.match(routeSource, /Content-Disposition": `inline/);
});

test("acompanha o kit enviado em um único card", () => {
  const trackingStart = componentSource.indexOf(
    "activePhaseId !== 'signature_preparation' ? selectedSignatureDocuments.length > 0",
  );
  const trackingEnd = componentSource.indexOf(
    "selectedSignatureDocuments.length > 0 && selectedSignatureDocuments.every",
    trackingStart,
  );
  const trackingSource = componentSource.slice(trackingStart, trackingEnd);
  assert.match(trackingSource, /Kit admissional completo/);
  assert.match(trackingSource, /uma única solicitação/);
  assert.match(trackingSource, /Visualizar pacote/);
  assert.doesNotMatch(trackingSource, /selectedSignatureDocuments\.map\(document/);
  assert.match(componentSource, /signature-documents\?package=\$\{kind\}/);
  assert.match(routeSource, /signature_bundle_\$\{id\}/);
  assert.match(routeSource, /signatureRequest\.get\("storagePath"\)/);
  assert.match(routeSource, /signatureRequest\.get\("signedStoragePath"\)/);
  assert.match(trackingSource, /signatureParticipants\.map\(participant/);
  assert.match(trackingSource, /Convite enviado/);
  assert.match(trackingSource, /E-mail entregue/);
  assert.match(trackingSource, /Documento aberto/);
  assert.match(trackingSource, /Documento assinado/);
});

test("abre editor isolado para posicionar o PDF congelado antes do envio", async () => {
  const editorSource = await readFile(
    new URL("../../../src/components/hr/recruitment/signature-placement-editor.tsx", import.meta.url),
    "utf8",
  );
  assert.match(componentSource, /dynamic\(/);
  assert.match(componentSource, /signature-placement-editor/);
  assert.match(editorSource, /package=draft/);
  assert.match(editorSource, /DndContext/);
  assert.match(editorSource, /Aplicar esta rubrica em todas as páginas/);
  assert.match(editorSource, /save_positions/);
  assert.match(editorSource, /expectedPackageHash/);
  assert.match(routeSource, /prepareAdmissionSignaturePlacement/);
  assert.match(routeSource, /saveAdmissionSignaturePlacement/);
});
