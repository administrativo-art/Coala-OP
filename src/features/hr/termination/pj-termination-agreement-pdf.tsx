import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { PjTerminationContractSnapshot, PjTerminationWitness } from "./types";

export type PjTerminationAgreementPdfData = {
  contract: PjTerminationContractSnapshot;
  terminationDate: string;
  daysWorked: number;
  prorataFormulaText: string;
  grossValue: number;
  invoiceNumber: string;
  invoiceDate: string;
  paymentDate: string;
  forumCity: string;
  signatureCity: string;
  signatureDate: string;
  witnesses: [PjTerminationWitness, PjTerminationWitness];
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingBottom: 54,
    paddingHorizontal: 50,
    fontFamily: "Helvetica",
    fontSize: 9.2,
    lineHeight: 1.5,
    color: "#202124",
  },
  title: { fontFamily: "Helvetica-Bold", fontSize: 14.5, textAlign: "center", marginBottom: 20 },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 10.2, textAlign: "center", marginTop: 13, marginBottom: 7 },
  paragraph: { marginBottom: 5.5, textAlign: "justify" },
  bold: { fontFamily: "Helvetica-Bold" },
  signatures: { flexDirection: "row", gap: 22, marginTop: 36 },
  signature: { flex: 1, borderTopWidth: 1, borderTopColor: "#374151", paddingTop: 7, textAlign: "center" },
  witnessRow: { flexDirection: "row", gap: 22, marginTop: 30 },
  witness: { flex: 1, borderTopWidth: 1, borderTopColor: "#374151", paddingTop: 7, fontSize: 8.7 },
  footer: { position: "absolute", left: 50, right: 50, bottom: 24, textAlign: "center", color: "#6b7280", fontSize: 7.5 },
});

function digits(value: string) { return value.replace(/\D/g, ""); }
function cnpj(value: string) {
  const normalized = digits(value);
  return normalized.length === 14
    ? normalized.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : value;
}
function cpf(value: string) {
  const normalized = digits(value);
  return normalized.length === 11
    ? normalized.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
    : value;
}
function dateBr(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.slice(0, 10));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
function longDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(date)
    : value;
}

const UNITS = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const TEENS = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function underThousand(value: number) {
  if (value === 100) return "cem";
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds) parts.push(HUNDREDS[hundreds]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    const tens = Math.floor(rest / 10);
    const units = rest % 10;
    if (tens) parts.push(TENS[tens]);
    if (units) parts.push(UNITS[units]);
  }
  return parts.join(" e ");
}

function integerWords(value: number): string {
  if (value === 0) return "zero";
  if (value < 1000) return underThousand(value);
  const groups = [
    { size: 1_000_000_000, one: "bilhão", many: "bilhões" },
    { size: 1_000_000, one: "milhão", many: "milhões" },
    { size: 1_000, one: "mil", many: "mil" },
  ];
  let rest = value;
  const parts: string[] = [];
  for (const group of groups) {
    const count = Math.floor(rest / group.size);
    if (!count) continue;
    parts.push(group.size === 1_000 && count === 1 ? "mil" : `${integerWords(count)} ${count === 1 ? group.one : group.many}`);
    rest %= group.size;
  }
  if (rest) parts.push(underThousand(rest));
  return parts.join(rest > 0 && rest < 100 ? " e " : " ");
}

export function moneyWords(value: number) {
  const cents = Math.round(value * 100);
  const reais = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `${integerWords(reais)} ${reais === 1 ? "real" : "reais"}${remainder ? ` e ${integerWords(remainder)} ${remainder === 1 ? "centavo" : "centavos"}` : ""}`;
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function Paragraph({ n, children }: { n?: string; children: React.ReactNode }) {
  return <Text style={styles.paragraph}>{n ? <Text style={styles.bold}>{n} </Text> : null}{children}</Text>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <Text style={styles.heading} minPresenceAhead={42}>{children}</Text>;
}

export function PjTerminationAgreementPdf({ data }: { data: PjTerminationAgreementPdfData }) {
  const { contractor, provider, sourceContract } = data.contract;
  const contractorProfessional = contractor.representative.professionalId
    ? `, ${contractor.representative.professionalId}`
    : "";
  return (
    <Document title={`Distrato de prestação de serviços - ${provider.legalName}`} author="Coala One">
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>DISTRATO DE CONTRATO DE PRESTAÇÃO DE SERVIÇOS</Text>

        <Paragraph><Text style={styles.bold}>CONTRATANTE: </Text>{contractor.legalName}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº {cnpj(contractor.cnpj)}, com endereço eletrônico {contractor.email}, neste ato representada por seu {contractor.representative.role} {contractor.representative.name}, {contractor.representative.qualification}, inscrito no CPF sob o nº {cpf(contractor.representative.cpf)}{contractorProfessional}, residente e domiciliado à {contractor.address}.</Paragraph>

        <Paragraph><Text style={styles.bold}>CONTRATADA: </Text>{provider.legalName}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº {cnpj(provider.cnpj)}, com sede à {provider.address}, endereço eletrônico {provider.email}, neste ato representada por {provider.representative.name}, {provider.representative.qualification}, inscrito(a) no CPF sob o nº {cpf(provider.representative.cpf)}, na forma de seu contrato social.</Paragraph>

        <Paragraph>As partes acima qualificadas, de comum acordo e na melhor forma de direito, resolvem rescindir o CONTRATO DE PRESTAÇÃO DE SERVIÇOS firmado em {dateBr(sourceContract.contractDate)}, mediante as cláusulas e condições seguintes.</Paragraph>

        <Heading>CLÁUSULA PRIMEIRA - DA RESCISÃO</Heading>
        <Paragraph n="1.1.">O contrato indicado no preâmbulo fica rescindido em {dateBr(data.terminationDate)}, de forma amigável e por mútuo consentimento, nos termos do art. 472 do Código Civil, cessando nessa data todas as obrigações de execução continuada nele previstas.</Paragraph>
        <Paragraph n="1.2.">As partes renunciam reciprocamente ao aviso prévio de 30 (trinta) dias previsto no item 10.1 do contrato rescindido, nada sendo devido a esse título por qualquer delas.</Paragraph>
        <Paragraph n="1.3.">As partes declaram inexistirem pendências financeiras ou obrigacionais decorrentes do contrato rescindido, ressalvado o pagamento tratado na Cláusula Segunda e as obrigações que este instrumento expressamente mantém.</Paragraph>
        <Paragraph n="1.4.">A CONTRATANTE declara ter recebido e aceitado os entregáveis correspondentes ao período de vigência, nada tendo a reclamar quanto à execução dos serviços.</Paragraph>

        <Heading>CLÁUSULA SEGUNDA - DOS VALORES DEVIDOS</Heading>
        <Paragraph n="2.1.">O contrato rescindido previa remuneração mensal de {money(sourceContract.monthlyValue)} ({moneyWords(sourceContract.monthlyValue)}). Considerando a prestação de serviços por {data.daysWorked} dias no período de apuração, as partes convencionam o critério de trinta avos, apurando o valor proporcional pela fórmula {data.prorataFormulaText}, do que resulta o valor de <Text style={styles.bold}>{money(data.grossValue)}</Text> ({moneyWords(data.grossValue)}).</Paragraph>
        <Paragraph n="2.2.">As partes declaram que o critério de apuração previsto no item 2.1 foi livremente pactuado e afasta qualquer outro método de cálculo proporcional, não cabendo posterior questionamento a esse respeito.</Paragraph>
        <Paragraph n="2.3.">O valor indicado no item 2.1 é bruto, sujeito às retenções tributárias exigidas por lei, e foi objeto da nota fiscal de serviços nº {data.invoiceNumber}, emitida em {dateBr(data.invoiceDate)}.</Paragraph>
        <Paragraph n="2.4.">A CONTRATADA declara ter recebido o valor em {dateBr(data.paymentDate)} e dá plena quitação da parcela.</Paragraph>

        <Heading>CLÁUSULA TERCEIRA - DAS OBRIGAÇÕES REMANESCENTES</Heading>
        <Paragraph n="3.1.">A CONTRATADA entregará à CONTRATANTE, no prazo de 24 (vinte e quatro) horas contadas da assinatura, todos os documentos, arquivos, materiais e bens de propriedade da CONTRATANTE que estejam em sua posse, em meio físico ou digital, e devolverá os bens eventualmente cedidos na forma da Cláusula Décima Terceira do contrato rescindido.</Paragraph>
        <Paragraph n="3.2.">A CONTRATANTE revogará, no mesmo prazo, todos os acessos concedidos à CONTRATADA e a seus prepostos, obrigando-se esta a não tentar utilizá-los a partir dessa data e a informar eventuais acessos remanescentes de que tenha conhecimento.</Paragraph>
        <Paragraph n="3.3.">A CONTRATADA eliminará os dados pessoais a que teve acesso em razão do contrato, nos termos dos arts. 15, IV, e 16 da Lei nº 13.709/2018, abrangendo cópias em serviços de armazenamento em nuvem, correio eletrônico e dispositivos, confirmando a eliminação por escrito no prazo de 10 (dez) dias, ressalvada a guarda imposta por norma legal ou por resolução de conselho profissional.</Paragraph>
        <Paragraph n="3.4.">A CONTRATADA declara não ter compartilhado com terceiros, a qualquer título, os dados e informações a que teve acesso em razão do contrato.</Paragraph>

        <Heading>CLÁUSULA QUARTA - DAS OBRIGAÇÕES SUBSISTENTES</Heading>
        <Paragraph n="4.1.">Subsistem à extinção do contrato, pelos prazos nelas previstos, as obrigações de confidencialidade da Cláusula Quinta, de proteção de dados da Cláusula Décima Primeira, de propriedade intelectual da Cláusula Décima Segunda e de responsabilidade pelos prepostos da Cláusula Décima Quarta do contrato rescindido.</Paragraph>
        <Paragraph n="4.2.">As partes ratificam a cessão de direitos patrimoniais prevista na Cláusula Décima Segunda do contrato rescindido, que permanece em pleno vigor, declarando a CONTRATADA que nada mais lhe é devido a esse título e que não retém cópia dos materiais cedidos, ressalvado o disposto no item 3.3.</Paragraph>
        <Paragraph n="4.3.">O descumprimento das obrigações mantidas por esta cláusula sujeita a infratora à cláusula penal prevista no item 8.2 do contrato rescindido, que permanece aplicável.</Paragraph>

        <Heading>CLÁUSULA QUINTA - DA QUITAÇÃO</Heading>
        <Paragraph n="5.1.">Com a assinatura deste instrumento e o recebimento declarado no item 2.4, as partes outorgam-se mútua, geral, plena e irrevogável quitação quanto a todas as obrigações decorrentes do contrato ora rescindido, para nada mais reclamarem entre si a qualquer tempo ou título, renunciando expressamente a qualquer direito ou pretensão dele decorrente.</Paragraph>
        <Paragraph n="5.2.">A CONTRATADA declara que os valores recebidos ao longo da vigência contemplam integralmente a contraprestação devida e que inexistem verbas pendentes em favor de seus sócios, empregados ou prepostos em razão dos serviços prestados à CONTRATANTE.</Paragraph>
        <Paragraph n="5.3.">A quitação do item 5.1 não alcança as obrigações mantidas pela Cláusula Quarta, que subsistem pelos prazos nelas fixados.</Paragraph>

        <Heading>CLÁUSULA SEXTA - DAS DISPOSIÇÕES FINAIS</Heading>
        <Paragraph n="6.1.">As partes reconhecem a validade, autenticidade e eficácia das assinaturas eletrônicas apostas neste instrumento, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001 e do art. 784, § 4º, do Código de Processo Civil.</Paragraph>
        <Paragraph n="6.2.">Este instrumento representa o acordo integral entre as partes quanto à extinção do contrato, substituindo quaisquer tratativas anteriores, verbais ou escritas.</Paragraph>
        <Paragraph n="6.3.">A eventual invalidade de qualquer disposição não afeta as demais, que permanecem em pleno vigor.</Paragraph>
        <Paragraph n="6.4.">Fica eleito o foro da Comarca de {data.forumCity} para dirimir controvérsias oriundas deste instrumento, com renúncia expressa a qualquer outro, por mais privilegiado que seja.</Paragraph>

        <Paragraph>E, por estarem assim justas e acordadas, as partes firmam o presente instrumento na presença de duas testemunhas.</Paragraph>
        <Paragraph>{data.signatureCity}, {longDate(data.signatureDate)}.</Paragraph>

        <View style={styles.signatures} wrap={false}>
          <Text style={styles.signature}><Text style={styles.bold}>{contractor.legalName}</Text>{"\n"}CNPJ {cnpj(contractor.cnpj)}{"\n"}CONTRATANTE</Text>
          <Text style={styles.signature}><Text style={styles.bold}>{provider.legalName}</Text>{"\n"}CNPJ {cnpj(provider.cnpj)}{"\n"}CONTRATADA</Text>
        </View>
        <View style={styles.witnessRow} wrap={false}>
          {data.witnesses.map((witness, index) => (
            <Text key={`${witness.cpf}-${index}`} style={styles.witness}><Text style={styles.bold}>{witness.name}</Text>{"\n"}CPF: {cpf(witness.cpf)}{"\n"}TESTEMUNHA</Text>
          ))}
        </View>

        <Text style={styles.footer} fixed>Distrato de prestação de serviços - {provider.legalName}</Text>
      </Page>
    </Document>
  );
}
