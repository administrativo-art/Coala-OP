import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import PizZip from "pizzip";

import { extractDocxVariables } from "../src/features/hr/documents/docx-generator";

const SOURCE = path.resolve(
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v3.docx",
);
const OUTPUT = path.resolve(
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v4.docx",
);
const EXPECTED_SOURCE_HASH =
  "eaa43b298ba99b6a948216152dd8ca58a0c969aa3416d7d3548f91f20c50f3c6";
const EXPECTED_OUTPUT_HASH =
  "081e850ded830aef5911c34754ca549313074681be63e7f4f9b204888bedd91f";

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
    `<w:r>${bold ? "<w:rPr><w:b/><w:bCs/></w:rPr>" : ""}`
    + `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  );
}

function emphasizedPreamble() {
  return (
    '<w:p><w:pPr><w:pStyle w:val="CTPreambulo"/></w:pPr>'
    + run("Contrato celebrado entre a pessoa jurídica de direito privado ")
    + run("{{integration.employer_name}}", true)
    + run(", inscrita sob ")
    + run("{{contract_employer_cnpj}}", true)
    + run(", com sede em ")
    + run("{{integration.employer_address}}", true)
    + run(", e ")
    + run("{{employee.name}}", true)
    + run(", identificado(a) por ")
    + run("{{contract_employee_cpf}}", true)
    + run(", titular de CTPS Digital vinculada ao referido CPF, residente e domiciliado(a) em ")
    + run("{{employee.address}}", true)
    + run(", doravante denominado(a) EMPREGADO(A), mediante as condições seguintes.")
    + "</w:p>"
  );
}

function paragraphText(paragraph: string) {
  return [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join("");
}

function prepareContract(input: Buffer) {
  const zip = new PizZip(input);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("O contrato não contém word/document.xml.");
  const documentDate = file.date;
  let documentXml = file.asText();
  let preambleReplacements = 0;

  documentXml = documentXml.replace(
    /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,
    (paragraph) => {
      if (
        paragraph.includes('<w:pStyle w:val="CTPreambulo"/>')
        && paragraphText(paragraph).startsWith(
          "Contrato celebrado entre a pessoa jurídica de direito privado",
        )
      ) {
        preambleReplacements += 1;
        return emphasizedPreamble();
      }
      return paragraph;
    },
  );
  if (preambleReplacements !== 1) {
    throw new Error(
      `Preâmbulo alterado ${preambleReplacements} vez(es); esperado: 1.`,
    );
  }

  const signatureStyle = '<w:pPr><w:pStyle w:val="CTAssinaturaLinha"/></w:pPr>';
  const signatureStyleWithSpace =
    '<w:pPr><w:pStyle w:val="CTAssinaturaLinha"/><w:spacing w:before="1000"/></w:pPr>';
  const signatureOccurrences = documentXml.split(signatureStyle).length - 1;
  if (signatureOccurrences !== 2) {
    throw new Error(
      `Linhas de assinatura encontradas: ${signatureOccurrences}; esperado: 2.`,
    );
  }
  documentXml = documentXml.replaceAll(signatureStyle, signatureStyleWithSpace);
  // Preserva a data da entrada para que execuções idênticas produzam o mesmo
  // ZIP e, portanto, o mesmo hash imutável catalogado.
  zip.file("word/document.xml", documentXml, { date: documentDate });
  return Buffer.from(
    zip.generate({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}

const source = await readFile(SOURCE);
const sourceHash = sha256(source);
if (sourceHash !== EXPECTED_SOURCE_HASH) {
  throw new Error(
    `A versão 3 mudou. Esperado ${EXPECTED_SOURCE_HASH}, recebido ${sourceHash}.`,
  );
}

const output = prepareContract(source);
const outputHash = sha256(output);
if (outputHash !== EXPECTED_OUTPUT_HASH) {
  throw new Error(
    `A versão 4 divergiu. Esperado ${EXPECTED_OUTPUT_HASH}, recebido ${outputHash}.`,
  );
}
const variables = extractDocxVariables(output);
const expectedVariables = [
  "contract_employee_cpf",
  "contract_employer_cnpj",
  "contract_final_end_long",
  "contract_first_end_long",
  "contract_first_period_days",
  "contract_job_cbo",
  "contract_monthly_salary",
  "contract_signature_date_long",
  "contract_signature_place",
  "contract_second_period_days",
  "contract_start_long",
  "employee.address",
  "employee.name",
  "integration.employer_address",
  "integration.employer_name",
  "integration.job_function",
].sort();
if (JSON.stringify(variables) !== JSON.stringify(expectedVariables)) {
  throw new Error(`Variáveis inesperadas: ${JSON.stringify(variables)}.`);
}

await writeFile(OUTPUT, output);
process.stdout.write(
  `${JSON.stringify(
    {
      source: path.relative(process.cwd(), SOURCE),
      sourceHash,
      output: path.relative(process.cwd(), OUTPUT),
      outputHash,
      variables,
    },
    null,
    2,
  )}\n`,
);
