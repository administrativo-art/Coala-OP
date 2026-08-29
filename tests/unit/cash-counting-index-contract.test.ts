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
