import { createInterClient } from "./client.server";

function todayInBelem() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export type InterBarcodePayment = {
  codigoTransacao?: string;
  codigoBarra?: string | number;
  dataVencimentoDigitada?: string;
  dataVencimentoTitulo?: string;
  dataInclusao?: string;
  dataPagamento?: string;
  valorPago?: number;
  valorNominal?: number;
  statusPagamento?: string;
  aprovacoesNecessarias?: number;
  aprovacoesRealizadas?: number;
  cpfCnpjBeneficiario?: string;
  nomeBeneficiario?: string;
  autenticacao?: string | number;
  nsu?: string;
};

export function mapInterBarcodeStatus(rawStatus: string | undefined, scheduledFor?: string | null) {
  const status = String(rawStatus ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (["PAGO", "EFETIVADO", "PROCESSADO", "CONCLUIDO", "LIQUIDADO"].includes(status)) return "paid" as const;
  if (["REJEITADO", "RECUSADO", "CANCELADO"].includes(status)) return "rejected" as const;
  if (["EXPIRADO", "PRAZOEXPIRADO"].includes(status)) return "approval_expired" as const;
  if (["AGUARDANDOAPROVACAO", "EMAPROVACAO", "PENDENTEAPROVACAO"].includes(status)) return "awaiting_bank_approval" as const;
  if (status === "AGENDADO" || (scheduledFor && scheduledFor > todayInBelem())) return "scheduled" as const;
  return "processing" as const;
}

export async function submitInterBarcodePayment(input: {
  code: string;
  amount: number;
  dueDate: string;
  scheduledFor: string;
  beneficiaryDocument?: string | null;
}) {
  const client = await createInterClient("pagamento-boleto.write");
  const today = todayInBelem();
  const response = await client.post("/banking/v2/pagamento", {
    codBarraLinhaDigitavel: input.code,
    valorPagar: Number(input.amount.toFixed(2)),
    ...(input.scheduledFor > today ? { dataPagamento: input.scheduledFor } : {}),
    dataVencimento: input.dueDate,
    ...(input.beneficiaryDocument ? { cpfCnpjBeneficiario: input.beneficiaryDocument.replace(/\D/g, "") } : {}),
  });
  return response.data as {
    quantidadeAprovadores?: number;
    dataAgendamento?: string;
    statusPagamento?: string;
    codigoTransacao?: string;
  };
}

export async function getInterBarcodePayment(transactionCode: string) {
  const client = await createInterClient("pagamento-boleto.read");
  const response = await client.get("/banking/v2/pagamento", {
    params: { codigoTransacao: transactionCode },
  });
  const values = Array.isArray(response.data) ? response.data : [];
  return (values[0] ?? null) as InterBarcodePayment | null;
}

export async function findInterBarcodePaymentsByCode(code: string) {
  const client = await createInterClient("pagamento-boleto.read");
  const response = await client.get("/banking/v2/pagamento", {
    params: { codBarraLinhaDigitavel: code },
  });
  return (Array.isArray(response.data) ? response.data : []) as InterBarcodePayment[];
}
