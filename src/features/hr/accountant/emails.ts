export type AccountantAdmissionEmailInput = {
  candidateName: string;
  jobFunction: string;
  companyName: string;
  companyCnpj: string;
  admissionDate: string;
  attachmentLabels: string[];
  registryUploadUrl: string;
};

export function accountantAdmissionEmailContent(input: AccountantAdmissionEmailInput) {
  const detailsBlock = [
    `Colaboradora: ${input.candidateName}`,
    `Cargo: ${input.jobFunction}`,
    `Empresa: ${input.companyName}`,
    `CNPJ: ${input.companyCnpj}`,
    `Data de admissão: ${input.admissionDate}`,
  ].join('\n');

  const attachments = input.attachmentLabels.map((label) => `• ${label}`).join('\n');
  const afterDetailsMessage = [
    'Documentos anexados:',
    '',
    attachments,
    '',
    'Importante: os demais contratos, termos e documentos internos da admissão serão preparados e tratados diretamente pela empresa, incluindo o contrato de trabalho por prazo de experiência, documentos relacionados à LGPD, banco de horas, vale-transporte, consentimento para uso de imagem e voz e outros termos internos.',
    '',
    'Não é necessário elaborar nem encaminhar esses documentos.',
  ].join('\n');

  return {
    subject: `Admissão - Documentos para registro - ${input.candidateName}`,
    title: undefined,
    message: 'Prezados, boa tarde.\n\nEncaminhamos os documentos necessários para o registro admissional da colaboradora abaixo:',
    detailsBlock,
    afterDetailsMessage,
    registryUploadLead: 'Após concluir o registro, envie somente a Ficha de Registro de Empregado pelo link abaixo.',
    registryUploadLabel: 'Enviar ficha de registro',
    registryUploadUrl: input.registryUploadUrl,
    text: [
      'Prezados, boa tarde.',
      '',
      'Encaminhamos os documentos necessários para o registro admissional da colaboradora abaixo:',
      '',
      detailsBlock,
      '',
      afterDetailsMessage,
      '',
      'Após concluir o registro, envie somente a Ficha de Registro de Empregado pelo link abaixo.',
      input.registryUploadUrl,
    ].join('\n'),
  };
}
