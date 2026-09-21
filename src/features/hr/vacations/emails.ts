import { renderCoalaEmail } from '@/lib/email/template';

type VacationAccountantEmailInput = {
  employeeName: string;
  employeeCpf: string;
  employeeRegistration: string;
  acquisitionPeriodStart: string;
  acquisitionPeriodEnd: string;
  vacationStartDate: string;
  vacationEndDate: string;
  vacationDays: number;
  returnDate: string;
  allowanceText: string;
  thirteenthAdvanceText: string;
  noticeSignedAt: string;
  receiptUploadUrl: string;
  correctionReason?: string | null;
};

type VacationReceiptSignatureEmailInput = {
  employeeName: string;
  vacationStartDate: string;
  vacationEndDate: string;
};

function dateBr(value: string) {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function vacationAccountantEmailContent(input: VacationAccountantEmailInput) {
  const subject = input.correctionReason
    ? `Correção do recibo de férias - ${input.employeeName}`
    : `Recibo de férias a preparar - ${input.employeeName}`;
  const period = `${dateBr(input.vacationStartDate)} a ${dateBr(input.vacationEndDate)}`;
  const message = input.correctionReason
    ? `O RH revisou os documentos de férias de ${input.employeeName} e precisa de uma nova versão. Você poderia, por gentileza, fazer o ajuste indicado abaixo e enviar os arquivos corrigidos?\n\nAjuste solicitado: ${input.correctionReason}`
    : `${input.employeeName} assinou o aviso de férias em ${input.noticeSignedAt}. Você poderia, por gentileza, preparar o recibo referente ao período abaixo e enviar o recibo e os documentos de apoio pelo link exclusivo deste e-mail?`;
  const details = [
    { label: 'Colaborador(a)', value: input.employeeName },
    { label: 'CPF · matrícula', value: `${input.employeeCpf} · ${input.employeeRegistration}` },
    { label: 'Período aquisitivo', value: `${dateBr(input.acquisitionPeriodStart)} a ${dateBr(input.acquisitionPeriodEnd)}` },
    { label: 'Gozo', value: `${period} · ${input.vacationDays} dias` },
    { label: 'Retorno ao trabalho', value: dateBr(input.returnDate) },
    { label: 'Abono pecuniário', value: input.allowanceText },
    { label: 'Antecipação do 13º', value: input.thirteenthAdvanceText },
  ];
  const actionLabel = input.correctionReason ? 'Enviar arquivos corrigidos' : 'Enviar arquivos';
  const actionTitle = input.correctionReason ? 'Envio dos arquivos corrigidos' : 'Envio seguro dos documentos';
  const actionText = input.correctionReason
    ? 'Quando o ajuste estiver pronto, use o botão abaixo para anexar os arquivos em PDF, JPG ou PNG.'
    : 'Quando os documentos estiverem prontos, use o botão abaixo para anexar um ou mais arquivos em PDF, JPG ou PNG. São aceitos até 20 arquivos por envio, com 15 MB por arquivo e 25 MB no conjunto; se necessário, faça outro envio pelo mesmo link. O copiloto indicará o provável recibo principal, e o RH fará a conferência e a escolha final.';
  const plainDetails = details.map((item) => `${item.label}: ${item.value}`).join('\n');
  return {
    subject,
    text: `${message}\n\n${plainDetails}\n\n${actionTitle}\n${actionText}\n${input.receiptUploadUrl}\n\nEste link é exclusivo desta solicitação, expira em 30 dias e não deve ser encaminhado.`,
    html: renderCoalaEmail({
      title: input.correctionReason ? 'Correção do recibo de férias' : 'Recibo de férias a preparar',
      message,
      details,
      highlightBlock: {
        tone: 'pink',
        title: actionTitle,
        text: actionText,
        note: 'Este link é exclusivo desta solicitação, expira em 30 dias e não deve ser encaminhado.',
        action: { label: actionLabel, url: input.receiptUploadUrl },
      },
    }),
  };
}

export function vacationReceiptSignatureMessage(input: VacationReceiptSignatureEmailInput) {
  return `O pagamento das férias de ${input.employeeName}, referente ao período de ${dateBr(input.vacationStartDate)} a ${dateBr(input.vacationEndDate)}, foi confirmado. Confira e assine eletronicamente o recibo.`;
}
