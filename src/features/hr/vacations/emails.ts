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
    ? `O RH revisou o recibo de férias de ${input.employeeName} e precisa de uma nova versão. Você poderia, por gentileza, fazer o ajuste indicado abaixo e enviar novamente o PDF original?\n\nAjuste solicitado: ${input.correctionReason}`
    : `${input.employeeName} assinou o aviso de férias em ${input.noticeSignedAt}. Você poderia, por gentileza, preparar o recibo referente ao período abaixo e nos devolver o PDF original pelo link exclusivo deste e-mail?`;
  const details = [
    { label: 'Colaborador(a)', value: input.employeeName },
    { label: 'CPF · matrícula', value: `${input.employeeCpf} · ${input.employeeRegistration}` },
    { label: 'Período aquisitivo', value: `${dateBr(input.acquisitionPeriodStart)} a ${dateBr(input.acquisitionPeriodEnd)}` },
    { label: 'Gozo', value: `${period} · ${input.vacationDays} dias` },
    { label: 'Retorno ao trabalho', value: dateBr(input.returnDate) },
    { label: 'Abono pecuniário', value: input.allowanceText },
    { label: 'Antecipação do 13º', value: input.thirteenthAdvanceText },
  ];
  const actionLabel = input.correctionReason ? 'Enviar recibo corrigido' : 'Anexar recibo original';
  const actionTitle = input.correctionReason ? 'Envio da versão corrigida' : 'Envio seguro do recibo original';
  const actionText = input.correctionReason
    ? 'Quando o ajuste estiver pronto, use o botão abaixo para anexar a nova versão em PDF.'
    : 'Quando o recibo estiver pronto, use o botão abaixo para anexar o PDF emitido pela contabilidade. O RH receberá o arquivo original para conferência e auditoria.';
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
