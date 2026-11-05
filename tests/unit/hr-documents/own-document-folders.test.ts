import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { groupOwnDocumentsByFolder, ownDocumentFolderPath } from "../../../src/features/hr/documents/own-document-folders";

const base = {
  category: "contracts",
  destinationTrail: [] as string[],
  publishedAt: "2026-10-27T12:00:00.000Z",
};

describe("pasta própria de documentos", () => {
  test("organiza prestação PJ em contrato principal e aditivos, sem usar Admissão", () => {
    const folders = groupOwnDocumentsByFolder([
      { ...base, id: "pj", documentType: "Contrato de prestação de serviços PJ", documentTypeCode: "SERVICE_PROVIDER_CONTRACT_PJ" },
      { ...base, id: "addendum", documentType: "Aditivo ao contrato de prestação de serviços PJ", documentTypeCode: "SERVICE_PROVIDER_CONTRACT_ADDENDUM" },
      { ...base, id: "pf", documentType: "Contrato de prestação de serviços PF", documentTypeCode: "SERVICE_PROVIDER_CONTRACT_PF" },
    ]);

    assert.deepEqual(folders.map((folder) => folder.path), [
      ["Contratos", "Histórico PF", "Contrato principal"],
      ["Contratos", "Prestação de serviços PJ", "Aditivos"],
      ["Contratos", "Prestação de serviços PJ", "Contrato principal"],
    ]);
    assert.equal(folders.some((folder) => folder.path.includes("Admissão")), false);
  });

  test("respeita movimentação visual sem alterar a classificação do documento", () => {
    assert.deepEqual(ownDocumentFolderPath({
      ...base,
      id: "custom",
      documentType: "Contrato de trabalho",
      documentTypeCode: "EMPLOYMENT_CONTRACT",
      archivePath: ["Contratos", "Arquivo histórico"],
    }), ["Contratos", "Arquivo histórico"]);
  });

  test("admissão consolida perfis legados e documentos na raiz da categoria", () => {
    const folders = groupOwnDocumentsByFolder([{
      ...base,
      id: "probation",
      category: "admission",
      documentType: "Contrato de experiência",
      documentTypeCode: "PROBATION_CONTRACT",
    }], [
      { id: "legacy-main", category: "admission", path: ["Contrato", "Contrato principal"], employeeVisible: true },
      { id: "legacy-probation", category: "admission", path: ["Contrato", "Experiência e prorrogações"], employeeVisible: true },
    ]);
    assert.deepEqual(folders.filter((folder) => folder.path[0] === "Admissão").map((folder) => folder.path), [["Admissão"]]);
    assert.equal(folders.find((folder) => folder.path[0] === "Admissão")?.documents.length, 1);
  });
});
