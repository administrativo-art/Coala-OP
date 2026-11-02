import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import PizZip from "pizzip";

import { extractDocxVariables } from "../src/features/hr/documents/docx-generator";

const SOURCE = path.resolve(
  "docs/modelos-documentos/admissionais/03-termo-lgpd-v5.docx",
);
const OUTPUT = path.resolve(
  "docs/modelos-documentos/admissionais/03-termo-lgpd-v6.docx",
);
const EXPECTED_SOURCE_HASH =
  "0dd7f0309096dd7e7a938d8789fcb297c1a25b78f56f22ee135ae3be0edb2ba2";
const EXPECTED_OUTPUT_HASH =
  "09658d1c5dea398dcf76100fe30c9ac1b540b9ba4253021686a95f5b4549ec0d";

const PARAGRAPH = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function paragraphText(paragraph: string) {
  return [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join("");
}

/** Novo parágrafo com o espaçamento e a fonte do parágrafo-modelo, em um único trecho. */
function likeParagraph(template: string, text: string) {
  const properties = template.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
  const runProperties = template.match(/<w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] ?? "";
  return `<w:p>${properties}<w:r>${runProperties}`
    + `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

const SECTION_3B_3C = [
  ["heading", "3-B. Acompanhamento da localização durante a jornada e aparelhos empresariais"],
  ["body", "I — Quando ocorre. Exclusivamente nos turnos que a CONTROLADORA configurar expressamente para trabalho entre unidades ou atividade externa, e somente para os colaboradores incluídos nessa configuração. O acompanhamento começa com a marcação de início da jornada, é pausado no intervalo, é retomado na volta e termina com a marcação de fim da jornada, com a saída da conta, com a troca de usuário ou por interrupção manual. Não haverá acompanhamento fora da jornada, em folgas, férias ou afastamentos."],
  ["body", "II — Aparelho. O acompanhamento ocorre no aparelho em que o TITULAR estiver autenticado no Coala Go, seja ele empresarial ou pessoal. Enquanto estiver ativo, o aparelho exibirá notificação permanente informando a coleta."],
  ["body", "III — Dados tratados. Coordenadas geográficas, precisão, velocidade e deslocamento informados pelo aparelho, data e horário, situação da sessão (início, pausa, retomada e encerramento) e, quando necessário, endereço aproximado obtido por serviço de geocodificação. Esses dados não serão utilizados para inferências sobre saúde, comportamento, postura, religião ou vida privada."],
  ["body", "IV — Frequência. Em deslocamento, é registrada no máximo uma posição a cada 2 minutos; com o aparelho parado, uma posição a cada 15 minutos. Posições com precisão pior que 150 metros são descartadas no próprio aparelho. A CONTROLADORA poderá reduzir essa frequência para diminuir o consumo de bateria e a coleta desnecessária, sem ampliar o período do inciso I. Aumento de frequência ou uso de outros sinais do aparelho exigirá nova versão deste Termo."],
  ["body", "V — Finalidade. Apoiar a organização operacional e logística do trabalho entre unidades e manter histórico para conferência humana do local de prestação dos serviços."],
  ["body", "VI — Usos vedados. A localização não valida, não autoriza e não impede a marcação de ponto e não produzirá automaticamente falta, desconto, advertência, alteração do registro de ponto, da folha ou do banco de horas. Qualquer utilização como evidência dependerá de conferência humana e de oportunidade de esclarecimento pelo TITULAR."],
  ["body", "VII — Acesso, conservação e direitos. Aplicam-se os incisos V, VI e VII da seção 3-A."],
  ["body", "VIII — Aparelhos empresariais. Os aparelhos fornecidos pela CONTROLADORA poderão ser administrados por ferramenta de gestão de dispositivos, que permite identificar o aparelho e o usuário vinculado, instalar e atualizar aplicativos da empresa, aplicar configurações de segurança e bloquear ou apagar remotamente o aparelho em caso de perda, roubo, substituição ou encerramento do vínculo. O vínculo entre aparelho e usuário, suas alterações e revogações são registrados em auditoria. O aparelho empresarial destina-se ao trabalho, e o TITULAR não deverá armazenar nele conteúdo pessoal."],
  ["body", "IX — Ciência e fundamento. Aplica-se o inciso VIII da seção 3-A."],
  ["heading", "3-C. Metas, desempenho e premiação"],
  ["body", "I — Dados tratados. Identificação, unidade, turnos e dias escalados, meta atribuída, resultado apurado, progresso no período e informações de assiduidade, pontualidade e disciplina utilizadas como condição de premiação."],
  ["body", "II — Finalidade. Definir metas individuais e coletivas, acompanhar resultados, apurar e pagar prêmios nos termos do Regulamento de Metas e Prêmios, realizar os lançamentos em folha e demonstrar a regularidade dos pagamentos."],
  ["body", "III — Apuração automatizada. A meta individual e o resultado são calculados pelo sistema a partir dos registros de vendas, das escalas e da distribuição definida para o período. O TITULAR poderá solicitar ao Departamento Pessoal, ou pelo canal administrativo@coalashakes.com, a demonstração e a revisão da apuração."],
  ["body", "IV — Divulgação interna. Os resultados individuais poderão ser consultados pelos gestores responsáveis e, quando a CONTROLADORA decidir, exibidos em telas e murais internos da unidade. Telas voltadas ao público não exibirão dados de colaboradores."],
  ["body", "V — Regras do prêmio. Critérios, valores, condições e forma de pagamento estão no Regulamento de Metas e Prêmios. Este Termo trata somente dos dados pessoais utilizados para essa finalidade."],
] as const;

function prepareTerm(input: Buffer) {
  const zip = new PizZip(input);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("O termo não contém word/document.xml.");
  const documentDate = file.date;
  const xml = file.asText();
  const paragraphs = xml.match(PARAGRAPH) ?? [];
  const body = xml.split(PARAGRAPH);
  if (body.length !== paragraphs.length + 1) throw new Error("Estrutura de parágrafos inesperada.");

  const find = (predicate: (text: string) => boolean, label: string) => {
    const indexes = paragraphs.flatMap((p, i) => (predicate(paragraphText(p)) ? [i] : []));
    if (indexes.length !== 1) throw new Error(`${label}: ${indexes.length} ocorrência(s); esperado: 1.`);
    return indexes[0]!;
  };
  const startsWith = (prefix: string) => find((text) => text.startsWith(prefix), prefix);
  const output = paragraphs.map((p) => [p]);
  const replaceIn = (index: number, from: string, to: string) => {
    const current = output[index]![0]!;
    if (current.split(escapeXml(from)).length !== 2) throw new Error(`Trecho não encontrado: ${from}`);
    output[index]![0] = current.replace(escapeXml(from), escapeXml(to));
  };
  const after = (index: number, ...extra: string[]) => output[index]!.push(...extra);
  const before = (index: number, ...extra: string[]) => output[index]!.unshift(...extra);

  const listTemplate = paragraphs[startsWith("XVI – Atestados de Saúde Ocupacional")]!;
  const bodyTemplate = paragraphs[startsWith("A CONTROLADORA deverá limitar a coleta")]!;
  const clauseTemplate = paragraphs[startsWith("III — Acompanhamento entre unidades.")]!;
  const headingTemplate = paragraphs[startsWith("3-A. Localização")]!;
  const list = (text: string) => likeParagraph(listTemplate, text);

  replaceIn(startsWith("Eu, {{employee.name}}"), "{{integration.employer_name}}., inscrita", "{{integration.employer_name}}, inscrita");

  // 2. Dados pessoais tratados
  replaceIn(
    startsWith("XVII – informações técnicas e registros de auditoria"),
    "relacionados aos sistemas utilizados pela empresa",
    "relacionados aos sistemas e aplicativos utilizados pela empresa, como identificação da conta e da sessão, conta Google vinculada ao acesso, identificador da instalação do aplicativo, verificação de integridade do aplicativo e do aparelho, token de notificações e registros de acesso e de uso das funcionalidades",
  );
  const biometric = startsWith("XVIII – dado biométrico do TITULAR");
  replaceIn(biometric, "para qualquer outra finalidade.", "para qualquer outra finalidade;");
  after(
    biometric,
    list("XIX – metas atribuídas, resultados de vendas apurados por unidade e por colaborador, progresso no período de apuração e informações de assiduidade, pontualidade e disciplina utilizadas como condição de premiação;"),
    list("XX – dados de localização e informações técnicas do aparelho, nos limites das seções 3-A e 3-B."),
    likeParagraph(bodyTemplate, "O desbloqueio do aplicativo por digital ou reconhecimento facial, quando habilitado pelo TITULAR, é realizado pelo próprio sistema do aparelho. Nesse caso, a CONTROLADORA não recebe nem armazena dado biométrico."),
  );

  // 3. Finalidades do tratamento
  const lastPurpose = startsWith("XXII – cumprir determinações legais");
  replaceIn(lastPurpose, "autoridades competentes.", "autoridades competentes;");
  after(
    lastPurpose,
    list("XXIII – definir metas, acompanhar resultados e apurar e pagar prêmios, nos termos da seção 3-C e do Regulamento de Metas e Prêmios;"),
    list("XXIV – organizar a comunicação interna da operação, inclusive por telas e murais internos das unidades;"),
    list("XXV – administrar, proteger e acompanhar os aparelhos e aplicativos utilizados no trabalho, inclusive os aparelhos empresariais."),
  );

  // 3-A, inciso III, e novas seções 3-B e 3-C antes da seção 4
  output[startsWith("III — Acompanhamento entre unidades.")] = [
    likeParagraph(clauseTemplate, "III — Acompanhamento durante a jornada. O acompanhamento periódico da localização durante a jornada segue a seção 3-B."),
  ];
  replaceIn(
    startsWith("IV — Limitações e consequências."),
    "esclarecimentos do TITULAR.",
    "esclarecimentos do TITULAR. As coordenadas não integram o registro de ponto, o comprovante nem os arquivos fiscais.",
  );
  before(
    startsWith("4. Dados de saúde"),
    ...SECTION_3B_3C.map(([kind, text]) => likeParagraph(kind === "heading" ? headingTemplate : clauseTemplate, text)),
  );

  // 7. Compartilhamento dos dados
  replaceIn(
    startsWith("II – prestadores de tecnologia"),
    "armazenamento em nuvem e suporte técnico;",
    "armazenamento em nuvem, suporte técnico, envio de e-mails e notificações, mapas e geocodificação e gestão de dispositivos;",
  );
  const otherProviders = startsWith("XII – outros prestadores");
  replaceIn(otherProviders, "XII – outros prestadores", "XIII – outros prestadores");
  before(otherProviders, list("XII – serviços de inteligência artificial utilizados para leitura, classificação e organização de documentos, sem decisão final automática sobre o TITULAR;"));
  const sharingLimit = startsWith("O compartilhamento deverá ser limitado");
  after(sharingLimit, likeParagraph(paragraphs[sharingLimit]!, "Internamente, telas e murais das unidades poderão exibir escala, metas, resultados e comunicados a quem trabalha na unidade. Telas voltadas ao público não exibirão dados pessoais de colaboradores."));

  // 10. Registros eletrônicos e auditoria
  const signatureRecords = startsWith("X – registros de autenticação e assinatura eletrônica");
  replaceIn(signatureRecords, "assinatura eletrônica.", "assinatura eletrônica;");
  after(
    signatureRecords,
    list("XI – registros de acesso e de uso dos sistemas e aplicativos, inclusive consultas a dados de outros colaboradores;"),
    list("XII – verificação de integridade do aplicativo e do aparelho."),
  );
  const recordsUse = startsWith("Essas informações serão utilizadas para segurança");
  before(recordsUse, likeParagraph(paragraphs[recordsUse]!, "O acesso de administradores para suporte técnico aos dados de outro usuário será feito somente em modo de leitura e registrado em auditoria."));

  // 15. Declaração de ciência
  const optionalConsents = startsWith("IX – compreende que consentimentos opcionais");
  replaceIn(optionalConsents, "apresentados separadamente.", "apresentados separadamente;");
  after(
    optionalConsents,
    list("X – foi informado sobre o tratamento de localização e sobre a gestão de aparelhos empresariais, nos termos das seções 3-A e 3-B;"),
    list("XI – foi informado sobre o tratamento de dados de metas, desempenho e premiação, nos termos da seção 3-C."),
  );

  const documentXml = body.map((chunk, i) => chunk + (output[i]?.join("") ?? "")).join("");
  // Preserva a data da entrada para que execuções idênticas produzam o mesmo
  // ZIP e, portanto, o mesmo hash imutável catalogado.
  zip.file("word/document.xml", documentXml, { date: documentDate });
  return Buffer.from(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

const source = await readFile(SOURCE);
const sourceHash = sha256(source);
if (sourceHash !== EXPECTED_SOURCE_HASH) {
  throw new Error(`A versão 5 mudou. Esperado ${EXPECTED_SOURCE_HASH}, recebido ${sourceHash}.`);
}

const output = prepareTerm(source);
const outputHash = sha256(output);
if (outputHash !== EXPECTED_OUTPUT_HASH) {
  throw new Error(`A versão 6 divergiu. Esperado ${EXPECTED_OUTPUT_HASH}, recebido ${outputHash}.`);
}
const variables = extractDocxVariables(output);
const expectedVariables = [
  "employee.cpf",
  "employee.name",
  "integration.employer_address",
  "integration.employer_cnpj",
  "integration.employer_name",
];
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
