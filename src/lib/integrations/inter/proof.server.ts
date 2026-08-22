import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getStorage } from "firebase-admin/storage";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import type { BankPaymentRequest } from "@/features/financial/payment-requests/types";

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function paymentOriginLabel(request: BankPaymentRequest) {
  if (request.sourceType === "aso") return "Exame admissional (ASO)";
  if (request.sourceType === "termination") return "Rescisão CLT";
  if (request.sourceType === "purchase_order") return "Pedido de compra";
  return "Recibo gerado pelo Coala";
}

export async function createAndStoreConfirmedPaymentProof(request: BankPaymentRequest) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 735, width: 595.28, height: 106, color: rgb(0.08, 0.40, 0.20) });
  page.drawText("COALA SHAKES", { x: 42, y: 795, size: 13, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Comprovante de pagamento confirmado pelo Banco Inter", { x: 42, y: 765, size: 16, font: bold, color: rgb(1, 1, 1) });
  const rows = [
    ["Favorecido", request.beneficiarySnapshot.name],
    ["CPF/CNPJ", request.beneficiarySnapshot.document],
    ["Destino", request.beneficiarySnapshot.maskedPaymentDestination],
    ["Valor", money(request.amount)],
    ["Descrição", request.description],
    ["Confirmado em", request.paidAt ?? new Date().toISOString()],
    ["Código da solicitação", request.interRequestId ?? "—"],
    ["Identificador End-to-End", request.endToEndId ?? "—"],
    ["Origem", paymentOriginLabel(request)],
  ];
  let y = 685;
  for (const [label, value] of rows) {
    page.drawText(label, { x: 44, y, size: 9, font: bold, color: rgb(0.35, 0.42, 0.5) });
    page.drawText(String(value).slice(0, 90), { x: 44, y: y - 20, size: 12, font: regular, color: rgb(0.08, 0.12, 0.2) });
    y -= 58;
  }
  page.drawText("Dados confirmados por consulta ativa à API Banking do Banco Inter.", { x: 44, y: 92, size: 9, font: regular, color: rgb(0.35, 0.42, 0.5) });
  page.drawText("Este documento foi gerado pelo Coala e não se apresenta como comprovante emitido pelo banco.", { x: 44, y: 76, size: 8, font: regular, color: rgb(0.45, 0.48, 0.55) });
  const bytes = await pdf.save();
  const path = `financial/payment-proofs/${request.id}/comprovante-pagamento.pdf`;
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).save(Buffer.from(bytes), {
    contentType: "application/pdf",
    resumable: false,
    metadata: { cacheControl: "private, no-store", metadata: { paymentRequestId: request.id } },
  });
  return path;
}
