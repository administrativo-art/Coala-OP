import "server-only";

import { extractDeterministicFinancialDocumentText } from "./document-text";
import {
  fiscalAuthorizationFromPdfText, fiscalAuthorizationProtocol, normalizeMobileFiscalDocument, verifyMobileFiscalReadings,
  type DetectedMobileInboxFile, type IndependentMobileFiscalReading, type MobilePurchaseAnalysis,
} from "./mobile-upload";

type Receipt = { buffer: Buffer; detected: DetectedMobileInboxFile };
const FILES_URL = "https://api.openai.com/v1/files";
const RESPONSES_URL = "https://api.openai.com/v1/responses";
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["purchaseDocumentKind", "purchaseDocumentKindConfidence", "fiscalAuthorizationStatus", "fiscalAuthorizationEvidence", "authorizationProtocol"],
  properties: {
    purchaseDocumentKind: { type: "string", enum: ["nfe_or_danfe", "nfce", "coupon_or_receipt", "unknown"] },
    purchaseDocumentKindConfidence: { type: "string", enum: ["high", "medium", "low"] },
    fiscalAuthorizationStatus: { type: "string", enum: ["authorized", "pending", "unknown"] },
    fiscalAuthorizationEvidence: { type: ["string", "null"] },
    authorizationProtocol: { type: ["string", "null"] },
  },
} as const;

const VERIFICATION_PROMPT = `Leia apenas as páginas anexadas do documento de compra. Esta é uma verificação fiscal independente; não há análise anterior, observação do operador ou comprovante de pagamento nesta solicitação.
Classifique nfe_or_danfe para NF-e/DANFE, nfce para NFC-e/DANFE NFC-e, coupon_or_receipt para cupom não fiscal/recibo, unknown se incerto. O nome do arquivo ou rótulo não é evidência.
Marque authorized apenas se o documento mostrar um protocolo de autorização de uso legível com 15 dígitos; copie um trecho literal curto contendo "Protocolo de Autorização" e todos os 15 dígitos em fiscalAuthorizationEvidence e copie os mesmos dígitos em authorizationProtocol. Não complete números ocultos, não use reticências. Chave de acesso, QR Code e aparência fiscal isolados não bastam.
Se qualquer página indicar contingência pendente de autorização, aguardando autorização, rejeição, cancelamento ou denegação, marque pending, sem protocolo de autorização. Se a leitura estiver duvidosa, use unknown e confiança menor que high. Nunca invente um trecho ou número.`;

async function secondReading(receipts: Receipt[]): Promise<IndependentMobileFiscalReading | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const uploadedIds: string[] = [];
  try {
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: VERIFICATION_PROMPT }];
    for (const receipt of receipts) {
      if (receipt.detected.contentType.startsWith("image/")) {
        content.push({ type: "input_image", image_url: `data:${receipt.detected.contentType};base64,${receipt.buffer.toString("base64")}`, detail: "high" });
      } else {
        const form = new FormData();
        form.set("purpose", "user_data");
        form.set("file", new File([new Uint8Array(receipt.buffer)], "document.pdf", { type: "application/pdf" }), "document.pdf");
        const fileResponse = await fetch(FILES_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(45_000) });
        const filePayload = await fileResponse.json() as { id?: string };
        if (!fileResponse.ok || !filePayload.id) return null;
        uploadedIds.push(filePayload.id);
        content.push({ type: "input_file", file_id: filePayload.id });
      }
    }
    const response = await fetch(RESPONSES_URL, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_MOBILE_RECEIPT_MODEL?.trim() || "gpt-5-mini", store: false,
        input: [{ role: "user", content }], max_output_tokens: 400, reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name: "mobile_fiscal_verification", strict: true, schema: SCHEMA } } }),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    if (!response.ok) return null;
    const output = payload.output_text ?? payload.output?.flatMap((entry) => entry.content ?? []).map((entry) => entry.text ?? "").join("\n") ?? "";
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const fiscal = normalizeMobileFiscalDocument(parsed);
    return { ...fiscal, authorizationProtocol: typeof parsed.authorizationProtocol === "string" ? parsed.authorizationProtocol.replace(/\D/g, "") : null };
  } catch {
    return null;
  } finally {
    await Promise.all(uploadedIds.map((id) => fetch(`${FILES_URL}/${encodeURIComponent(id)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined)));
  }
}

export async function verifyMobileFiscalDocuments(params: {
  analysis: MobilePurchaseAnalysis | null;
  receipts: Receipt[];
  receiptSha256s: string[];
}) {
  if (!params.analysis || params.analysis.purchaseDocumentKindConfidence !== "high"
    || params.analysis.fiscalAuthorizationStatus !== "authorized"
    || (params.analysis.purchaseDocumentKind !== "nfe_or_danfe" && params.analysis.purchaseDocumentKind !== "nfce")
    || !fiscalAuthorizationProtocol(params.analysis.fiscalAuthorizationEvidence ?? "")) return null;
  const pdfTextChecks = [];
  for (const receipt of params.receipts) {
    if (receipt.detected.extension !== "pdf") continue;
    try {
      const extracted = await extractDeterministicFinancialDocumentText({ buffer: receipt.buffer, filename: "document.pdf", contentType: "application/pdf" });
      // The shared extractor truncates at 80k characters or 40 pages; do not authorize from an incomplete text layer.
      pdfTextChecks.push(extracted.pageCount && extracted.pageCount <= 40 && extracted.text.length < 80_000
        ? fiscalAuthorizationFromPdfText(extracted.text) : null);
    } catch {
      pdfTextChecks.push(null);
    }
  }
  if (pdfTextChecks.some((check) => !check)) return null;
  const independent = await secondReading(params.receipts);
  return verifyMobileFiscalReadings(params.analysis, independent, pdfTextChecks, params.receiptSha256s);
}
