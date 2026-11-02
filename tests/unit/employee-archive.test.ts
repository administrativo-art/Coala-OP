import assert from "node:assert/strict";
import test from "node:test";
import { employeeArchiveChildFolders, employeeArchiveIds, groupSignedAdmissionReferences } from "../../src/lib/documents/employee-archive";

test("consulta apenas os identificadores explicitamente vinculados e elimina duplicados", () => {
  assert.deepEqual(employeeArchiveIds({ id: "auth-1", hrEmployeeId: "rh-2", registrationIdBizneo: "rh-2" }), ["auth-1", "rh-2"]);
  assert.deepEqual(employeeArchiveIds({ id: "auth-1", hrEmployeeId: "  ", registrationIdBizneo: null }), ["auth-1"]);
});

test("agrupar cópias do mesmo Kit preserva referências e busca por nomes originais", () => {
  const base = { employeeId: "person", source: "autentique_signature", documentTypeCode: "ADMISSION_PACKAGE", contentHash: "a".repeat(64), signatureRequestId: "bundle", sourceOnboardingId: "onboarding", mimeType: "application/pdf", size: 100, category: "admission", accessLevel: "restricted" };
  const files = [{ ...base, id: "b", originalName: "Termo.pdf" }, { ...base, id: "a", originalName: "Contrato.pdf" }];
  const result = groupSignedAdmissionReferences(files);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "a");
  assert.deepEqual(result[0].archiveReferences, ["a", "b"]);
  assert.deepEqual(result[0].archiveSourceNames, ["Contrato.pdf", "Termo.pdf"]);
  assert.equal(files.length, 2);
  for (const change of [{ employeeId: "other" }, { publication: { status: "published" } }, { contentHash: "b".repeat(64) }, { documentTypeCode: "UNKNOWN_DOCUMENT" }, { destinationTrail: ["Exceção"] }, { status: "rejected" }, { version: 2 }]) assert.equal(groupSignedAdmissionReferences([files[0], { ...files[1], ...change }]).length, 2);
});

test("árvore combina pastas vazias do perfil e arquivos sem misturar caminhos de outros ramos", () => {
  const paths = [["Identificação", "Documentos pessoais"], ["Identificação", "Dados bancários"], ["Documentos gerados"], ["Identificação", "Documentos pessoais", "CPF"]];
  assert.deepEqual(employeeArchiveChildFolders(paths, []), ["Identificação", "Documentos gerados"]);
  assert.deepEqual(employeeArchiveChildFolders(paths, ["Identificação"]), ["Documentos pessoais", "Dados bancários"]);
  assert.deepEqual(employeeArchiveChildFolders(paths, ["Documentos gerados"]), []);
});
