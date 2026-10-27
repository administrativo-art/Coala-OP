import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { groupOwnDocumentsByFolder } from "../../../src/features/hr/documents/own-document-folders";

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
});
