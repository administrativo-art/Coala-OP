export const MEDCLINIC_CANDIDATE_LOCATION = {
  name: 'MedClinic',
  address: 'Av. Getúlio Vargas, 43 · Monte Castelo',
  city: 'São Luís/MA · CEP 65020-300',
  reference: 'Em frente ao SENAI',
  mapsUrl: 'https://maps.app.goo.gl/XMrzpX7e8x54HP939',
} as const;

export type AsoAttachmentDescription = { label: string; fileName: string };

export function clinicAsoEmailContent(input: {
  candidateName: string;
  jobFunction: string;
  companyName: string;
  companyCnpj: string;
  companyAddress: string;
  companyContacts: string;
  attachments: AsoAttachmentDescription[];
  examType?: 'admission' | 'dismissal';
}) {
  const examLabel = input.examType === 'dismissal' ? 'DEMISSIONAL' : 'ADMISSIONAL';
  const attachmentLines = input.attachments.map((attachment, index) => `• ${attachment.label} - anexo ${index + 1}`).join('\n');
  const message = [
    'Prezados, boa tarde.',
    '',
    'Gostaria de agendar um exame para uma colaboradora.',
    '',
    'Exame:',
    '',
    `• Atestado de saúde ocupacional - ASO ${examLabel}`,
    '',
    'Empresa:',
    '',
    `• ${input.companyName} | ${input.companyCnpj} | ${input.companyAddress} | ${input.companyContacts}.`,
    '',
    'Colaboradores:',
    '',
    `• ${input.candidateName}, ${input.jobFunction};`,
    '',
    'Anexos:',
    '',
    attachmentLines,
  ].join('\n');
  return {
    subject: `ASO ${input.examType === 'dismissal' ? 'demissional' : 'admissional'} - Solicitação - ${input.candidateName}`,
    title: undefined,
    message,
    emphasis: 'Por gentileza, responda este e-mail com o agendamento ou informe a data e o horário pelo link abaixo.',
    text: `${message}\n\nPor gentileza, responda este e-mail com o agendamento ou informe a data e o horário pelo link fornecido.`,
  };
}

export function candidateAsoEmailContent(input: {
  candidateName: string;
  appointmentLabel: string;
  instructions?: string | null;
  uploadUrl: string;
  examType?: 'admission' | 'dismissal';
}) {
  const location = MEDCLINIC_CANDIDATE_LOCATION;
  const message = [
    `Olá, ${input.candidateName}.`,
    '',
    `Seu exame ${input.examType === 'dismissal' ? 'demissional' : 'admissional'} foi agendado para ${input.appointmentLabel}.`,
    '',
  ].join('\n');
  const locationBlock = [
    `Clínica: ${location.name}`,
    `Endereço: ${location.address}`,
    location.city,
    `Referência: ${location.reference}`,
  ].join('\n');
  const afterActionMessage = [
    ...(input.instructions ? [`Orientações adicionais: ${input.instructions}`, ''] : []),
    'Apresente-se com antecedência e leve um documento oficial com foto, como CIN ou RG, CNH ou passaporte.',
  ].join('\n');
  return {
    subject: `ASO ${input.examType === 'dismissal' ? 'demissional' : 'admissional'} - Agendamento`,
    title: undefined,
    message,
    locationBlock,
    afterActionMessage,
    text: `${message}\n\n${locationBlock}\nLocalização: ${location.mapsUrl}\n\n${afterActionMessage}\n\nApós o exame, envie o ASO digitalizado por esse link: ${input.uploadUrl}`,
    mapsUrl: location.mapsUrl,
  };
}
