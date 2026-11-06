import { z } from "zod";

import type { ResolvedPaymentBeneficiary } from "../beneficiaries/types";
import { maskPixCopyPaste, parseAllowedPixCopyPaste } from "./pix-copy-paste";
import type { PixCopyPastePaymentSnapshot } from "./types";

/** Erro de regra da preparação: a mensagem é fixa, escrita para o operador e segura para exibir. */
export class InboxPixPaymentPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxPixPaymentPreparationError";
  }
}

/** CNPJ da Caixa Econômica Federal, recebedora do Pix da guia do FGTS Digital. */
export const FGTS_DIGITAL_RECEIVER_DOCUMENT = "00360305000104";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, "Data de pagamento inválida.");

export const inboxPixCopyPastePreparationSchema = z.object({
  scheduledFor: isoDate,
  pixCopyPaste: z.string().trim().min(30).max(512),
}).strict();

export type InboxPixCopyPastePreparation = z.infer<typeof inboxPixCopyPastePreparationSchema>;

type InboxMessageForPix = {
  id: string;
  workspaceId?: unknown;
  status?: unknown;
  linkedExpenseId?: unknown;
  linkedExpenseInstallmentNumber?: unknown;
  paymentRequestId?: unknown;
  existingSettlement?: { transactionId?: unknown } | null;
  existingBankPayment?: { transactionId?: unknown } | null;
  classification?: {
    documentType?: unknown;
    amountCents?: unknown;
    dueDate?: unknown;
    competence?: unknown;
    fiscalIdentity?: { documentKind?: unknown } | null;
  } | null;
};

/**
 * Regras da preparação, sem acesso ao banco. A transação do serviço relê o estado
 * e repete as condições que podem mudar entre a leitura e a escrita.
 */
export function planInboxPixCopyPastePreparation(params: {
  message: InboxMessageForPix;
  workspaceId: string;
  scheduledFor: string;
  pixCopyPaste: string;
  today: string;
}) {
  const { message } = params;
  const classification = message.classification ?? {};
  if (message.workspaceId !== params.workspaceId) throw new InboxPixPaymentPreparationError("Cobrança recebida não encontrada.");
  if (message.existingSettlement?.transactionId) throw new InboxPixPaymentPreparationError("A cobrança já corresponde a um pagamento confirmado no extrato.");
  if (message.existingBankPayment?.transactionId) throw new InboxPixPaymentPreparationError("A cobrança já possui um pagamento no Banco Inter. Confira o agendamento existente.");
  if (!message.linkedExpenseId) throw new InboxPixPaymentPreparationError("Vincule a cobrança a uma despesa antes de preparar o pagamento.");
  if (classification.documentType !== "fgts" || classification.fiscalIdentity?.documentKind !== "fgts") {
    throw new InboxPixPaymentPreparationError("O Pix copia e cola da caixa só é aceito para a guia do FGTS Digital.");
  }
  const dueDate = String(classification.dueDate ?? "");
  if (!isoDate.safeParse(dueDate).success) throw new InboxPixPaymentPreparationError("Confirme o vencimento antes de preparar o pagamento.");
  if (!isoDate.safeParse(params.scheduledFor).success || params.scheduledFor < params.today) {
    throw new InboxPixPaymentPreparationError("A data do pagamento não pode estar no passado.");
  }
  if (params.scheduledFor > dueDate) throw new InboxPixPaymentPreparationError("Escolha uma data até o vencimento da guia.");
  const amountCents = Number(classification.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new InboxPixPaymentPreparationError("Confirme o valor antes de preparar o pagamento.");
  const parsed = parseAllowedPixCopyPaste(params.pixCopyPaste);
  if (!parsed) {
    throw new InboxPixPaymentPreparationError("O Pix copia e cola não é um QR dinâmico válido do FGTS Digital (Caixa). Confira o código da guia.");
  }
  if (parsed.amountCents != null && parsed.amountCents !== amountCents) {
    throw new InboxPixPaymentPreparationError("O valor do Pix copia e cola diverge do valor confirmado da guia.");
  }
  const snapshot: PixCopyPastePaymentSnapshot = {
    type: "pix_copy_paste",
    payload: parsed.payload,
    payloadHash: parsed.payloadHash,
    maskedPayload: maskPixCopyPaste(parsed.payload),
    receiver: parsed.receiver,
    merchantName: parsed.merchantName,
    merchantCity: parsed.merchantCity,
    locationUrl: parsed.locationUrl,
    dueDate,
    scheduledFor: params.scheduledFor,
  };
  const installmentNumber = Number(message.linkedExpenseInstallmentNumber) > 0
    ? Number(message.linkedExpenseInstallmentNumber)
    : null;
  return { snapshot, amountCents, expenseId: String(message.linkedExpenseId), installmentNumber };
}

/** Favorecido usado somente para montar o destino PIX_COPIA_E_COLA do Inter. */
export function pixCopyPasteBeneficiary(snapshot: PixCopyPastePaymentSnapshot): ResolvedPaymentBeneficiary {
  return {
    sourceType: "entity",
    sourceId: `pix-copy-paste:${snapshot.payloadHash}`,
    name: snapshot.merchantName,
    document: FGTS_DIGITAL_RECEIVER_DOCUMENT,
    paymentMethod: "pix_copy_paste",
    pixCopyPaste: snapshot.payload,
    validated: true,
    sourceUpdatedAt: snapshot.payloadHash,
  };
}

/**
 * Recebedor informado pelo Inter: só documento completo diferente da Caixa é
 * divergência; documento ausente ou mascarado fica a cargo do extrato.
 */
export function compareFgtsPixReceiver(receiverDocument: unknown) {
  const digits = String(receiverDocument ?? "").replace(/\D/g, "");
  if (digits.length !== 14) return "unavailable" as const;
  return digits === FGTS_DIGITAL_RECEIVER_DOCUMENT ? "matched" as const : "divergent" as const;
}

export function mapInterPixSubmissionStatus(params: { returnType?: string | null; paymentDate?: string | null; today: string }) {
  if (String(params.returnType ?? "").toUpperCase() === "APROVACAO") return "awaiting_bank_approval" as const;
  if (params.paymentDate && params.paymentDate.slice(0, 10) > params.today) return "scheduled" as const;
  return "processing" as const;
}
