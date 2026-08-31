import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../../src/features/hr/documents/signature-workflow.server.ts", import.meta.url),
  "utf8",
);

test("servidor trata seleção, geração, prévia, revisão e envio como pacote indivisível", () => {
  const validations = source.match(/assertCompleteAdmissionPackage\(/g) ?? [];
  assert.ok(validations.length >= 7);
  assert.match(source, /export async function reviewSignaturePackage/);
  assert.match(source, /const batch = hrDbAdmin\.batch\(\)/);
  assert.match(source, /Revise o pacote completo antes de enviar para assinatura/);
  assert.match(source, /Defina o signatário documental da empresa/);
  assert.match(source, /autentiquePositionsForParty\(layout, signer\.party\)/);
  assert.doesNotMatch(source, /companyDocumentTemplates/);
});

test("congela o PDF antes do editor e vincula posições ao hash do pacote", () => {
  assert.match(source, /export async function prepareAdmissionSignaturePlacement/);
  assert.match(source, /status: "placement_pending"/);
  assert.match(source, /placementLayout: defaultAdmissionSignatureLayout/);
  assert.match(source, /export async function saveAdmissionSignaturePlacement/);
  assert.match(source, /normalizeAdmissionSignatureLayout\(params\.layout\)/);
  assert.match(source, /layout\.packageHash !== packageHash/);
  assert.match(source, /hashBuffer\(buffer\) !== packageHash/);
  assert.match(source, /const claimed = await hrDbAdmin\.runTransaction/);
  assert.match(source, /sendingStartedAt/);
  const sendStart = source.indexOf("async function sendAdmissionBundle");
  const prepareStart = source.indexOf("async function prepareAdmissionBundle", sendStart);
  const sendSource = source.slice(sendStart, prepareStart);
  assert.doesNotMatch(sendSource, /composeDocumentPackage/);
  assert.doesNotMatch(sendSource, /prepareAdmissionBundle/);
});

test("prévia completa reutiliza o compositor do envio e exclui aceite independente", () => {
  assert.match(source, /export async function previewAdmissionBundle/);
  assert.match(source, /document\.get\("signatureScope"\) !== "independent"/);
  assert.match(source, /const prepared = await prepareAdmissionBundle/);
  assert.match(source, /protocol: "ADM-PRÉVIA"/);
  assert.match(
    source,
    /where\("onboardingId", "==", params\.onboardingId\)\s+\.limit\(30\)\s+\.get\(\)/,
  );
});

test("reconcilia uma vez por solicitação do pacote", () => {
  assert.match(source, /const requests = new Map<string/);
  assert.match(source, /for \(const request of requests\.values\(\)\)/);
  assert.match(source, /checked: requests\.size/);
  assert.doesNotMatch(source, /checked: targets\.length/);
  assert.match(source, /participantsFromProvider/);
  assert.match(source, /getAutentiqueDocumentSignatures\(request\.providerDocumentId\)/);
});

test("permite recuperar pacote já enviado incluindo o signatário corporativo", () => {
  assert.match(source, /export async function addCompanySignerToAdmissionBundle/);
  assert.match(source, /await addAutentiqueSigner\(\{ documentId: providerDocumentId, signer \}\)/);
  assert.match(source, /status: "adding"/);
  assert.match(source, /status: "completed"/);
  assert.match(source, /provider\.signatures\.some/);
});
