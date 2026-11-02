import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeUploadCursor, encodeUploadCursor } from "../../src/features/documents/central/pagination";

test("cursor preserva a posição de lote e item para datas empatadas", () => {
  const position = { batch: "batch-1", item: "item-2" };
  assert.deepEqual(decodeUploadCursor(encodeUploadCursor(position)), position);
  assert.deepEqual(decodeUploadCursor(encodeUploadCursor({ batch: "batch-1" })), { batch: "batch-1" });
  assert.equal(decodeUploadCursor(), null);
});

test("cursor rejeita caminho, formato inválido e campos não permitidos", () => {
  for (const value of [{ batch: "other/path" }, { batch: "" }, { batch: "valid", extra: "field" }]) {
    const cursor = Buffer.from(JSON.stringify(value)).toString("base64url");
    assert.throws(() => decodeUploadCursor(cursor));
  }
  assert.throws(() => decodeUploadCursor("not-json"));
  assert.throws(() => decodeUploadCursor("x".repeat(1501)));
});
