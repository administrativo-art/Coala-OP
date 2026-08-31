import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import PizZip from "pizzip";

import { extractDocxVariables } from "../src/features/hr/documents/docx-generator";

const BASE = "docs/modelos-documentos/admissionais";

type TemplatePlan = {
  name: string;
  source: string;
  output: string;
  expectedSourceHash: string;
  expectedOutputHash: string;
  expectedVariables: string[];
  transform: (documentXml: string) => string;
};

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function run(text: string, bold = false) {
  return (
    "<w:r><w:rPr>"
    + '<w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/>'
    + (bold ? "<w:b/><w:bCs/>" : "")
    + '<w:sz w:val="22"/><w:szCs w:val="22"/>'
    + `</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  );
}

function paragraph(runs: string, options: { align?: "both" | "left" } = {}) {
  const align = options.align ?? "both";
  return (
    `<w:p><w:pPr><w:spacing w:after="180" w:before="0" w:line="320"/>`
    + `<w:jc w:val="${align}"/></w:pPr>${runs}</w:p>`
  );
}

function paragraphText(paragraphXml: string) {
  return [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join("");
}

function replaceParagraphs(
  documentXml: string,
  replacements: ReadonlyMap<string, (paragraphXml: string) => string>,
) {
  const counts = new Map<string, number>();
  const output = documentXml.replace(
    /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,
    (paragraphXml) => {
      const text = paragraphText(paragraphXml);
      const replacement = replacements.get(text);
      if (!replacement) return paragraphXml;
      counts.set(text, (counts.get(text) ?? 0) + 1);
      return replacement(paragraphXml);
    },
  );

  for (const text of replacements.keys()) {
    const count = counts.get(text) ?? 0;
    if (count !== 1) {
      throw new Error(`Parágrafo alterado ${count} vez(es); esperado 1: ${text}`);
    }
  }
  return output;
}

function prepareDocx(source: Buffer, transform: (documentXml: string) => string) {
  const zip = new PizZip(source);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("O DOCX não contém word/document.xml.");
  const documentDate = file.date;
  const documentXml = transform(file.asText());
  zip.file("word/document.xml", documentXml, { date: documentDate });
  return Buffer.from(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

const plans: TemplatePlan[] = [
  {
    name: "termo LGPD",
    source: `${BASE}/03-termo-lgpd-v2.docx`,
    output: `${BASE}/03-termo-lgpd-v4.docx`,
    expectedSourceHash: "70b4a960bccbe858daaad9e91659b301fde77516cba2c05a1e0997ef38f44265",
    expectedOutputHash: "c5bc23d9a942b57daeb94d6185187552c4520c82b30cc071f589a9c94d50e1a5",
    expectedVariables: [
      "employee.cpf",
      "employee.name",
      "integration.employer_address",
      "integration.employer_cnpj",
      "integration.employer_name",
    ],
    transform(documentXml) {
      return replaceParagraphs(documentXml, new Map([
        [
          "Versão 1.0  •  Vigência: {{term_effective_date}}",
          () => "",
        ],
      ]));
    },
  },
  {
    name: "consentimento de imagem e voz",
    source: `${BASE}/04-imagem-voz-v2.docx`,
    output: `${BASE}/04-imagem-voz-v4.docx`,
    expectedSourceHash: "a3d20c516afa510c6aa9d58ae359827490b76289643f7508932fce61d8c42381",
    expectedOutputHash: "a266bbf3ffa1e4e3fa06108b57f5755879151a1af4e99497ac099d27856d9a0a",
    expectedVariables: [
      "employee.cpf",
      "employee.name",
      "integration.employer_address",
      "integration.employer_cnpj",
      "integration.employer_name",
      "integration.image_voice_authorized_mark",
    ],
    transform(documentXml) {
      return replaceParagraphs(documentXml, new Map([
        [
          "Eu, {{employee.name}}, inscrito(a) no CPF sob o nº {{employee.cpf}}, doravante denominado(a) TITULAR, em manifestação livre, informada e inequívoca, e exclusivamente na hipótese de haver assinalado a opção destacada no Termo de Encerramento, Ciência e Assinatura deste kit, autorizo a empresa {{integration.employer_name}}, inscrita no CNPJ sob o nº {{integration.employer_cnpj}}, com sede no {{integration.employer_address}}, doravante denominada CONTROLADORA, a realizar o tratamento da minha imagem e da minha voz, com fundamento no consentimento previsto no artigo 7º, inciso I, da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais – LGPD), conforme as condições a seguir:",
          () => (
            paragraph(
              run("Eu, ")
              + run("{{employee.name}}", true)
              + run(", inscrito(a) no CPF sob o nº ")
              + run("{{employee.cpf}}", true)
              + run(", doravante denominado(a) TITULAR, declaro que a opção facultativa abaixo reflete minha decisão específica, livre, informada e inequívoca sobre o uso da minha imagem e da minha voz pela empresa ")
              + run("{{integration.employer_name}}", true)
              + run(", inscrita no CNPJ sob o nº ")
              + run("{{integration.employer_cnpj}}", true)
              + run(", com sede no ")
              + run("{{integration.employer_address}}", true)
              + run(", doravante denominada CONTROLADORA:"),
            )
            + paragraph(
              run("[ {{integration.image_voice_authorized_mark}} ] AUTORIZO", true)
              + run(" o tratamento da minha imagem e da minha voz, com fundamento no artigo 7º, inciso I, da Lei nº 13.709/2018 (LGPD), exclusivamente nas condições deste Termo."),
              { align: "left" },
            )
            + paragraph(
              run("A autorização somente será considerada concedida se a caixa acima estiver marcada. A ausência de marcação equivale à não autorização e não produz prejuízo à admissão, ao vínculo de emprego ou a qualquer direito trabalhista."),
            )
          ),
        ],
        [
          "Autorizo o uso da minha imagem e/ou voz para as seguintes finalidades:",
          (paragraphXml) => paragraphXml.replace(
            "Autorizo o uso da minha imagem e/ou voz para as seguintes finalidades:",
            "Quando assinalada a opção acima, a autorização abrange o uso da minha imagem e/ou voz para as seguintes finalidades:",
          ),
        ],
      ]));
    },
  },
  {
    name: "termo de encerramento",
    source: `${BASE}/09-termo-encerramento-v2.docx`,
    output: `${BASE}/09-termo-encerramento-v4.docx`,
    expectedSourceHash: "1b4a98f7a9fba99d61ab07ffde24584b52516fb53bd0379d101216923d05b030",
    expectedOutputHash: "a98b162a2adfda8856a488870f8a462164a78f7e40ee29f63395f5d0f5e0221e",
    expectedVariables: [
      "bundle_components_summary",
      "contract_start_long",
      "employee.name",
      "integration.employer_name",
    ],
    transform(documentXml) {
      return replaceParagraphs(documentXml, new Map([
        [
          "Eu, {{employee.name}}, declaro ter recebido, lido e compreendido, nesta data e em um único instrumento, os documentos relacionados abaixo, com cujo conteúdo manifesto integral concordância:",
          (paragraphXml) => paragraphXml.replace(
            "Eu, {{employee.name}}, declaro ter recebido, lido e compreendido, nesta data e em um único instrumento, os documentos relacionados abaixo, com cujo conteúdo manifesto integral concordância:",
            "Eu, {{employee.name}}, declaro ter recebido, lido e compreendido, nesta data e em um único instrumento, os documentos relacionados abaixo. Minha assinatura manifesta concordância com os documentos obrigatórios e confirma a opção específica assinalada no Termo de Consentimento para Uso de Imagem e Voz, que permanece facultativa:",
          ),
        ],
        [
          "{{bundle_components_summary}}",
          (paragraphXml) => paragraphXml.replace(
            /<w:pPr>[\s\S]*?<\/w:pPr>/,
            '<w:pPr><w:spacing w:after="120" w:before="60" w:line="300"/>'
            + '<w:ind w:left="288"/><w:jc w:val="left"/></w:pPr>',
          ),
        ],
        [
          "A assinatura abaixo abrange todos os documentos deste instrumento, registrada eletronicamente com os elementos de auditoria previstos na seção 10 do documento 3.",
          (paragraphXml) => paragraphXml.replace(
            "A assinatura abaixo abrange todos os documentos deste instrumento, registrada eletronicamente com os elementos de auditoria previstos na seção 10 do documento 3.",
            "A assinatura abaixo abrange todos os documentos deste instrumento e confirma as opções neles assinaladas, registrada eletronicamente com os elementos de auditoria previstos na seção 10 do documento 3.",
          ),
        ],
      ]));
    },
  },
];

const results = [];
for (const plan of plans) {
  const source = await readFile(path.resolve(plan.source));
  const sourceHash = sha256(source);
  if (sourceHash !== plan.expectedSourceHash) {
    throw new Error(
      `${plan.name}: fonte alterada. Esperado ${plan.expectedSourceHash}, recebido ${sourceHash}.`,
    );
  }

  const output = prepareDocx(source, plan.transform);
  const outputHash = sha256(output);
  if (plan.expectedOutputHash && outputHash !== plan.expectedOutputHash) {
    throw new Error(
      `${plan.name}: saída alterada. Esperado ${plan.expectedOutputHash}, recebido ${outputHash}.`,
    );
  }
  const variables = extractDocxVariables(output);
  const expectedVariables = [...plan.expectedVariables].sort();
  if (JSON.stringify(variables) !== JSON.stringify(expectedVariables)) {
    throw new Error(`${plan.name}: variáveis inesperadas: ${JSON.stringify(variables)}.`);
  }

  await writeFile(path.resolve(plan.output), output);
  results.push({
    name: plan.name,
    source: plan.source,
    sourceHash,
    output: plan.output,
    outputHash,
    variables,
  });
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
