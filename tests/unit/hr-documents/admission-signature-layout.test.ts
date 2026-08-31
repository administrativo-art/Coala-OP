import assert from "node:assert/strict";
import test from "node:test";

import {
  admissionSignatureLayoutSchema,
  autentiquePositionsForParty,
  defaultAdmissionSignatureLayout,
  moveAdmissionSignaturePlacement,
} from "../../../src/features/hr/documents/admission-signature-layout";

const packageHash = "a".repeat(64);

test("cria rubricas das duas partes em todas as páginas e assinaturas na última", () => {
  const layout = defaultAdmissionSignatureLayout({ packageHash, pageCount: 3 });
  assert.equal(layout.positions.filter((position) => position.element === "INITIALS").length, 6);
  assert.deepEqual(
    layout.positions
      .filter((position) => position.element === "SIGNATURE")
      .map((position) => [position.party, position.page]),
    [["employee", 3], ["company", 3]],
  );
});

test("replica a coordenada de uma rubrica sem alterar a assinatura", () => {
  const original = defaultAdmissionSignatureLayout({ packageHash, pageCount: 3 });
  const moved = moveAdmissionSignaturePlacement({
    layout: original,
    party: "employee",
    element: "INITIALS",
    page: 2,
    x: 21.26,
    y: 32.84,
    repeatInitials: true,
  });
  assert.deepEqual(
    moved.positions
      .filter((position) => position.party === "employee" && position.element === "INITIALS")
      .map(({ page, x, y }) => ({ page, x, y })),
    [
      { page: 1, x: 21.3, y: 32.8 },
      { page: 2, x: 21.3, y: 32.8 },
      { page: 3, x: 21.3, y: 32.8 },
    ],
  );
  assert.equal(
    moved.positions.find((position) => position.party === "employee" && position.element === "SIGNATURE")?.x,
    16,
  );
});

test("converte somente os campos da parte para as coordenadas da Autentique", () => {
  const layout = defaultAdmissionSignatureLayout({ packageHash, pageCount: 2 });
  const positions = autentiquePositionsForParty(layout, "company");
  assert.equal(positions.length, 3);
  assert.deepEqual(positions.map((position) => position.z), [1, 2, 2]);
  assert.ok(positions.every((position) => position.x.includes(".")));
});

test("rejeita layout sem rubrica em todas as páginas", () => {
  const layout = defaultAdmissionSignatureLayout({ packageHash, pageCount: 2 });
  const invalid = {
    ...layout,
    positions: layout.positions.filter((position) => !(
      position.party === "company"
      && position.element === "INITIALS"
      && position.page === 1
    )),
  };
  assert.equal(admissionSignatureLayoutSchema.safeParse(invalid).success, false);
});
