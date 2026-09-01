import { renderCoalaEmail } from '@/lib/email/template';

type VacationAccountantEmailInput = {
  employeeName: string;
  companyLegalName: string;
  acquisitionCycle: string;
  vacationStartDate: string;
  vacationEndDate: string;
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
    : `Recibo de férias - ${input.employeeName}`;
  const period = `${dateBr(input.vacationStartDate)} a ${dateBr(input.vacationEndDate)}`;
  const message = input.correctionReason
    ? `O RH solicitou uma nova versão do recibo de férias de ${input.employeeName}.\n\nMotivo: ${input.correctionReason}`
    : `O aviso de férias de ${input.employeeName} foi assinado. Prepare o recibo referente ao período de ${period} e envie o PDF original pelo link exclusivo abaixo.`;
  const details = [
    `Empresa: ${input.companyLegalName}`,
    `Período aquisitivo: ${input.acquisitionCycle}`,
    `Gozo: ${period}`,
  ].join('\n');
  return {
    subject,
    text: `${message}\n\n${details}\n\nEnviar recibo original: ${input.receiptUploadUrl}`,
    html: renderCoalaEmail({
      title: input.correctionReason ? 'Correção do recibo de férias' : 'Recibo de férias',
      message,
      emphasis: details,
      highlightBlock: {
        tone: 'pink',
        text: 'Envie o arquivo original em PDF. O documento será preservado para auditoria do RH.',
        action: { label: 'Enviar recibo de férias', url: input.receiptUploadUrl },
      },
    }),
  };
}

export function vacationReceiptSignatureMessage(input: VacationReceiptSignatureEmailInput) {
  return `O pagamento das férias de ${input.employeeName}, referente ao período de ${dateBr(input.vacationStartDate)} a ${dateBr(input.vacationEndDate)}, foi confirmado. Confira e assine eletronicamente o recibo.`;
}
