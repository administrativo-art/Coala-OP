import assert from "node:assert/strict";
import test from "node:test";

import { admissionClosingComponentsSummary } from "../../../src/features/hr/documents/admission-closing-term";

test("termo de encerramento reflete somente os componentes reais e suas páginas", () => {
  assert.equal(admissionClosingComponentsSummary([
    { title: "Contrato de experiência", startPage: 1, endPage: 3 },
    { title: "Banco de horas", startPage: 4, endPage: 4 },
  ]), "1. Contrato de experiência (págs. 1–3);\n2. Banco de horas (pág. 4);");
});

test("termo de encerramento não aceita lista vazia", () => {
  assert.throws(() => admissionClosingComponentsSummary([]), /ao menos um componente/);
});
