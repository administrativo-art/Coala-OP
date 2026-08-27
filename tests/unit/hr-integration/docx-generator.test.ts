import assert from "node:assert/strict";
import { describe, it } from "node:test";
import PizZip from "pizzip";

import { extractDocxVariables, generateDocx, normalizeDocxTemplateXml, replaceDocxTextWithVariable } from "../../../src/features/hr/documents/docx-generator";

function fixture() {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.folder("word")?.file("document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{{employee.</w:t></w:r><w:r><w:t>name}}</w:t></w:r></w:p><w:p><w:r><w:t>{{#if employee.has_vt}}</w:t></w:r></w:p><w:p><w:r><w:t>VT: {{employee.vt_daily_value}}</w:t></w:r></w:p><w:p><w:r><w:t>{{/if}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
  zip.folder("word")?.folder("_rels")?.file("document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

describe("gerador DOCX", () => {
  it("reúne placeholder dividido em runs e converte condicional", () => {
    const xml = `<w:p><w:r><w:t>{{employee.</w:t></w:r><w:r><w:t>name}}</w:t></w:r></w:p>`;
    assert.match(normalizeDocxTemplateXml(xml), /\{\{employee\.name\}\}/);
  });
  it("extrai e preenche variáveis preservando o run formatado", () => {
    const input = fixture();
    assert.deepEqual(extractDocxVariables(input), ["employee.has_vt", "employee.name", "employee.vt_daily_value"]);
    const output = generateDocx(input, { employee: { name: "Maria", has_vt: true, vt_daily_value: "R$ 8,40" } });
    const xml = new PizZip(output).file("word/document.xml")?.asText() ?? "";
    assert.match(xml, /Maria/); assert.match(xml, /R\$ 8,40/); assert.match(xml, /<w:b\/>/);
  });
  it("substitui texto fixo mesmo quando ele está dividido em runs", () => {
    const zip = new PizZip(fixture());
    const xml = zip.file("word/document.xml")?.asText() ?? "";
    zip.file("word/document.xml", xml.replace("{{employee.</w:t></w:r><w:r><w:t>name}}", "CT SOR</w:t></w:r><w:r><w:t>VETES LTDA"));
    const input = zip.generate({ type: "nodebuffer" }) as Buffer;
    const result = replaceDocxTextWithVariable(input, "CT SORVETES LTDA", "integration.employer_name");
    assert.equal(result.replacements, 1);
    assert.ok(extractDocxVariables(result.buffer).includes("integration.employer_name"));
  });
  it("não confunde células e tabelas do Word com tags de texto", () => {
    const xml = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>CT SORVETES LTDA</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const normalized = normalizeDocxTemplateXml(xml);
    assert.equal(normalized, xml);
    assert.match(normalized, /<w:tbl>/);
    assert.match(normalized, /<w:tc>/);
  });
  it("não substitui texto atravessando a fronteira entre parágrafos", () => {
    const zip = new PizZip(fixture());
    const xml = zip.file("word/document.xml")?.asText() ?? "";
    zip.file(
      "word/document.xml",
      xml.replace(
        "<w:p><w:r><w:t>{{#if employee.has_vt}}</w:t></w:r></w:p>",
        "<w:p><w:r><w:t>JOÃO DA</w:t></w:r></w:p><w:p><w:r><w:t> SILVA</w:t></w:r></w:p>",
      ),
    );
    const input = zip.generate({ type: "nodebuffer" }) as Buffer;
    assert.throws(
      () => replaceDocxTextWithVariable(input, "JOÃO DA SILVA", "employee.name"),
      /não foi encontrado/,
    );
  });

  it("repete uma linha OOXML completa para zero, um e muitos itens", () => {
    const base = new PizZip(fixture());
    const xml = base.file("word/document.xml")?.asText() ?? "";
    const row = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{#items}}{{description}}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{{value}}{{/items}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
    base.file("word/document.xml", xml.replace("<w:sectPr/>", `${row}<w:sectPr/>`));
    const input = base.generate({ type: "nodebuffer" }) as Buffer;
    for (const count of [0, 1, 12]) {
      const output = generateDocx(input, {
        employee: { name: "Maria", has_vt: false },
        items: Array.from({ length: count }, (_, index) => ({
          description: `Item ${index + 1}`,
          value: `R$ ${index + 1},00`,
        })),
      });
      const rendered = new PizZip(output).file("word/document.xml")?.asText() ?? "";
      const rows = Array.from(rendered.matchAll(/<w:tr>/g)).length;
      assert.equal(rows, count);
      if (count) assert.match(rendered, new RegExp(`Item ${count}`));
    }
  });

  it("remove a empresa antiga dos metadados do documento gerado", () => {
    const zip = new PizZip(fixture());
    zip.file(
      "docProps/core.xml",
      '<?xml version="1.0"?><cp:coreProperties xmlns:cp="cp" xmlns:dc="dc">' +
        "<dc:creator>Empresa antiga</dc:creator>" +
        "<cp:lastModifiedBy>Usuário antigo</cp:lastModifiedBy>" +
        "</cp:coreProperties>",
    );
    const input = zip.generate({ type: "nodebuffer" }) as Buffer;
    const output = generateDocx(input, { employee: { name: "Maria" } });
    const core = new PizZip(output).file("docProps/core.xml")?.asText();
    assert.match(core ?? "", /<dc:creator>Coala One<\/dc:creator>/);
    assert.match(core ?? "", /<cp:lastModifiedBy>Coala One<\/cp:lastModifiedBy>/);
    assert.doesNotMatch(core ?? "", /Empresa antiga|Usuário antigo/);
  });
});
