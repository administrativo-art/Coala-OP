import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import PizZip from "pizzip";

import { extractDocxVariables } from "../src/features/hr/documents/docx-generator";
import { applyCtDocumentStandard } from "../src/features/hr/documents/ct-document-standard.server";

const SOURCE = path.resolve(
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v2.docx",
);
const OUTPUT = path.resolve(
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v3.docx",
);
const EXPECTED_SOURCE_HASH =
  "0b0ce20b71e53ad9fd5576a52bcbfb57dfdfc6f678f82a9cb8cc7f646437da52";

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function paragraph(styleId: string, text: string) {
  return (
    `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function rightAlignedParagraph(styleId: string, text: string) {
  return (
    `<w:p><w:pPr><w:pStyle w:val="${styleId}"/><w:jc w:val="right"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function signatureParagraph(
  styleId: "CTAssinatura" | "CTAssinaturaLinha",
  text: string,
  characterStyle?: "CTAssinaturaNome" | "CTAssinaturaQualificacao",
) {
  return (
    `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` +
    `<w:r>${characterStyle ? `<w:rPr><w:rStyle w:val="${characterStyle}"/></w:rPr>` : ""}` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function signatureCell(params: {
  name: string;
  document: string;
  qualification: string;
}) {
  return (
    '<w:tc><w:tcPr><w:tcW w:w="4252" w:type="dxa"/><w:tcMar>' +
    '<w:left w:w="180" w:type="dxa"/><w:right w:w="180" w:type="dxa"/>' +
    "</w:tcMar></w:tcPr>" +
    signatureParagraph("CTAssinaturaLinha", params.name, "CTAssinaturaNome") +
    signatureParagraph("CTAssinatura", params.document) +
    signatureParagraph(
      "CTAssinatura",
      params.qualification,
      "CTAssinaturaQualificacao",
    ) +
    "</w:tc>"
  );
}

function signatureTable() {
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="8504" w:type="dxa"/>' +
    '<w:tblLayout w:type="fixed"/><w:tblBorders>' +
    '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/>' +
    '<w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>' +
    "</w:tblBorders></w:tblPr>" +
    '<w:tblGrid><w:gridCol w:w="4252"/><w:gridCol w:w="4252"/></w:tblGrid>' +
    '<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
    signatureCell({
      name: "{{employee.name}}",
      document: "{{contract_employee_cpf}}",
      qualification: "EMPREGADO(A)",
    }) +
    signatureCell({
      name: "{{integration.employer_name}}",
      document: "{{contract_employer_cnpj}}",
      qualification: "EMPREGADORA",
    }) +
    "</w:tr></w:tbl>"
  );
}

function contractBody() {
  return [
    paragraph(
      "CTTituloDocumento",
      "CONTRATO DE TRABALHO A TÍTULO DE EXPERIÊNCIA",
    ),
    paragraph(
      "CTPreambulo",
      "Contrato celebrado entre a pessoa jurídica de direito privado " +
        "{{integration.employer_name}}, inscrita sob {{contract_employer_cnpj}}, " +
        "com sede em {{integration.employer_address}}, e {{employee.name}}, " +
        "identificado(a) por {{contract_employee_cpf}}, titular de CTPS Digital " +
        "vinculada ao referido CPF, residente e domiciliado(a) em {{employee.address}}, " +
        "doravante denominado(a) EMPREGADO(A), mediante as condições seguintes.",
    ),
    paragraph("CTSecao", "FUNÇÃO E REMUNERAÇÃO"),
    paragraph(
      "CTClausulaN1",
      "Fica o EMPREGADO(A) admitido(a) no quadro de funcionários da EMPREGADORA " +
        "para exercer a função de {{integration.job_function}}, {{contract_job_cbo}}, " +
        "mediante salário-base mensal de {{contract_monthly_salary}}, pago até o " +
        "quinto dia útil do mês subsequente ao vencido, observado o piso salarial " +
        "fixado na Convenção Coletiva de Trabalho da categoria.",
    ),
    paragraph("CTSecao", "JORNADA DE TRABALHO"),
    paragraph(
      "CTClausulaN1",
      "A jornada, os períodos de descanso e o controle de frequência observarão as " +
        "condições abaixo.",
    ),
    paragraph(
      "CTClausulaN2",
      "A jornada de trabalho será de 44 (quarenta e quatro) horas semanais. O horário " +
        "de trabalho e o controle de jornada serão registrados na forma adotada pela " +
        "EMPREGADORA, observada a legislação aplicável. Alterações de escala ou " +
        "horário somente poderão ocorrer dentro dos limites legais e normativos, sem " +
        "redução salarial nem alteração contratual lesiva.",
    ),
    paragraph(
      "CTClausulaN2",
      "Ficam assegurados o intervalo intrajornada previsto em lei e na Convenção " +
        "Coletiva de Trabalho aplicável e o descanso semanal remunerado de 24 " +
        "(vinte e quatro) horas consecutivas. A coincidência com o domingo observará " +
        "a periodicidade mínima legal ou convencional aplicável, prevalecendo a " +
        "condição mais favorável ao EMPREGADO(A).",
    ),
    paragraph(
      "CTClausulaN2",
      "A escala pactuada não caracteriza turno ininterrupto de revezamento quando " +
        "inexistir alternância periódica do EMPREGADO(A) entre os turnos diurno e " +
        "noturno.",
    ),
    paragraph(
      "CTClausulaN1",
      "O EMPREGADO(A) deverá prestar serviços em horas extraordinárias quando " +
        "solicitado(a) pela EMPREGADORA, nos limites permitidos em lei. As horas " +
        "extraordinárias serão pagas com o adicional legal ou convencional, o que " +
        "for mais benéfico, salvo quando validamente compensadas com a correspondente " +
        "redução da jornada em outro dia.",
    ),
    paragraph(
      "CTClausulaN1",
      "O EMPREGADO(A) poderá prestar serviços nos turnos diurno ou noturno, sem " +
        "simultaneidade, mediante prévia comunicação e observados os limites legais, " +
        "a norma coletiva e a vedação de alteração contratual lesiva. O trabalho " +
        "prestado entre 22h e 5h será remunerado com o adicional noturno de, no " +
        "mínimo, 20% (vinte por cento) sobre a hora diurna, computada a hora noturna " +
        "reduzida de 52 (cinquenta e dois) minutos e 30 (trinta) segundos, nos termos " +
        "do artigo 73 da CLT.",
    ),
    paragraph(
      "CTClausulaN1",
      "Fica ajustado, nos termos do §1º do artigo 469 da CLT, que o EMPREGADO(A) " +
        "poderá prestar serviços tanto na localidade de celebração deste contrato " +
        "como em outros estabelecimentos da EMPREGADORA situados no município de " +
        "São Luís/MA e em sua região metropolitana, quando houver real necessidade " +
        "do serviço e observados os limites legais. Em caso de transferência " +
        "provisória, será devido o adicional previsto no §3º do artigo 469 da CLT " +
        "enquanto durar essa situação.",
    ),
    paragraph("CTSecao", "DESCONTOS E BENEFÍCIOS"),
    paragraph(
      "CTClausulaN1",
      "Os descontos incidentes sobre a remuneração observarão as hipóteses e os " +
        "limites abaixo.",
    ),
    paragraph(
      "CTClausulaN2",
      "Além dos descontos previstos em lei, a EMPREGADORA poderá descontar as " +
        "importâncias correspondentes a danos causados pelo EMPREGADO(A), desde que " +
        "comprovados o dolo ou a culpa e observados os requisitos do §1º do artigo " +
        "462 da CLT.",
    ),
    paragraph(
      "CTClausulaN2",
      "O EMPREGADO(A) autoriza expressamente os descontos em folha relativos a " +
        "benefícios e conveniências instituídos em seu favor ou de seus dependentes, " +
        "tais como coparticipação em plano de saúde ou odontológico, seguro de vida, " +
        "vale-transporte, vale-refeição e convênios com estabelecimentos comerciais " +
        "e farmácias, bem como valores por ele expressamente aderidos, nos termos da " +
        "Súmula 342 do TST, ressalvada a hipótese de coação ou vício de vontade.",
    ),
    paragraph("CTSecao", "PRAZO E ENCERRAMENTO"),
    paragraph(
      "CTClausulaN1",
      "O contrato de experiência observará o período inicial e a única prorrogação " +
        "descritos abaixo.",
    ),
    paragraph(
      "CTClausulaN2",
      "O presente contrato inicia-se em {{contract_start_long}} e vigorará por 45 " +
        "(quarenta e cinco) dias, encerrando-se o primeiro período em " +
        "{{contract_first_end_long}}. O primeiro dia de trabalho é considerado dia " +
        "1 para efeito da contagem.",
    ),
    paragraph(
      "CTClausulaN2",
      "Na ausência de manifestação contrária até o primeiro termo, o contrato será " +
        "prorrogado uma única vez por igual período, com término final em " +
        "{{contract_final_end_long}}. A prorrogação será registrada pela EMPREGADORA " +
        "nos assentamentos funcionais do EMPREGADO(A). Havendo continuidade da " +
        "prestação de serviços após o termo final ou nova prorrogação, o contrato " +
        "passará a vigorar por prazo indeterminado, nos termos do artigo 451 da CLT. " +
        "Em nenhuma hipótese o prazo total excederá 90 (noventa) dias, nos termos do " +
        "parágrafo único do artigo 445 da CLT.",
    ),
    paragraph(
      "CTClausulaN1",
      "Na hipótese de este contrato se transformar em contrato de trabalho por prazo " +
        "indeterminado, continuarão em plena vigência as obrigações aqui previstas, " +
        "no que forem compatíveis.",
    ),
    paragraph(
      "CTClausulaN1",
      "Nos termos do artigo 481 da CLT, fica assegurado a ambas as partes o direito " +
        "recíproco de rescindir o presente contrato antes de expirado o seu termo, " +
        "hipótese em que se aplicarão os princípios que regem a rescisão dos " +
        "contratos por prazo indeterminado, inclusive quanto ao aviso prévio. Não " +
        "exercida a faculdade prevista nesta cláusula, aplicam-se: (a) em caso de " +
        "rescisão antecipada pela EMPREGADORA, sem justa causa, a indenização de " +
        "metade da remuneração a que o EMPREGADO(A) teria direito até o termo do " +
        "contrato, conforme o artigo 479 da CLT; e (b) em caso de rescisão antecipada " +
        "pelo EMPREGADO(A), sem justa causa, a indenização dos prejuízos que desse " +
        "fato resultarem à EMPREGADORA, limitada àquela a que teria direito o " +
        "EMPREGADO(A) em idênticas condições, conforme o artigo 480 da CLT.",
    ),
    paragraph("CTSecao", "OBRIGAÇÕES E DISPOSIÇÕES COMPLEMENTARES"),
    paragraph(
      "CTClausulaN1",
      "O EMPREGADO(A) obriga-se a utilizar o uniforme e os equipamentos de trabalho " +
        "fornecidos gratuitamente pela EMPREGADORA, zelando por sua conservação e " +
        "higiene, e a devolvê-los ao término do contrato. O uniforme e os " +
        "equipamentos permanecem de propriedade da EMPREGADORA, e seu fornecimento " +
        "não constitui salário-utilidade, nos termos do §2º do artigo 458 da CLT.",
    ),
    paragraph(
      "CTClausulaN1",
      "O EMPREGADO(A) declara ciência de que seus dados pessoais serão tratados pela " +
        "EMPREGADORA na forma do Termo de Ciência sobre o Tratamento de Dados " +
        "Pessoais na Relação de Trabalho, que integra o pacote admissional, com " +
        "fundamento nas bases legais previstas na Lei nº 13.709/2018, especialmente " +
        "para o cumprimento de obrigações legais, regulatórias, fiscais, " +
        "previdenciárias e trabalhistas e para a execução do contrato de trabalho, " +
        "assegurados os direitos previstos no artigo 18 da referida lei.",
    ),
    paragraph(
      "CTClausulaN1",
      "O EMPREGADO(A) observará as normas de saúde, segurança, higiene e boas " +
        "práticas aplicáveis à função.",
    ),
    paragraph(
      "CTClausulaN2",
      "O EMPREGADO(A) declara ter se submetido a exame médico admissional, com " +
        "emissão do respectivo ASO, e ter recebido orientação sobre o PGR e o PCMSO " +
        "da EMPREGADORA, obrigando-se a comparecer aos exames periódicos, de retorno " +
        "ao trabalho, de mudança de função e demissional, nas datas que lhe forem " +
        "designadas.",
    ),
    paragraph(
      "CTClausulaN2",
      "O EMPREGADO(A) declara ter recebido gratuitamente os equipamentos de proteção " +
        "individual adequados à função, obrigando-se a utilizá-los durante toda a " +
        "jornada, a zelar por sua guarda e conservação e a comunicar qualquer " +
        "alteração que os torne impróprios ao uso, ciente de que a recusa " +
        "injustificada ao uso constitui ato faltoso, nos termos do artigo 158, " +
        "parágrafo único, da CLT e da NR-06.",
    ),
    paragraph(
      "CTClausulaN2",
      "O EMPREGADO(A) declara ter recebido, no ato da admissão, as orientações sobre " +
        "suas atribuições, normas internas e regras de segurança, higiene e boas " +
        "práticas de manipulação de alimentos aplicáveis à função.",
    ),
    paragraph(
      "CTClausulaN1",
      "Os prêmios eventualmente pagos ao EMPREGADO(A) observarão os requisitos do " +
        "Regulamento de Bonificação vigente para o período.",
    ),
    paragraph(
      "CTClausulaN2",
      "Os valores pagos a título de prêmio decorrem de desempenho superior ao " +
        "ordinariamente esperado, possuem natureza não salarial e não se incorporam " +
        "à remuneração para nenhum efeito, nos termos do §2º do artigo 457 da CLT, " +
        "não integrando a base de cálculo de férias, décimo terceiro salário, FGTS, " +
        "horas extras, adicionais ou encargos previdenciários.",
    ),
    paragraph(
      "CTClausulaN2",
      "O pagamento de prêmios está condicionado ao atingimento das metas previstas " +
        "no regulamento, não gerando direito adquirido nem expectativa de " +
        "continuidade. O regulamento poderá ser alterado ou revogado quanto a " +
        "períodos futuros. Pagamentos que remunerem desempenho ordinário, metas " +
        "rotineiras ou parcela salarial variável não serão tratados como prêmio " +
        "apenas pela denominação adotada.",
    ),
    paragraph("CTSecao", "CONFIDENCIALIDADE E PROPRIEDADE INTELECTUAL"),
    paragraph(
      "CTClausulaN1",
      "As obrigações de confidencialidade e de propriedade intelectual observarão " +
        "as condições abaixo.",
    ),
    paragraph(
      "CTClausulaN2",
      "O EMPREGADO(A) obriga-se a manter sigilo sobre formulações, fichas técnicas, " +
        "parâmetros de produção, métodos operacionais, informações comerciais, dados " +
        "de fornecedores e de clientes e demais informações confidenciais a que " +
        "tiver acesso em razão da função, na forma do Termo de Confidencialidade que " +
        "integra o pacote admissional. A obrigação subsiste enquanto as informações " +
        "mantiverem caráter confidencial, inclusive após a extinção do contrato, nos " +
        "termos do artigo 195, inciso XI, da Lei nº 9.279/1996, sem prejuízo do " +
        'disposto na alínea "g" do artigo 482 da CLT.',
    ),
    paragraph(
      "CTClausulaN2",
      "As criações, melhorias e adaptações de formulações ou processos desenvolvidas " +
        "pelo EMPREGADO(A) no exercício da função ou com utilização de recursos, " +
        "dados ou instalações da EMPREGADORA pertencem à EMPREGADORA, observado o " +
        "disposto nos artigos 88 a 93 da Lei nº 9.279/1996.",
    ),
    paragraph(
      "CTFecho",
      "E, por estarem de pleno acordo, as partes assinam o presente contrato para " +
        "que produza seus efeitos jurídicos.",
    ),
    rightAlignedParagraph(
      "CTFecho",
      "{{contract_signature_place}}, {{contract_signature_date_long}}.",
    ),
    signatureTable(),
  ].join("");
}

function replaceBody(input: Buffer) {
  const zip = new PizZip(input);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("O contrato não contém word/document.xml.");
  const xml = file.asText();
  const open = xml.match(/^([\s\S]*?<w:body>)/)?.[1];
  const section = xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0];
  if (!open || !section) {
    throw new Error("A seção principal do contrato não foi localizada.");
  }
  zip.file(
    "word/document.xml",
    `${open}${contractBody()}${section}</w:body></w:document>`,
  );
  return Buffer.from(
    zip.generate({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}

const source = await readFile(SOURCE);
const sourceHash = sha256(source);
if (sourceHash !== EXPECTED_SOURCE_HASH) {
  throw new Error(
    `A versão 2 mudou. Esperado ${EXPECTED_SOURCE_HASH}, recebido ${sourceHash}.`,
  );
}

const output = applyCtDocumentStandard(replaceBody(source));
const variables = extractDocxVariables(output);
const expectedVariables = [
  "contract_employee_cpf",
  "contract_employer_cnpj",
  "contract_final_end_long",
  "contract_first_end_long",
  "contract_job_cbo",
  "contract_monthly_salary",
  "contract_signature_date_long",
  "contract_signature_place",
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
      outputHash: sha256(output),
      variables,
    },
    null,
    2,
  )}\n`,
);
