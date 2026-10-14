import { calculateTransportVoucherEffect } from "@/features/hr/requests/core";
import type { CollaboratorRequest, CollaboratorRequestSignature } from "@/features/hr/requests/types";

export const TRANSPORT_VOUCHER_SUSPENSION_SIMULATION = "transport_voucher_suspension";

function isoAt(date: string, time: string) {
  return new Date(`${date}T${time}-03:00`).toISOString();
}

function addUtcDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function createTransportVoucherSuspensionSimulation(employeeName = "Colaborador de demonstração") {
  const effect = calculateTransportVoucherEffect("2026-08-13");
  const approvedDate = addUtcDays(effect.requestDate, 1);
  const submittedAt = isoAt(effect.requestDate, "10:12:00");
  const scheduledAt = isoAt(effect.requestDate, "10:12:08");
  const approvedAt = isoAt(approvedDate, "09:05:00");
  const decisionAt = isoAt(approvedDate, "09:06:00");
  const generatedAt = isoAt(approvedDate, "09:08:00");
  const signatureSentAt = isoAt(approvedDate, "09:11:00");
  const signedAt = isoAt(approvedDate, "11:22:00");
  const appliedAt = isoAt(effect.effectiveDate, "00:05:00");

  const request: CollaboratorRequest = {
    id: "simulation:transport-voucher-suspension",
    type: "transport_voucher",
    employeeId: "simulation:employee",
    employeeName,
    requesterId: "simulation:employee",
    requesterName: employeeName,
    unitId: "simulation:unit",
    unitIds: ["simulation:unit"],
    action: "suspend",
    requestDate: effect.requestDate,
    cutoffDay: effect.cutoffDay,
    requestedAfterCutoff: effect.requestedAfterCutoff,
    processingCompetence: effect.processingCompetence,
    effectiveDate: effect.effectiveDate,
    payslipPaymentDate: effect.payslipPaymentDate,
    details: "Suspensão solicitada após mudança temporária do trajeto até o trabalho.",
    status: "approved",
    currentSnapshot: { active: true, dailyValue: 18.4 },
    review: {
      reviewerId: "simulation:hr",
      reviewerName: "Departamento Pessoal",
      reviewedAt: approvedAt,
      notes: "Pedido conferido e aprovado conforme a política de corte.",
      approvedDailyValue: null,
    },
    decisionId: "simulation:decision",
    generatedDocumentId: "simulation:document",
    documentStatus: "generated",
    documentError: null,
    trail: [
      { type: "submitted", label: "Solicitação enviada", at: submittedAt, actorId: "simulation:employee", actorName: employeeName, details: "Suspensão do vale-transporte solicitada." },
      { type: "effective_date_scheduled", label: "Vigência e contracheque calculados", at: scheduledAt, actorId: "system:transport-voucher-policy", actorName: "Coala One", details: `Vigência em ${effect.effectiveDate}; contracheque da competência ${effect.processingCompetence}, pago em ${effect.payslipPaymentDate}.` },
      { type: "approved", label: "Solicitação aprovada", at: approvedAt, actorId: "simulation:hr", actorName: "Departamento Pessoal", details: "Pedido conferido e aprovado conforme a política de corte." },
      { type: "decision_recorded", label: "Decisão versionada", at: decisionAt, actorId: "simulation:hr", actorName: "Departamento Pessoal", details: "Protocolo VT-SIM-2026-001." },
      { type: "term_generated", label: "Termo de suspensão gerado", at: generatedAt, actorId: "simulation:hr", actorName: "Departamento Pessoal", details: "Declaração de não utilização de vale-transporte." },
      { type: "signature_sent", label: "Termo enviado para assinatura", at: signatureSentAt, actorId: "simulation:hr", actorName: "Departamento Pessoal", details: "Acesso individual disponibilizado ao colaborador." },
      { type: "signature_sent", label: "Termo assinado", at: signedAt, actorId: "simulation:employee", actorName: employeeName, details: "Assinatura eletrônica concluída e documento preservado." },
      { type: "benefit_updated", label: "Suspensão efetivada", at: appliedAt, actorId: "system:transport-voucher-policy", actorName: "Coala One", details: `Benefício suspenso em ${effect.effectiveDate}; reflexo no contracheque pago em ${effect.payslipPaymentDate}.` },
    ],
    cancelledAt: null,
    createdAt: submittedAt,
    updatedAt: appliedAt,
  };

  const signature: CollaboratorRequestSignature = {
    status: "signed",
    requestId: "simulation:signature",
    signingUrl: null,
    sentAt: signatureSentAt,
    signedAt,
  };

  return { request, signature };
}
