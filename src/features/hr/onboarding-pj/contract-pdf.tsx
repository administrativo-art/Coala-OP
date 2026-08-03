import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

export type PjContractData = {
  contractor: {
    name: string; cnpj: string; email: string; address: string;
    representativeName: string; representativeRole: string; representativeQualification: string;
    representativeCpf: string; representativeProfessionalId?: string | null;
  };
  provider: {
    name: string; cnpj: string; email: string; address: string;
    representativeName: string; representativeQualification: string; representativeCpf: string;
  };
  terms: {
    startDate: string; termType: 'fixed' | 'indefinite'; endDate?: string | null;
    monthlyValue: number; paymentDay: number;
    services: Array<{ front: string; deliverable: string }>;
  };
  forumCity: string;
  signatureCity: string;
  issueDate: string;
};

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 48, paddingHorizontal: 52, fontFamily: 'Helvetica', fontSize: 9.2, lineHeight: 1.48, color: '#1f2937' },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 15, textAlign: 'center', marginBottom: 18 },
  heading: { fontFamily: 'Helvetica-Bold', fontSize: 10.5, textAlign: 'center', marginTop: 14, marginBottom: 8 },
  paragraph: { marginBottom: 6, textAlign: 'justify' },
  bold: { fontFamily: 'Helvetica-Bold' },
  divider: { height: 1, backgroundColor: '#d1d5db', marginVertical: 13 },
  signatureRow: { flexDirection: 'row', gap: 24, marginTop: 34 },
  signature: { flex: 1, borderTopWidth: 1, borderTopColor: '#374151', paddingTop: 7, textAlign: 'center' },
  annexTitle: { fontFamily: 'Helvetica-Bold', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  table: { borderWidth: 1, borderColor: '#9ca3af', marginTop: 8 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#d1d5db' },
  lastRow: { flexDirection: 'row' },
  cellNumber: { width: '10%', padding: 6, borderRightWidth: 1, borderRightColor: '#d1d5db' },
  cellFront: { width: '35%', padding: 6, borderRightWidth: 1, borderRightColor: '#d1d5db' },
  cellDeliverable: { width: '55%', padding: 6 },
  headerCell: { fontFamily: 'Helvetica-Bold', backgroundColor: '#f3f4f6' },
});

function onlyDigits(value: string) { return value.replace(/\D/g, ''); }
function cnpj(value: string) { const d = onlyDigits(value); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : value; }
function cpf(value: string) { const d = onlyDigits(value); return d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : value; }
function dateBr(value: string) { const [year, month, day] = value.slice(0, 10).split('-'); return year && month && day ? `${day}/${month}/${year}` : value; }
function longDate(value: string) { const date = new Date(`${value.slice(0, 10)}T12:00:00Z`); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(date) : value; }

const UNITS = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const TEENS = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function underThousand(value: number) { if (value === 100) return 'cem'; const parts: string[] = []; const hundred = Math.floor(value / 100); const rest = value % 100; if (hundred) parts.push(HUNDREDS[hundred]); if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]); else { const ten = Math.floor(rest / 10); const unit = rest % 10; if (ten) parts.push(TENS[ten]); if (unit) parts.push(UNITS[unit]); } return parts.join(' e '); }
function integerWords(value: number): string { if (value === 0) return 'zero'; if (value < 1000) return underThousand(value); const groups = [{ size: 1_000_000_000, one: 'bilhão', many: 'bilhões' }, { size: 1_000_000, one: 'milhão', many: 'milhões' }, { size: 1000, one: 'mil', many: 'mil' }]; let rest = value; const parts: string[] = []; for (const group of groups) { const count = Math.floor(rest / group.size); if (!count) continue; parts.push(group.size === 1000 && count === 1 ? 'mil' : `${integerWords(count)} ${count === 1 ? group.one : group.many}`); rest %= group.size; } if (rest) parts.push(underThousand(rest)); return parts.join(rest > 0 && rest < 100 ? ' e ' : ' '); }
function valueText(value: number) { const cents = Math.round(value * 100); const reais = Math.floor(cents / 100); const rest = cents % 100; return `${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)} (${integerWords(reais)} ${reais === 1 ? 'real' : 'reais'}${rest ? ` e ${integerWords(rest)} ${rest === 1 ? 'centavo' : 'centavos'}` : ''})`; }

function P({ n, children }: { n: string; children: React.ReactNode }) { return <Text style={styles.paragraph}><Text style={styles.bold}>{n} </Text>{children}</Text>; }
function H({ children }: { children: React.ReactNode }) { return <Text style={styles.heading}>{children}</Text>; }

export function PjServiceContractPdf({ data }: { data: PjContractData }) {
  const professional = data.contractor.representativeProfessionalId ? `, ${data.contractor.representativeProfessionalId}` : '';
  return <Document title={`Contrato de prestação de serviços · ${data.provider.name}`} author="Coala One">
    <Page size="A4" style={styles.page}>
      <Text style={styles.title}>CONTRATO DE PRESTAÇÃO DE SERVIÇOS</Text>
      <Text style={styles.paragraph}><Text style={styles.bold}>CONTRATANTE: </Text>{data.contractor.name}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº {cnpj(data.contractor.cnpj)}, com sede à {data.contractor.address} e endereço eletrônico {data.contractor.email}, neste ato representada por seu {data.contractor.representativeRole} {data.contractor.representativeName}, {data.contractor.representativeQualification}, inscrito no CPF sob o nº {cpf(data.contractor.representativeCpf)}{professional}.</Text>
      <Text style={styles.paragraph}><Text style={styles.bold}>CONTRATADA: </Text>{data.provider.name}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº {cnpj(data.provider.cnpj)}, com sede à {data.provider.address}, endereço eletrônico {data.provider.email}, neste ato representada por {data.provider.representativeName}, {data.provider.representativeQualification}, inscrito(a) no CPF sob o nº {cpf(data.provider.representativeCpf)}, na forma de seu contrato social.</Text>
      <Text style={styles.paragraph}>As partes acima qualificadas celebram o presente CONTRATO DE PRESTAÇÃO DE SERVIÇOS, que se regerá pelas cláusulas e condições seguintes.</Text>

      <H>CLÁUSULA PRIMEIRA — DO OBJETO</H>
      <P n="1.1">Constitui objeto deste contrato a prestação dos serviços técnicos especializados descritos no Anexo I — Escopo e Entregáveis, executados pela CONTRATADA com autonomia técnica, organização própria e sem subordinação.</P>
      <P n="1.2">A CONTRATADA organiza livremente a forma, o tempo e o local de execução, obrigando-se quanto aos prazos e ao conteúdo dos entregáveis pactuados.</P>

      <H>CLÁUSULA SEGUNDA — DO ESCOPO, DOS ENTREGÁVEIS E DO ACEITE</H>
      <P n="2.1">Os serviços contratados e os respectivos entregáveis constam do Anexo I, que integra este instrumento para todos os fins.</P>
      <P n="2.2">A CONTRATADA responde pelo resultado dos entregáveis.</P>
      <P n="2.3">Os entregáveis serão encaminhados por meio eletrônico ao endereço indicado no preâmbulo.</P>
      <P n="2.4">A CONTRATANTE manifestará aceite ou apresentará ressalvas fundamentadas em até 5 (cinco) dias úteis do recebimento, presumindo-se aceito o entregável no silêncio.</P>
      <P n="2.5">Havendo ressalvas, a CONTRATADA promoverá os ajustes em até 5 (cinco) dias úteis, sem custo adicional.</P>
      <P n="2.6">Serviços não previstos no Anexo I não integram o objeto deste contrato e, se demandados, serão objeto de orçamento e contratação apartados.</P>
      <P n="2.7">A alteração do escopo depende de termo aditivo escrito ao Anexo I, assinado por ambas as partes, do qual constará o impacto sobre a remuneração, se houver.</P>

      <H>CLÁUSULA TERCEIRA — DAS OBRIGAÇÕES DA CONTRATANTE</H>
      <P n="3.1">Fornecer à CONTRATADA as informações necessárias à execução dos serviços, especificando os detalhes indispensáveis à sua perfeita consecução.</P>
      <P n="3.2">Formalizar por escrito as demandas relativas às frentes previstas no Anexo I.</P>
      <P n="3.3">Efetuar o pagamento na forma e nas condições da Cláusula Sétima.</P>
      <P n="3.4">Disponibilizar os materiais e recursos necessários à execução dos serviços, na forma da Cláusula Décima Terceira, quando aplicável.</P>

      <H>CLÁUSULA QUARTA — DAS OBRIGAÇÕES DA CONTRATADA</H>
      <P n="4.1">Executar os serviços com diligência técnica, observando os prazos pactuados e o conteúdo dos entregáveis previstos no Anexo I.</P>
      <P n="4.2">Utilizar os contratos, informações, dados, materiais e documentos da CONTRATANTE, de seus clientes e colaboradores estritamente para a execução dos serviços contratados, vedada a comercialização ou a utilização para qualquer outra finalidade, por si, por prepostos ou por terceiros.</P>
      <P n="4.3">Zelar pela conservação e pela segurança da documentação e dos registros sob sua responsabilidade.</P>
      <P n="4.4">Abster-se de divulgar, em qualquer meio ou plataforma digital, informações confidenciais da CONTRATANTE, de seus sócios, colaboradores, clientes ou fornecedores, bem como de utilizar a marca, o nome empresarial ou imagens da CONTRATANTE sem autorização prévia e escrita.</P>
      <P n="4.5">Fornecer a nota fiscal referente a cada pagamento deste instrumento.</P>
      <P n="4.6">Manter em dia, por sua exclusiva conta e responsabilidade, os registros e as obrigações pecuniárias referentes às exigências legais para execução de sua atividade, tais como o pagamento de todos os impostos, taxas e contribuições.</P>

      <H>CLÁUSULA QUINTA — DA CONFIDENCIALIDADE</H>
      <P n="5.1">A CONTRATADA obriga-se a manter sigilo sobre as operações, dados, estratégias, materiais, informações e documentos da CONTRATANTE, de seus colaboradores, clientes e fornecedores, obrigação que subsiste ao término deste contrato pelo prazo de 5 (cinco) anos.</P>
      <P n="5.2">Não se sujeitam ao item 5.1 as informações de domínio público, aquelas já conhecidas pela CONTRATADA antes deste contrato e aquelas cuja divulgação seja exigida por ordem judicial ou autoridade competente, hipótese em que a CONTRATANTE será previamente comunicada, sempre que possível.</P>
      <P n="5.3">A CONTRATADA obriga-se a estender as obrigações desta cláusula a seus sócios, empregados e prepostos, respondendo pelo respectivo cumprimento.</P>
      <P n="5.4">O descumprimento do item 5.1 sujeita a infratora à cláusula penal prevista no item 8.2.</P>

      <H>CLÁUSULA SEXTA — DA AUTONOMIA E DA INEXISTÊNCIA DE EXCLUSIVIDADE</H>
      <P n="6.1">A prestação não é exclusiva, podendo a CONTRATADA atender outros contratantes, desde que preservado o sigilo previsto na Cláusula Quinta e inexistente conflito de interesses com atividade concorrente da CONTRATANTE.</P>
      <P n="6.2">A CONTRATADA define autonomamente a forma, o horário e o local de execução, não se sujeitando a controle de jornada, escala ou ordens diretas, respondendo perante a CONTRATANTE pelo resultado dos entregáveis.</P>
      <P n="6.3">A prestação não é personalíssima. A CONTRATADA executa os serviços por meio de seus sócios, empregados ou prepostos, a seu exclusivo critério, podendo substituí-los a qualquer tempo mediante comunicação à CONTRATANTE, desde que preservada a qualificação técnica necessária.</P>

      <H>CLÁUSULA SÉTIMA — DO PREÇO E DAS CONDIÇÕES DE PAGAMENTO</H>
      <P n="7.1">Em contrapartida aos serviços prestados, a CONTRATANTE pagará à CONTRATADA o valor mensal de {valueText(data.terms.monthlyValue)}.</P>
      <P n="7.2">O pagamento será realizado até o dia {data.terms.paymentDay} de cada mês de vigência, mediante transferência bancária ou PIX para conta de titularidade da CONTRATADA, contra apresentação da nota fiscal correspondente.</P>
      <P n="7.3">Havendo prorrogação da vigência, o valor será reajustado anualmente pela variação do IPCA acumulado nos doze meses anteriores, ou por índice que venha a substituí-lo.</P>
      <P n="7.4">O atraso no pagamento sujeita a CONTRATANTE a juros de mora de 1% (um por cento) ao mês e multa de 2% (dois por cento) sobre o valor em atraso.</P>

      <H>CLÁUSULA OITAVA — DO DESCUMPRIMENTO E DA CLÁUSULA PENAL</H>
      <P n="8.1">O descumprimento de obrigação essencial por qualquer das partes autoriza a resolução imediata deste contrato, independentemente do prazo previsto no item 10.1, sem prejuízo da cláusula penal e das perdas e danos apurados.</P>
      <P n="8.2">O descumprimento pela CONTRATADA das obrigações de confidencialidade (Cláusula Quinta), de proteção de dados (Cláusula Décima Primeira), de propriedade intelectual (Cláusula Décima Segunda) ou de subcontratação (Cláusula Décima Sexta) sujeita-a ao pagamento de multa não compensatória de R$ 20.000,00 (vinte mil reais) ou do equivalente a 12 (doze) vezes o valor mensal previsto no item 7.1, prevalecendo o maior, corrigido pelo IPCA desde a data deste contrato.</P>
      <P n="8.3">O descumprimento das demais obrigações sujeita a parte infratora a multa não compensatória equivalente a 2 (duas) vezes o valor mensal previsto no item 7.1.</P>
      <P n="8.4">As multas previstas nesta cláusula não são compensatórias e não excluem a apuração de perdas e danos que as excederem, nos termos do art. 416, parágrafo único, do Código Civil, nem afastam a responsabilização civil e criminal cabível.</P>
      <P n="8.5">Configurando-se fraude, apropriação ou qualquer outro ilícito penal praticado pela CONTRATADA ou por seus prepostos na execução deste contrato, responderá ela pela integralidade do prejuízo causado, compreendendo danos emergentes e lucros cessantes, apurados de forma fundamentada e demonstrável, cumulativamente com a multa do item 8.2.</P>

      <H>CLÁUSULA NONA — DO PRAZO DE VIGÊNCIA</H>
      {data.terms.termType === 'fixed' ? <><P n="9.1">O presente contrato vigora de {dateBr(data.terms.startDate)} a {dateBr(data.terms.endDate ?? '')}.</P><P n="9.2">A vigência somente será prorrogada mediante termo aditivo escrito e assinado por ambas as partes, não se admitindo prorrogação tácita ou automática.</P></> : <P n="9.1">O presente contrato vigora por prazo indeterminado, com início em {dateBr(data.terms.startDate)}.</P>}

      <H>CLÁUSULA DÉCIMA — DA RESCISÃO</H>
      <P n="10.1">Este contrato poderá ser resilido imotivadamente por qualquer das partes, mediante comunicação escrita com antecedência mínima de 30 (trinta) dias, período em que serão concluídos e pagos os entregáveis já iniciados.</P>
      <P n="10.2">A CONTRATANTE poderá dispensar o cumprimento do prazo do item 10.1, hipótese em que serão devidos apenas os valores proporcionais aos serviços efetivamente prestados até a data da cessação.</P>
      <P n="10.3">A resilição prevista nesta cláusula não se confunde com a resolução por inadimplemento de que trata o item 8.1, que opera de forma imediata.</P>

      <H>CLÁUSULA DÉCIMA PRIMEIRA — DA PROTEÇÃO DE DADOS PESSOAIS</H>
      <P n="11.1">Para os fins da Lei nº 13.709/2018, a CONTRATANTE atua como controladora e a CONTRATADA como operadora dos dados pessoais tratados na execução deste contrato, competindo exclusivamente à CONTRATANTE definir as finalidades e os meios do tratamento.</P>
      <P n="11.2">A CONTRATADA tratará os dados pessoais estritamente conforme as instruções documentadas da CONTRATANTE e nos limites necessários à execução deste contrato, sendo-lhe vedado o tratamento para finalidade própria ou diversa.</P>
      <P n="11.3">A CONTRATADA reconhece que o tratamento poderá abranger dados pessoais sensíveis, nos termos do art. 5º, II, da Lei nº 13.709/2018, obrigando-se a adotar medidas de segurança técnicas e administrativas compatíveis com o risco.</P>
      <P n="11.4">É vedada a subcontratação de terceiros para tratamento de dados sem autorização prévia e escrita da CONTRATANTE, respondendo a CONTRATADA pelos atos dos terceiros que vier a envolver.</P>
      <P n="11.5">A CONTRATADA comunicará à CONTRATANTE qualquer incidente de segurança envolvendo dados pessoais no prazo de 24 (vinte e quatro) horas contadas do conhecimento do fato, prestando as informações necessárias à comunicação à Autoridade Nacional de Proteção de Dados e aos titulares.</P>
      <P n="11.6">A CONTRATADA auxiliará a CONTRATANTE no atendimento às requisições de titulares e às determinações de autoridades, nos prazos legais.</P>
      <P n="11.7">Encerrado o contrato, a CONTRATADA eliminará ou devolverá à CONTRATANTE, conforme instrução desta, todos os dados pessoais a que teve acesso, incluindo cópias em serviços de armazenamento em nuvem, correio eletrônico e dispositivos, confirmando a eliminação por escrito no prazo de 10 (dez) dias, ressalvada a guarda imposta por norma legal ou por resolução de conselho profissional.</P>
      <P n="11.8">A CONTRATADA responde regressivamente perante a CONTRATANTE pelas sanções administrativas, indenizações e demais prejuízos decorrentes de tratamento realizado em desconformidade com esta cláusula ou com as instruções recebidas.</P>

      <H>CLÁUSULA DÉCIMA SEGUNDA — DA PROPRIEDADE INTELECTUAL</H>
      <P n="12.1">A CONTRATADA cede e transfere à CONTRATANTE, em caráter total, definitivo, irrevogável e irretratável, os direitos patrimoniais sobre todos os materiais, relatórios, normas, políticas, processos, procedimentos, manuais, fluxos, instrumentos, bases de dados e demais obras desenvolvidas na execução deste contrato por seus sócios, empregados ou prepostos, declarando dispor dos instrumentos necessários para tanto e responder por eventual reivindicação de autoria.</P>
      <P n="12.2">A cessão prevista no item 12.1 abrange todas as modalidades de utilização existentes, notadamente reprodução, edição, adaptação, modificação, tradução, distribuição, comunicação ao público e utilização em qualquer suporte ou meio, sem limitação de tempo e com validade em todos os territórios.</P>
      <P n="12.3">A remuneração prevista na Cláusula Sétima compreende integralmente a contraprestação pela cessão de que trata esta cláusula, nada mais sendo devido à CONTRATADA a esse título, a qualquer tempo.</P>
      <P n="12.4">A CONTRATADA dispensa a indicação de autoria nas obras cedidas e autoriza sua modificação, adaptação e atualização pela CONTRATANTE ou por terceiros por ela indicados, sem necessidade de nova anuência, respeitados os direitos morais indisponíveis.</P>
      <P n="12.5">Desenvolvido programa de computador no âmbito deste contrato, sua titularidade pertence exclusivamente à CONTRATANTE, nos termos do art. 4º da Lei nº 9.609/1998, incluindo códigos-fonte, documentação e materiais correlatos.</P>
      <P n="12.6">A CONTRATADA declara que os materiais entregues não violam direitos de terceiros, respondendo por eventuais reivindicações.</P>

      <H>CLÁUSULA DÉCIMA TERCEIRA — DOS BENS CEDIDOS E DOS ACESSOS</H>
      <P n="13.1">Havendo cessão de bens, equipamentos, contas de correio eletrônico, credenciais de acesso a sistemas ou quaisquer outros recursos pela CONTRATANTE, a entrega será formalizada em termo próprio, com descrição e valor de reposição de cada item, aplicando-se o regime do comodato.</P>
      <P n="13.2">Os bens e recursos cedidos permanecem integrando o patrimônio da CONTRATANTE, destinam-se exclusivamente à execução dos serviços contratados e não podem ser utilizados para finalidade diversa, nos termos do art. 582 do Código Civil.</P>
      <P n="13.3">As vedações e obrigações relativas ao uso alcançam exclusivamente os bens e recursos cedidos, não se estendendo a equipamentos, conexões ou contas de titularidade da CONTRATADA.</P>
      <P n="13.4">A CONTRATADA responde pela guarda e conservação dos bens cedidos e, em caso de perda, furto, roubo, extravio ou dano, pelo valor de reposição apurado pelo preço de mercado na data do evento, autorizada a compensação com valores devidos pela CONTRATANTE.</P>
      <P n="13.5">A CONTRATANTE poderá exigir a devolução a qualquer tempo, e, encerrado o contrato, os bens serão devolvidos e os acessos revogados no prazo de 24 (vinte e quatro) horas, mediante termo de devolução com conferência do que foi entregue.</P>

      <H>CLÁUSULA DÉCIMA QUARTA — DA RESPONSABILIDADE PELOS PREPOSTOS</H>
      <P n="14.1">Os sócios, empregados e prepostos da CONTRATADA não mantêm qualquer vínculo com a CONTRATANTE, correndo por conta exclusiva da CONTRATADA as obrigações trabalhistas, previdenciárias, securitárias e de segurança do trabalho a eles relativas.</P>
      <P n="14.2">A CONTRATADA obriga-se a manter em dia o pagamento de salários, verbas rescisórias, recolhimentos previdenciários e de FGTS de seus empregados alocados na execução deste contrato.</P>
      <P n="14.3">A CONTRATADA responde integralmente por reclamações, autuações, condenações e despesas, inclusive honorários advocatícios e custas processuais, que a CONTRATANTE venha a suportar em razão de vínculo alegado por preposto seu ou de inadimplemento de obrigação trabalhista ou previdenciária de sua responsabilidade, obrigando-se ao reembolso em 10 (dez) dias contados da comprovação do desembolso.</P>
      <P n="14.4">Notificada de inadimplemento da CONTRATADA perante seus prepostos, a CONTRATANTE poderá reter os pagamentos devidos até a comprovação da regularização, sem que a retenção configure mora ou autorize a suspensão dos serviços.</P>
      <P n="14.5">A CONTRATANTE poderá exigir, a qualquer tempo, a comprovação do cumprimento das obrigações previstas no item 14.2, sem que a fiscalização implique ingerência na organização da CONTRATADA ou subordinação de seus prepostos.</P>

      <H>CLÁUSULA DÉCIMA QUINTA — DA REGULARIDADE DA CONTRATADA</H>
      <P n="15.1">A CONTRATADA declara estar regularmente constituída, com objeto social compatível com os serviços contratados, e obriga-se a manter durante toda a vigência as condições de habilitação e de regularidade fiscal, trabalhista e previdenciária.</P>
      <P n="15.2">A CONTRATADA apresentará, sempre que solicitada, certidões negativas de débitos federais, trabalhistas e de FGTS, bem como comprovação de inscrição municipal, quando exigível para a emissão de nota fiscal de serviços.</P>
      <P n="15.3">A CONTRATADA comunicará à CONTRATANTE, no prazo de 10 (dez) dias, qualquer alteração de seu quadro societário, denominação, sede, objeto social ou regime tributário.</P>
      <P n="15.4">A perda das condições de regularidade ou a omissão da comunicação prevista no item 15.3 autoriza a resolução do contrato na forma do item 8.1.</P>

      <H>CLÁUSULA DÉCIMA SEXTA — DA SUBCONTRATAÇÃO</H>
      <P n="16.1">A subcontratação total ou parcial dos serviços depende de autorização prévia e escrita da CONTRATANTE.</P>
      <P n="16.2">Autorizada a subcontratação, a CONTRATADA permanece integralmente responsável perante a CONTRATANTE pela execução dos serviços e pelo cumprimento, por parte da subcontratada, das obrigações de confidencialidade, proteção de dados pessoais e propriedade intelectual previstas neste contrato.</P>
      <P n="16.3">A subcontratação não autorizada caracteriza inadimplemento para os fins do item 8.1.</P>

      <H>CLÁUSULA DÉCIMA SÉTIMA — DAS DISPOSIÇÕES GERAIS</H>
      <P n="17.1">Fica pactuada a inexistência de vínculo empregatício entre as partes e entre a CONTRATANTE e os prepostos da CONTRATADA, não havendo subordinação de qualquer natureza.</P>
      <P n="17.2">A CONTRATADA presta os serviços com estrutura, organização e meios próprios, assumindo os riscos de sua atividade econômica, na forma do art. 129 da Lei nº 11.196/2005, ressalvados os bens eventualmente cedidos na forma da Cláusula Décima Terceira, cuja cessão decorre de exigência de segurança da informação e não implica subordinação.</P>
      <P n="17.3">A tolerância de qualquer das partes quanto ao descumprimento de termo ou condição não implica renúncia ao direito de exigi-lo, nem novação de obrigação passada, presente ou futura.</P>
      <P n="17.4">As comunicações entre as partes serão feitas por escrito, aos endereços eletrônicos indicados no preâmbulo, presumindo-se recebidas na data do envio.</P>
      <P n="17.5">As partes reconhecem a validade, autenticidade e eficácia das assinaturas eletrônicas apostas neste instrumento e em seu anexo por meio de plataforma de assinatura digital, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001 e do art. 784, § 4º, do Código de Processo Civil.</P>
      <P n="17.6">Este contrato e seu anexo representam o acordo integral entre as partes, substituindo tratativas anteriores, verbais ou escritas.</P>
      <P n="17.7">A eventual invalidade de qualquer disposição não afeta as demais, que permanecem em pleno vigor.</P>
      <P n="17.8">As Cláusulas Quinta, Décima Primeira, Décima Segunda, Décima Terceira e Décima Quarta subsistem ao término deste contrato, pelos prazos nelas previstos.</P>

      <H>CLÁUSULA DÉCIMA OITAVA — DO FORO</H>
      <P n="18.1">Fica eleito o foro da Comarca de {data.forumCity} para dirimir controvérsias oriundas deste contrato, com renúncia expressa a qualquer outro, por mais privilegiado que seja.</P>
      <Text style={[styles.paragraph, { marginTop: 14 }]}>E, por estarem assim justas e acordadas, as partes firmam eletronicamente o presente instrumento e seu anexo.</Text>
      <Text style={[styles.paragraph, { textAlign: 'right', marginTop: 10 }]}>{data.signatureCity}, {longDate(data.issueDate)}.</Text>
      <View style={styles.signatureRow}><Text style={styles.signature}><Text style={styles.bold}>{data.contractor.name}</Text>{'\n'}CNPJ {cnpj(data.contractor.cnpj)}{'\n'}CONTRATANTE</Text><Text style={styles.signature}><Text style={styles.bold}>{data.provider.name}</Text>{'\n'}CNPJ {cnpj(data.provider.cnpj)}{'\n'}CONTRATADA</Text></View>
    </Page>
    <Page size="A4" style={styles.page}>
      <Text style={styles.annexTitle}>ANEXO I — ESCOPO E ENTREGÁVEIS</Text>
      <Text style={styles.paragraph}>Anexo ao Contrato de Prestação de Serviços firmado entre {data.contractor.name} e {data.provider.name}.</Text>
      <Text style={[styles.bold, { marginTop: 12 }]}>1. Frentes contratadas</Text>
      <View style={styles.table}>
        <View style={styles.row}><Text style={[styles.cellNumber, styles.headerCell]}>#</Text><Text style={[styles.cellFront, styles.headerCell]}>Frente</Text><Text style={[styles.cellDeliverable, styles.headerCell]}>Entregável</Text></View>
        {data.terms.services.map((service, index) => <View key={`${index}-${service.front}`} style={index === data.terms.services.length - 1 ? styles.lastRow : styles.row}><Text style={styles.cellNumber}>1.{index + 1}</Text><Text style={styles.cellFront}>{service.front}</Text><Text style={styles.cellDeliverable}>{service.deliverable}</Text></View>)}
      </View>
      <Text style={[styles.bold, { marginTop: 16 }]}>2. Delimitação</Text>
      <P n="2.1">Cada frente compreende as tarefas técnicas necessárias à produção do entregável correspondente, executadas com autonomia pela CONTRATADA.</P>
      <P n="2.2">Não integram o escopo os serviços que não estejam descritos na tabela acima.</P>
      <Text style={[styles.paragraph, { textAlign: 'right', marginTop: 24 }]}>{data.signatureCity}, {longDate(data.issueDate)}.</Text>
      <View style={styles.signatureRow}><Text style={styles.signature}><Text style={styles.bold}>{data.contractor.name}</Text>{'\n'}CONTRATANTE</Text><Text style={styles.signature}><Text style={styles.bold}>{data.provider.name}</Text>{'\n'}CONTRATADA</Text></View>
    </Page>
  </Document>;
}
