import { inferPixKeyType, normalizeBrazilianDocument } from "@/features/financial/beneficiaries/normalization";
import type { PixKeyType, ResolvedPaymentBeneficiary } from "@/features/financial/beneficiaries/types";
import { createInterClient } from "./client.server";

export type InterPixStatusResponse = {
  transacaoPix?: {
    codigoSolicitacao?: string;
    status?: string;
    valor?: number;
    endToEnd?: string;
    dataHoraMovimento?: string;
    dataHoraSolicitacao?: string;
    recebedor?: { nome?: string; cpfCnpj?: string };
    erros?: unknown[];
  };
  historico?: unknown[];
};

export function normalizeInterPixKey(value: string, declaredType?: PixKeyType) {
  const trimmed = value.trim();
  const type = declaredType ?? inferPixKeyType(trimmed);
  if (type === 'cpf' || type === 'cnpj') return normalizeBrazilianDocument(trimmed);
  if (type === 'email' || type === 'random') return trimmed.toLowerCase();
  if (type === 'phone') {
    const compact = trimmed.replace(/[\s()-]/g, '');
    if (compact.startsWith('+')) return `+${compact.slice(1).replace(/\D/g, '')}`;
    const digits = compact.replace(/\D/g, '');
    return digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
  }
  return trimmed;
}

function recipient(beneficiary: ResolvedPaymentBeneficiary) {
  if (beneficiary.paymentMethod === "pix_key" && beneficiary.pixKey) {
    return { tipo: "CHAVE", chave: normalizeInterPixKey(beneficiary.pixKey, beneficiary.pixKeyType) };
  }
  if (beneficiary.paymentMethod === "pix_copy_paste" && beneficiary.pixCopyPaste) {
    return { tipo: "PIX_COPIA_E_COLA", pixCopiaECola: beneficiary.pixCopyPaste };
  }
  if (beneficiary.paymentMethod === "bank_details" && beneficiary.bankDetails) {
    return {
      tipo: "DADOS_BANCARIOS",
      nome: beneficiary.name,
      cpfCnpj: beneficiary.document,
      agencia: beneficiary.bankDetails.agency,
      contaCorrente: beneficiary.bankDetails.account,
      tipoConta: beneficiary.bankDetails.accountType === "savings" ? "CONTA_POUPANCA" : beneficiary.bankDetails.accountType === "payment" ? "CONTA_PAGAMENTO" : "CONTA_CORRENTE",
      instituicaoFinanceira: { ispb: beneficiary.bankDetails.bankCode },
    };
  }
  throw new Error("O favorecido não possui um destino de pagamento Pix válido.");
}

export async function submitInterPix(input: {
  idempotencyKey: string;
  amount: number;
  description: string;
  beneficiary: ResolvedPaymentBeneficiary;
  scheduledFor?: string | null;
}) {
  const client = await createInterClient("pagamento-pix.write");
  const response = await client.post("/banking/v2/pix", {
    valor: Number(input.amount.toFixed(2)),
    ...(input.scheduledFor ? { dataPagamento: input.scheduledFor } : {}),
    descricao: input.description.slice(0, 140),
    destinatario: recipient(input.beneficiary),
  }, { headers: { "x-id-idempotente": input.idempotencyKey } });
  return response.data as { tipoRetorno?: string; codigoSolicitacao?: string; dataPagamento?: string; dataOperacao?: string };
}

export async function getInterPixStatus(requestId: string) {
  const client = await createInterClient("pagamento-pix.read");
  const response = await client.get(`/banking/v2/pix/${encodeURIComponent(requestId)}`);
  return response.data as InterPixStatusResponse;
}

export function mapInterPixStatus(rawStatus: string | undefined, scheduledFor?: string | null) {
  const status = (rawStatus ?? "").trim().toUpperCase();
  if (["PROCESSADO", "PAGO", "EFETIVADO", "CONCLUIDO", "CONCLUÍDO", "LIQUIDADO"].includes(status)) return "paid" as const;
  if (["REJEITADO", "RECUSADO", "CANCELADO"].includes(status)) return "rejected" as const;
  if (["EXPIRADO", "EXPIRADA", "PRAZO_EXPIRADO"].includes(status)) return "approval_expired" as const;
  if (["AGUARDANDO_APROVACAO", "EM_APROVACAO", "PENDENTE_APROVACAO"].includes(status)) return "awaiting_bank_approval" as const;
  if (["AGENDADO", "PROGRAMADO"].includes(status) || (scheduledFor && scheduledFor > new Date().toISOString().slice(0, 10))) return "scheduled" as const;
  return "processing" as const;
}
