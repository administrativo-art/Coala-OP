import assert from "node:assert/strict";
import test from "node:test";

import { appendCompletedQueryPage, collectCatalogPages } from "../../src/features/ai-management/bigquery-query-pages";

test("BigQuery page accumulator preserves schema and every row across pages", () => {
  const first = appendCompletedQueryPage(null, {
    jobComplete: true,
    schema: { fields: [{ name: "usage_date" }, { name: "net_cost" }] },
    rows: [{ f: [{ v: "2026-10-01" }, { v: "1" }] }],
    pageToken: "next",
  });
  const second = appendCompletedQueryPage(first, {
    jobComplete: true,
    rows: [{ f: [{ v: "2026-10-02" }, { v: "2" }] }],
  });
  assert.deepEqual(second.fieldNames, ["usage_date", "net_cost"]);
  assert.deepEqual(second.rows.map((row) => row.f?.[1]?.v), ["1", "2"]);
  assert.equal(second.nextPageToken, null);
});

test("BigQuery page accumulator rejects incomplete and inconsistent pages", () => {
  assert.throws(() => appendCompletedQueryPage(null, { jobComplete: false }), /ainda não terminou/);
  const first = appendCompletedQueryPage(null, { jobComplete: true, schema: { fields: [{ name: "net_cost" }] } });
  assert.throws(() => appendCompletedQueryPage(first, { jobComplete: true, schema: { fields: [{ name: "gross_cost" }] } }), /schemas diferentes/);
  assert.throws(() => appendCompletedQueryPage(first, { jobComplete: true, errors: [{ message: "raw provider error" }] }), /retornou erros/);
});

test("BigQuery catalog pagination reads all pages and rejects repeated token", async () => {
  const requested: Array<string | null> = [];
  const items = await collectCatalogPages(async (token) => {
    requested.push(token);
    return token === null
      ? { items: ["dataset-1"], nextPageToken: "page-2" }
      : { items: ["dataset-2"], nextPageToken: undefined };
  });
  assert.deepEqual(requested, [null, "page-2"]);
  assert.deepEqual(items, ["dataset-1", "dataset-2"]);
  await assert.rejects(
    collectCatalogPages(async () => ({ items: ["table"], nextPageToken: "same" })),
    /repetiu um token/,
  );
});
