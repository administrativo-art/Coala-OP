import assert from "node:assert/strict";
import test from "node:test";

import PizZip from "pizzip";

import {
  canTransitionGeneratedDocument,
  isSignatureTerminal,
} from "../../../src/features/hr/documents/document-lifecycle";
import { formatDocumentOutput } from "../../../src/features/hr/documents/document-output-formatters";
import { validateDocxForLetterhead } from "../../../src/features/hr/documents/docx-template-validation";
import { formatDocumentProtocol } from "../../../src/features/hr/documents/document-protocol";

function docx(sectionProperties: string) {
  const zip = new PizZip();
  zip.file("word/document.xml", `<w:document xmlns:w="x"><w:body><w:p/><w:sectPr>${sectionProperties}</w:sectPr></w:body></w:document>`);
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

test("mantém estados documentais e de assinatura separados", () => {
  assert.equal(canTransitionGeneratedDocument("draft", "review_pending"), true);
  assert.equal(canTransitionGeneratedDocument("draft", "final"), false);
  assert.equal(canTransitionGeneratedDocument("final", "draft"), false);
  assert.equal(isSignatureTerminal("rejected"), true);
  assert.equal(isSignatureTerminal("expired"), true);
  assert.equal(isSignatureTerminal("viewed"), false);
});

test("formata moeda também por extenso e permite mascarar CPF", () => {
  assert.equal(
    formatDocumentOutput(1518, "currency_br_with_words"),
    "R$ 1.518,00 (mil quinhentos e dezoito reais)",
  );
  assert.equal(formatDocumentOutput("12345678901", "cpf_masked"), "***.456.789-**");
  assert.equal(formatDocumentOutput("2026-07-28", "date_long_br"), "28 de julho de 2026");
});

test("valida a área segura do papel timbrado por seção", () => {
  const valid = validateDocxForLetterhead(docx(
    '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:bottom="1440"/>',
  ));
  assert.equal(valid.valid, true);

  const invalid = validateDocxForLetterhead(docx(
    '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="200" w:bottom="200"/>',
  ));
  assert.equal(invalid.valid, false);
  assert.deepEqual(
    invalid.issues.map((issue) => issue.code).sort(),
    ["BOTTOM_SAFE_AREA", "ORIENTATION", "PAGE_SIZE", "TOP_SAFE_AREA"],
  );
});

test("gera protocolo humano estável", () => {
  assert.equal(
    formatDocumentProtocol({ entity: "Coala Shakes", type: "CTR", year: 2026, sequence: 42 }),
    "COAL-CTR-2026-000042",
  );
});
