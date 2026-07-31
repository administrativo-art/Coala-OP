import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";

import {
  extractDocxVariables,
  replaceDocxTextWithVariable,
} from "../src/features/hr/documents/docx-generator";

const SOURCE = path.resolve(
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v1.docx",
);
const OUTPUT = path.resolve(
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v2.docx",
);
const EXPECTED_SOURCE_HASH =
  "935fbe335a50349a389a61a537c9f20570da5ac26d8a3e437506b5d91734bc12";

const replacements = [
  {
    search: "CT SORVETES LTDA",
    key: "integration.employer_name",
    expected: 1,
  },
  {
    search: "{{custom_field_15914645}}",
    key: "employee.name",
    expected: 1,
  },
] as const;

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const bodyRunProperties =
  '<w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';
const boldBodyRunProperties =
  '<w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/>' +
  '<w:b/><w:bCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';
const numberRunProperties =
  '<w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/>' +
  '<w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>';
type ContractFragment = {
  text: string;
  bold?: boolean;
};

function run(fragment: ContractFragment) {
  const properties = fragment.bold ? boldBodyRunProperties : bodyRunProperties;
  return `<w:r>${properties}<w:t xml:space="preserve">${escapeXml(fragment.text)}</w:t></w:r>`;
}

function bodyParagraph(fragments: ContractFragment[]) {
  return (
    '<w:p><w:pPr><w:spacing w:after="180" w:before="0" w:line="320"/>' +
    '<w:jc w:val="both"/></w:pPr>' +
    fragments.map(run).join("") +
    "</w:p>"
  );
}

function numberedParagraph(number: string, fragments: ContractFragment[]) {
  const indent = number.includes(".")
    ? 504
    : Number(number) >= 10
      ? 408
      : 288;
  return (
    '<w:p><w:pPr><w:spacing w:after="180" w:before="240" w:line="320"/>' +
    `<w:ind w:left="${indent}" w:hanging="${indent}"/><w:jc w:val="both"/></w:pPr>` +
    `<w:r>${numberRunProperties}<w:t xml:space="preserve">${escapeXml(`${number}. `)}</w:t></w:r>` +
    fragments.map(run).join("") +
    "</w:p>"
  );
}

function legalContractParagraphs() {
  return [
    bodyParagraph([
      {
        text:
          "Contrato celebrado entre a pessoa jurídica de direito privado {{integration.employer_name}}, " +
          "inscrita no CNPJ sob o nº {{integration.employer_cnpj}}, com sede em " +
          "{{integration.employer_address}}, e {{employee.name}}, inscrito(a) no CPF sob o nº " +
          "{{employee.cpf}}, titular de CTPS Digital vinculada ao referido CPF, residente e " +
          "domiciliado(a) em {{employee.address}}, doravante denominado(a) EMPREGADO(A), " +
          "mediante as condições seguintes.",
      },
    ]),
    numberedParagraph("1", [
      {
        text:
          "Fica o EMPREGADO(A) admitido(a) no quadro de funcionários da EMPREGADORA para exercer " +
          "a função de {{integration.job_function}}, CBO {{contract_job_cbo}}, mediante salário-base " +
          "mensal de {{contract_monthly_salary}}, pago até o 5º dia útil do mês subsequente ao vencido, " +
          "observado o piso salarial fixado na Convenção Coletiva de Trabalho da categoria celebrada " +
          "entre {{contract_union_employees}} e {{contract_union_employers}}, registrada no MTE sob " +
          "o nº {{contract_cct_registry}}, com vigência {{contract_cct_validity}}, cujas normas " +
          "integram o presente contrato.",
      },
    ]),
    numberedParagraph("2", [
      {
        text:
          "A jornada de trabalho será de 44 (quarenta e quatro) horas semanais, cumprida na escala " +
          "{{contract_work_scale}}, no horário de {{contract_work_hours}}, no estabelecimento situado " +
          "em {{contract_workplace_address}}. O controle de jornada será efetuado pela forma adotada " +
          "pela EMPREGADORA, observado o regime legal e coletivo aplicável. Alterações de escala, " +
          "horário ou local somente poderão ocorrer dentro dos limites legais e normativos, por " +
          "necessidade do serviço, sem redução salarial nem alteração contratual lesiva.",
      },
    ]),
    numberedParagraph("2.1", [
      {
        text:
          "Ficam assegurados os intervalos intrajornada e interjornada e o descanso semanal remunerado, " +
          "observadas a legislação, as regras específicas aplicáveis à atividade, a norma coletiva e a " +
          "condição mais favorável. O repouso semanal coincidirá com o domingo na periodicidade mínima " +
          "legal ou convencional aplicável, prevalecendo a regra mais favorável ao EMPREGADO(A).",
      },
    ]),
    numberedParagraph("3", [
      {
        text:
          "O EMPREGADO(A) deverá prestar serviços em horas extraordinárias quando solicitado(a) pela " +
          "EMPREGADORA, nos limites permitidos em lei. As horas extraordinárias serão pagas com o " +
          "adicional legal ou convencional, o que for mais benéfico, salvo quando validamente " +
          "compensadas com a correspondente redução da jornada em outro dia.",
      },
    ]),
    numberedParagraph("4", [
      {
        text:
          "O EMPREGADO(A) poderá prestar serviços nos turnos diurno ou noturno, sem simultaneidade, " +
          "mediante prévia comunicação e observados os limites legais, a norma coletiva e a vedação de " +
          "alteração contratual lesiva. O trabalho prestado entre 22h e 5h será remunerado com o adicional " +
          "noturno de, no mínimo, 20% (vinte por cento) sobre a hora diurna, computada a hora noturna " +
          "reduzida de 52 (cinquenta e dois) minutos e 30 (trinta) segundos, nos termos do artigo 73 da CLT.",
      },
    ]),
    numberedParagraph("5", [
      {
        text:
          "Fica ajustado, nos termos do §1º do artigo 469 da CLT, que o EMPREGADO(A) poderá prestar " +
          "serviços tanto na localidade de celebração deste contrato como em outros estabelecimentos da " +
          "EMPREGADORA situados no município de São Luís/MA e em sua região metropolitana, quando houver " +
          "real necessidade do serviço e observados os limites legais. Em caso de transferência provisória, " +
          "será devido o adicional previsto no §3º do artigo 469 da CLT enquanto durar essa situação.",
      },
    ]),
    numberedParagraph("6", [
      {
        text:
          "Além dos descontos previstos em lei, a EMPREGADORA poderá descontar as importâncias " +
          "correspondentes a danos causados pelo EMPREGADO(A), desde que comprovados o dolo ou a culpa e " +
          "observados os requisitos do §1º do artigo 462 da CLT.",
      },
    ]),
    numberedParagraph("6.1", [
      {
        text:
          "Os demais descontos somente serão efetuados quando decorrentes de lei, norma coletiva ou " +
          "autorização individual, prévia, específica e escrita do EMPREGADO(A). A adesão a benefícios ou " +
          "convênios que impliquem coparticipação ou desconto será formalizada em instrumento próprio, " +
          "com identificação da rubrica e das condições aplicáveis.",
      },
    ]),
    numberedParagraph("7", [
      {
        text:
          "O presente contrato inicia-se em {{contract_start_long}} e vigorará por 45 (quarenta e cinco) " +
          "dias, encerrando-se o primeiro período em {{contract_first_end_long}}. O primeiro dia de trabalho " +
          "é considerado dia 1 para efeito da contagem.",
      },
    ]),
    numberedParagraph("7.1", [
      {
        text:
          "Na ausência de manifestação contrária até o primeiro termo, o contrato será prorrogado uma única " +
          "vez por igual período, com término final em {{contract_final_end_long}}. A prorrogação será " +
          "registrada pela EMPREGADORA nos assentamentos funcionais do EMPREGADO(A). Havendo continuidade " +
          "da prestação de serviços após o termo final ou nova prorrogação, o contrato passará a vigorar por " +
          "prazo indeterminado, nos termos do artigo 451 da CLT. Em nenhuma hipótese o prazo total excederá " +
          "90 (noventa) dias, nos termos do parágrafo único do artigo 445 da CLT.",
      },
    ]),
    numberedParagraph("8", [
      {
        text:
          "Na hipótese de este contrato se transformar em contrato de trabalho por prazo indeterminado, " +
          "continuarão em plena vigência as obrigações aqui previstas, no que forem compatíveis.",
      },
    ]),
    numberedParagraph("9", [
      {
        text:
          "Nos termos do artigo 481 da CLT, fica assegurado a ambas as partes o direito recíproco de " +
          "rescindir o presente contrato antes de expirado o seu termo, hipótese em que se aplicarão os " +
          "princípios que regem a rescisão dos contratos por prazo indeterminado, inclusive quanto ao aviso " +
          "prévio. Não exercida a faculdade prevista nesta cláusula, aplicam-se: (a) em caso de rescisão " +
          "antecipada pela EMPREGADORA, sem justa causa, a indenização de metade da remuneração a que o " +
          "EMPREGADO(A) teria direito até o termo do contrato, conforme o artigo 479 da CLT; e (b) em caso " +
          "de rescisão antecipada pelo EMPREGADO(A), sem justa causa, a indenização dos prejuízos que desse " +
          "fato resultarem à EMPREGADORA, limitada àquela a que teria direito o EMPREGADO(A) em idênticas " +
          "condições, conforme o artigo 480 da CLT.",
      },
    ]),
    numberedParagraph("10", [
      {
        text:
          "O EMPREGADO(A) obriga-se a utilizar o uniforme e os equipamentos de trabalho fornecidos " +
          "gratuitamente pela EMPREGADORA, zelando por sua conservação e higiene, e a devolvê-los ao " +
          "término do contrato. O uniforme e os equipamentos permanecem de propriedade da EMPREGADORA, e " +
          "seu fornecimento não constitui salário-utilidade, nos termos do §2º do artigo 458 da CLT.",
      },
    ]),
    numberedParagraph("11", [
      {
        text:
          "O EMPREGADO(A) declara ciência de que seus dados pessoais serão tratados pela EMPREGADORA na " +
          "forma do Termo de Ciência sobre o Tratamento de Dados Pessoais na Relação de Trabalho, que " +
          "integra o pacote admissional, com fundamento nas bases legais previstas na Lei nº 13.709/2018, " +
          "especialmente para o cumprimento de obrigações legais, regulatórias, fiscais, previdenciárias e " +
          "trabalhistas e para a execução do contrato de trabalho, assegurados os direitos previstos no " +
          "artigo 18 da referida lei.",
      },
    ]),
    numberedParagraph("12", [
      {
        text:
          "O EMPREGADO(A) compromete-se a cumprir as normas de saúde e segurança do trabalho, as ordens de " +
          "serviço e as instruções aplicáveis à função, a utilizar corretamente os equipamentos de proteção " +
          "individual quando exigidos e a comunicar riscos, incidentes e condições inseguras. A realização " +
          "dos exames ocupacionais, a entrega de equipamentos de proteção individual e os treinamentos " +
          "obrigatórios serão comprovados em registros próprios, mantidos pela EMPREGADORA na forma da " +
          "legislação aplicável.",
      },
    ]),
    numberedParagraph("13", [
      {
        text:
          "Os valores eventualmente pagos ao EMPREGADO(A) a título de prêmio, na forma do Regulamento de " +
          "Prêmios vigente para o período, somente terão essa natureza quando decorrerem de desempenho " +
          "superior ao ordinariamente esperado e estiverem apoiados em critérios, metas e evidências " +
          "objetivas. Atendidos esses requisitos, não integram a remuneração nem se incorporam ao contrato " +
          "de trabalho, nos termos dos §§2º e 4º do artigo 457 da CLT. ",
      },
      {
        text: "Parágrafo único. ",
        bold: true,
      },
      {
        text:
          "Pagamentos que remunerem desempenho ordinário, metas rotineiras ou parcela salarial variável " +
          "não serão tratados como prêmio apenas pela denominação adotada.",
      },
    ]),
  ];
}

function replaceLegalContractContent(input: Buffer) {
  const zip = new PizZip(input);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("O contrato não contém word/document.xml.");
  const source = documentFile.asText();
  const paragraphs = [...source.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
  const paragraphText = (paragraph: string) =>
    [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((match) => match[1])
      .join("")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
  const start = paragraphs.findIndex((match) =>
    paragraphText(match[0]).startsWith(
      "Contrato celebrado entre a pessoa jurídica de direito privado",
    ),
  );
  const end = paragraphs.findIndex((match) =>
    paragraphText(match[0]).startsWith(
      "12.\tO EMPREGADO declara ter recebido",
    ),
  );
  if (start < 0 || end < start) {
    throw new Error("Não foi possível localizar o bloco jurídico original do contrato.");
  }
  const startOffset = paragraphs[start].index!;
  const endOffset = paragraphs[end].index! + paragraphs[end][0].length;
  const documentXml =
    source.slice(0, startOffset) +
    legalContractParagraphs().join("") +
    source.slice(endOffset);
  zip.file("word/document.xml", documentXml);
  return Buffer.from(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

function tightenContractLayout(input: Buffer) {
  const zip = new PizZip(input);
  const documentFile = zip.file("word/document.xml");
  const footerFile = zip.file("word/footer1.xml");
  if (!documentFile || !footerFile) {
    throw new Error("O contrato não contém as partes de layout esperadas.");
  }

  let documentXml = documentFile.asText();
  const exactReplacements = [
    {
      search:
        '<w:spacing w:after="300" w:before="0"/><w:jc w:val="center"/>',
      replacement:
        '<w:spacing w:after="100" w:before="0"/><w:jc w:val="center"/>',
      label: "espaçamento do título",
    },
    {
      search:
        '<w:pBdr><w:bottom w:val="single" w:color="999999" w:sz="6"/></w:pBdr><w:spacing w:after="300" w:before="0"/>',
      replacement:
        '<w:pBdr><w:bottom w:val="single" w:color="999999" w:sz="6"/></w:pBdr><w:spacing w:after="140" w:before="0" w:line="20" w:lineRule="exact"/>',
      label: "linha abaixo do título",
    },
    {
      search: '<w:spacing w:after="200" w:before="400"/>',
      replacement: '<w:spacing w:after="80" w:before="100" w:line="20" w:lineRule="exact"/>',
      label: "espaço anterior às assinaturas",
    },
    {
      search: '<w:trPr><w:trHeight w:val="1400" w:hRule="atLeast"/></w:trPr>',
      replacement:
        '<w:trPr><w:cantSplit/><w:trHeight w:val="1200" w:hRule="atLeast"/></w:trPr>',
      label: "bloco de assinaturas",
    },
  ] as const;

  for (const replacement of exactReplacements) {
    const occurrences = documentXml.split(replacement.search).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Não foi possível ajustar ${replacement.label}: encontrado ${occurrences} vez(es).`,
      );
    }
    documentXml = documentXml.replace(replacement.search, replacement.replacement);
  }
  zip.file("word/document.xml", documentXml);

  const footerXml = footerFile.asText();
  const footerPattern =
    /<w:p>[\s\S]*?<w:t[^>]*>Contrato de Experiência — [\s\S]*?<\/w:t>[\s\S]*?<\/w:p>/;
  if (!footerPattern.test(footerXml)) {
    throw new Error("O texto legado do rodapé não foi encontrado.");
  }
  zip.file(
    "word/footer1.xml",
    footerXml.replace(footerPattern, "<w:p/>"),
  );

  return Buffer.from(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

function validateNumberedParagraphs(input: Buffer) {
  const zip = new PizZip(input);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("O contrato não contém word/document.xml.");
  const numberedParagraphs = [
    ...documentFile.asText().matchAll(
      /<w:t xml:space="preserve">\d+(?:\.\d+)?\. <\/w:t>/g,
    ),
  ].length;
  if (numberedParagraphs !== 16) {
    throw new Error(
      `Foram configurados ${numberedParagraphs} itens numerados; esperado: 16.`,
    );
  }
  return Buffer.from(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

let buffer = await readFile(SOURCE);
const sourceHash = sha256(buffer);
if (sourceHash !== EXPECTED_SOURCE_HASH) {
  throw new Error(
    `O contrato original mudou. Esperado ${EXPECTED_SOURCE_HASH}, recebido ${sourceHash}.`,
  );
}

buffer = replaceLegalContractContent(buffer);
buffer = tightenContractLayout(buffer);

for (const replacement of replacements) {
  const result = replaceDocxTextWithVariable(
    buffer,
    replacement.search,
    replacement.key,
  );
  if (result.replacements !== replacement.expected) {
    throw new Error(
      `Substituição inesperada de ${replacement.search}: ` +
        `${result.replacements}, esperado ${replacement.expected}.`,
    );
  }
  buffer = result.buffer;
}

buffer = validateNumberedParagraphs(buffer);

const variables = extractDocxVariables(buffer);
const expectedVariables = [
  "contract_cct_registry",
  "contract_cct_validity",
  "contract_final_end_long",
  "contract_first_end_long",
  "contract_job_cbo",
  "contract_monthly_salary",
  "contract_start_long",
  "contract_union_employees",
  "contract_union_employers",
  "contract_work_hours",
  "contract_work_scale",
  "contract_workplace_address",
  "employee.address",
  "employee.cpf",
  "employee.name",
  "integration.employer_address",
  "integration.employer_cnpj",
  "integration.employer_name",
  "integration.job_function",
].sort();
if (JSON.stringify(variables) !== JSON.stringify(expectedVariables)) {
  throw new Error(
    `Variáveis inesperadas no modelo: ${JSON.stringify(variables)}.`,
  );
}

await writeFile(OUTPUT, buffer);
process.stdout.write(
  `${JSON.stringify({
    source: SOURCE,
    sourceHash,
    output: OUTPUT,
    outputHash: sha256(buffer),
    variables,
  }, null, 2)}\n`,
);
