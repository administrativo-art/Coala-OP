import assert from "node:assert/strict";
import test from "node:test";

import { Timestamp } from "firebase/firestore";

import { reviveFirestoreValues } from "../../src/lib/client-bootstrap";

test("bootstrap revive o marcador canônico emitido pelo servidor", () => {
  const value = reviveFirestoreValues({
    __type: "firestore-timestamp",
    seconds: 1_726_066_800,
    nanoseconds: 0,
  });

  assert.ok(value instanceof Timestamp);
  assert.equal(value.toDate().toISOString(), "2024-09-11T15:00:00.000Z");
});

test("bootstrap revive Timestamp legado gravado como mapa pelo PATCH de usuários", () => {
  const value = reviveFirestoreValues({
    employee: {
      admissionDate: {
        type: "firestore/timestamp/1.0",
        seconds: 1_726_066_800,
        nanoseconds: 0,
      },
    },
  }) as { employee: { admissionDate: Timestamp } };

  assert.ok(value.employee.admissionDate instanceof Timestamp);
  assert.equal(value.employee.admissionDate.toDate().toISOString(), "2024-09-11T15:00:00.000Z");
});

test("bootstrap não converte mapas de domínio apenas por possuírem segundos", () => {
  const source = { seconds: 30, nanoseconds: 0, label: "SLA" };

  assert.deepEqual(reviveFirestoreValues(source), source);
});
