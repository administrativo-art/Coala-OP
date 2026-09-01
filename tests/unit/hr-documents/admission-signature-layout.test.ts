import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMISSION_INITIALS_X,
  addAdmissionSignaturePlacement,
  admissionSignatureLayoutSchema,
  autentiquePositionsForParty,
  canRemoveAdmissionSignaturePlacement,
  defaultAdmissionSignatureLayout,
  moveAdmissionSignaturePlacement,
  normalizeAdmissionSignatureLayout,
  removeAdmissionSignaturePlacement,
} from "../../../src/features/hr/documents/admission-signature-layout";

const packageHash = "a".repeat(64);

test("cria rubricas laterais lado a lado em todas as páginas e assinaturas na última", () => {
  const layout = defaultAdmissionSignatureLayout({ packageHash, pageCount: 3 });
  assert.equal(layout.positions.filter((position) => position.element === "INITIALS").length, 6);
  assert.deepEqual(
    layout.positions
      .filter((position) => position.element === "INITIALS" && position.page === 1)
      .map((position) => [position.party, position.x, position.y]),
    [
      ["employee", ADMISSION_INITIALS_X.employee, 79],
      ["company", ADMISSION_INITIALS_X.company, 79],
    ],
  );
  assert.deepEqual(
    layout.positions
      .filter((position) => position.element === "SIGNATURE")
      .map((position) => [position.party, position.page]),
    [["employee", 3], ["company", 3]],
  );
  assert.ok(layout.positions.every((position) => position.id.length > 0));
});

test("move as rubricas como um par lateral sem alterar assinaturas", () => {
  const original = defaultAdmissionSignatureLayout({ packageHash, pageCount: 3 });
  const selected = original.positions.find((position) => (
    position.party === "employee" && position.element === "INITIALS" && position.page === 2
  ));
  assert.ok(selected);
  const moved = moveAdmissionSignaturePlacement({
    layout: original,
    placementId: selected.id,
    x: 21.26,
    y: 32.84,
    repeatInitials: true,
  });
  assert.deepEqual(
    moved.positions
      .filter((position) => position.element === "INITIALS")
      .map(({ party, page, x, y }) => ({ party, page, x, y })),
    [
      { party: "employee", page: 1, x: ADMISSION_INITIALS_X.employee, y: 32.8 },
      { party: "company", page: 1, x: ADMISSION_INITIALS_X.company, y: 32.8 },
      { party: "employee", page: 2, x: ADMISSION_INITIALS_X.employee, y: 32.8 },
      { party: "company", page: 2, x: ADMISSION_INITIALS_X.company, y: 32.8 },
      { party: "employee", page: 3, x: ADMISSION_INITIALS_X.employee, y: 32.8 },
      { party: "company", page: 3, x: ADMISSION_INITIALS_X.company, y: 32.8 },
    ],
  );
  assert.equal(
    moved.positions.find((position) => position.party === "employee" && position.element === "SIGNATURE")?.x,
    16,
  );
});

test("aceita assinaturas extras do mesmo signatário e envia todas à Autentique", () => {
  const original = defaultAdmissionSignatureLayout({ packageHash, pageCount: 2 });
  const withExtra = addAdmissionSignaturePlacement({
    layout: original,
    party: "employee",
    element: "SIGNATURE",
    page: 1,
  });
  const employeeSignatures = withExtra.positions.filter((position) => (
    position.party === "employee" && position.element === "SIGNATURE"
  ));
  assert.equal(employeeSignatures.length, 2);
  assert.equal(new Set(employeeSignatures.map((position) => position.id)).size, 2);
  assert.equal(admissionSignatureLayoutSchema.safeParse(withExtra).success, true);
  assert.equal(
    autentiquePositionsForParty(withExtra, "employee").filter((position) => position.element === "SIGNATURE").length,
    2,
  );
});

test("permite remover rubricas individualmente sem recriar o campo removido", () => {
  const original = defaultAdmissionSignatureLayout({ packageHash, pageCount: 2 });
  const rubric = original.positions.find((position) => (
    position.party === "company" && position.element === "INITIALS" && position.page === 1
  ));
  assert.ok(rubric);
  const withoutRubric = removeAdmissionSignaturePlacement({
    layout: original,
    placementId: rubric.id,
  });
  assert.equal(withoutRubric.positions.some((position) => position.id === rubric.id), false);
  assert.equal(admissionSignatureLayoutSchema.safeParse(withoutRubric).success, true);
});

test("impede remover a última assinatura obrigatória de cada signatário", () => {
  const layout = defaultAdmissionSignatureLayout({ packageHash, pageCount: 2 });
  const signature = layout.positions.find((position) => (
    position.party === "employee" && position.element === "SIGNATURE"
  ));
  assert.ok(signature);
  assert.equal(canRemoveAdmissionSignaturePlacement(layout, signature.id), false);
  assert.equal(
    removeAdmissionSignaturePlacement({ layout, placementId: signature.id }),
    layout,
  );
});

test("normaliza layouts legados sem identificadores e mantém compatibilidade de leitura", () => {
  const legacy = {
    schemaVersion: 1,
    packageHash,
    pageCount: 1,
    positions: [
      { party: "employee", element: "INITIALS", page: 1, x: 5, y: 55 },
      { party: "company", element: "INITIALS", page: 1, x: 82, y: 75 },
      { party: "employee", element: "SIGNATURE", page: 1, x: 16, y: 84 },
      { party: "company", element: "SIGNATURE", page: 1, x: 62, y: 84 },
    ],
  };
  const normalized = normalizeAdmissionSignatureLayout(legacy);
  const initials = normalized.positions.filter((position) => position.element === "INITIALS");
  assert.ok(normalized.positions.every((position) => position.id.length > 0));
  assert.deepEqual(initials.map(({ x, y }) => ({ x, y })), [
    { x: ADMISSION_INITIALS_X.employee, y: 55 },
    { x: ADMISSION_INITIALS_X.company, y: 55 },
  ]);
});

test("rejeita layout sem a assinatura obrigatória de uma das partes", () => {
  const layout = defaultAdmissionSignatureLayout({ packageHash, pageCount: 2 });
  const invalid = {
    ...layout,
    positions: layout.positions.filter((position) => !(
      position.party === "company" && position.element === "SIGNATURE"
    )),
  };
  assert.equal(admissionSignatureLayoutSchema.safeParse(invalid).success, false);
});
