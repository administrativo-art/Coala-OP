import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { serializedTimestampParts } from "../../src/lib/firestore-serialized-timestamp";

test("reconhece a data do Firestore serializada pelo navegador e pelo Admin SDK", () => {
  assert.deepEqual(
    serializedTimestampParts({ seconds: 1726066800, nanoseconds: 0, type: "firestore/timestamp/1.0" }),
    { seconds: 1726066800, nanoseconds: 0 },
  );
  assert.deepEqual(serializedTimestampParts({ _seconds: 10, _nanoseconds: 5 }), { seconds: 10, nanoseconds: 5 });
});

test("não confunde outros objetos com data", () => {
  assert.equal(serializedTimestampParts({ seconds: 10, nanoseconds: 0, label: "x" }), null);
  assert.equal(serializedTimestampParts({ seconds: "10", nanoseconds: 0 }), null);
  assert.equal(serializedTimestampParts({ seconds: 10, nanoseconds: 0, type: "outro" }), null);
  assert.equal(serializedTimestampParts("2026-07-01"), null);
  assert.equal(serializedTimestampParts(null), null);
});

test("a edição de usuário converte a data serializada antes de gravar", () => {
  const route = readFileSync("src/app/api/users/[userId]/route.ts", "utf8");
  assert.match(route, /serializedTimestampParts\(value\)/);
  assert.match(route, /return new Timestamp\(timestamp\.seconds, timestamp\.nanoseconds\)/);
});
