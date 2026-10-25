import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("confirmação de despacho aguarda a operação e torna a falha visível", () => {
  const source = readFileSync("src/components/reposition-management.tsx", "utf8");

  assert.match(source, /onConfirmDispatch: \([^;]+\) => Promise<void>/);
  assert.match(source, /await onConfirmDispatch\(/);
  assert.match(source, /loading=\{dispatching\}/);
  assert.match(source, /loadingLabel="Confirmando despacho…"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /dispatchBlockedReason/);
});
