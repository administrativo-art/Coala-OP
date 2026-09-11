export type VacationWorkflowAlertKind =
  | "notice_due"
  | "accountant_due"
  | "payment_due"
  | "receipt_signature_due";

export type VacationWorkflowAlert = {
  kind: VacationWorkflowAlertKind;
  dueDate: string;
  title: string;
  message: string;
  severity: "attention" | "critical";
};

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateOnly(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function dueSeverity(dueDate: string, today: string): VacationWorkflowAlert["severity"] {
  return dueDate <= today ? "critical" : "attention";
}

export function vacationWorkflowAlerts(
  workflow: Record<string, any> | null | undefined,
  today: string,
): VacationWorkflowAlert[] {
  if (!workflow || workflow.status !== "active") return [];
  const alerts: VacationWorkflowAlert[] = [];
  const noticeDeadline = dateOnly(workflow.legalAnalysis?.noticeDeadline);
  if (workflow.notice?.status !== "signed" && noticeDeadline && noticeDeadline <= shiftDate(today, 7)) {
    alerts.push({
      kind: "notice_due",
      dueDate: noticeDeadline,
      title: "Aviso de férias exige atenção",
      message: noticeDeadline < today
        ? "O prazo de 30 dias do aviso venceu; registre a exceção e envie imediatamente."
        : "O prazo de 30 dias do aviso vence nos próximos 7 dias.",
      severity: dueSeverity(noticeDeadline, today),
    });
  }

  const workflowUpdatedAt = dateOnly(workflow.updatedAt);
  const noticeSignedAt = dateOnly(workflow.notice?.signedAt) ?? workflowUpdatedAt;
  if (workflow.notice?.status === "signed"
    && !["receipt_received", "completed"].includes(String(workflow.accountant?.status ?? ""))
    && noticeSignedAt
    && noticeSignedAt <= shiftDate(today, -2)) {
    alerts.push({
      kind: "accountant_due",
      dueDate: shiftDate(noticeSignedAt, 2),
      title: "Contabilidade pendente nas férias",
      message: "O aviso está assinado, mas o envio ou retorno do recibo da contabilidade continua pendente.",
      severity: "critical",
    });
  }

  const paymentDeadline = dateOnly(workflow.legalAnalysis?.paymentDeadline);
  if (workflow.notice?.status === "signed"
    && workflow.payment?.status !== "paid"
    && paymentDeadline
    && paymentDeadline <= shiftDate(today, 2)) {
    alerts.push({
      kind: "payment_due",
      dueDate: paymentDeadline,
      title: "Pagamento de férias próximo do prazo",
      message: workflow.receipt?.status !== "approved"
        ? "O prazo de pagamento está próximo, mas o recibo ainda não foi aprovado pelo RH."
        : paymentDeadline < today
        ? "O prazo legal calculado para o pagamento das férias venceu."
        : "O pagamento das férias deve ser concluído em até 2 dias.",
      severity: dueSeverity(paymentDeadline, today),
    });
  }

  const paidAt = dateOnly(workflow.payment?.paidAt);
  if (workflow.payment?.status === "paid"
    && workflow.receiptSignature?.status !== "signed"
    && paidAt
    && paidAt <= shiftDate(today, -1)) {
    alerts.push({
      kind: "receipt_signature_due",
      dueDate: shiftDate(paidAt, 1),
      title: "Assinatura do recibo de férias pendente",
      message: "O pagamento foi confirmado, mas o recibo ainda não foi assinado e arquivado.",
      severity: "critical",
    });
  }
  return alerts;
}
