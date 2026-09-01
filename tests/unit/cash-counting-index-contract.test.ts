import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type IndexDefinition = {
  collectionGroup?: string;
  queryScope?: string;
  fields?: Array<{ fieldPath?: string; order?: string }>;
};

test("paginação dos operadores da sessão possui o índice exigido em produção", () => {
  const config = JSON.parse(readFileSync("firestore.financial.indexes.json", "utf8")) as {
    indexes?: IndexDefinition[];
  };
  const expectedFields = [
    { fieldPath: "finalizedAt", order: "DESCENDING" },
    { fieldPath: "__name__", order: "ASCENDING" },
  ];
  const index = config.indexes?.find((candidate) => (
    candidate.collectionGroup === "operators"
    && candidate.queryScope === "COLLECTION"
    && JSON.stringify(candidate.fields) === JSON.stringify(expectedFields)
  ));

  assert.ok(index, "índice de paginação de cashCountingSessions/{id}/operators ausente");
});

test("fila de composição física possui índices limitados por status, responsável e antiguidade", () => {
  const config = JSON.parse(readFileSync("firestore.financial.indexes.json", "utf8")) as {
    indexes?: IndexDefinition[];
  };
  const expectedVariants = [
    [
      { fieldPath: "workspaceId", order: "ASCENDING" },
      { fieldPath: "status", order: "ASCENDING" },
      { fieldPath: "updatedAt", order: "ASCENDING" },
    ],
    [
      { fieldPath: "workspaceId", order: "ASCENDING" },
      { fieldPath: "status", order: "ASCENDING" },
      { fieldPath: "openedBy", order: "ASCENDING" },
      { fieldPath: "updatedAt", order: "ASCENDING" },
    ],
  ];

  for (const expectedFields of expectedVariants) {
    const index = config.indexes?.find((candidate) => (
      candidate.collectionGroup === "cashCountingSessions"
      && candidate.queryScope === "COLLECTION"
      && JSON.stringify(candidate.fields) === JSON.stringify(expectedFields)
    ));
    assert.ok(index, `índice da fila de composição ausente: ${JSON.stringify(expectedFields)}`);
  }
});

test("preflight paginado de sessões abertas possui índice por identificador", () => {
  const config = JSON.parse(readFileSync("firestore.financial.indexes.json", "utf8")) as {
    indexes?: IndexDefinition[];
  };
  const expectedFields = [
    { fieldPath: "workspaceId", order: "ASCENDING" },
    { fieldPath: "status", order: "ASCENDING" },
    { fieldPath: "__name__", order: "ASCENDING" },
  ];
  const index = config.indexes?.find((candidate) => (
    candidate.collectionGroup === "cashCountingSessions"
    && candidate.queryScope === "COLLECTION"
    && JSON.stringify(candidate.fields) === JSON.stringify(expectedFields)
  ));

  assert.ok(index, "índice paginado do preflight de sessões abertas ausente");
});
