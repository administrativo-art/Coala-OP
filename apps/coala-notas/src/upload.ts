import type { User } from "@firebase/auth";

import { attestationHeaders } from "./attestation";
import { appConfig } from "./config";

export type SelectedReceipt = {
  /** Arquivo da fila offline cifrado no disco; precisa ser aberto antes do envio. */
  sealed?: boolean;
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  previewUri: string | null;
};

export const MAX_FILES_PER_DOCUMENT = 2;
export type FundingSource = "cash_withdrawal" | "company_payment";
export type CompanyPaymentMethod = "pix" | "card_credit" | "card_debit" | "cash" | "boleto" | "term";

export type UploadResult = {
  submission: {
    id: string;
    duplicate: boolean;
    status: string;
    analysis?: ReceiptAnalysis;
  };
};

export type ReceiptItem = {
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPriceCents: number | null;
  totalCents: number | null;
  /** Produto de estoque sugerido para a linha e quantas embalagens dele ela representa. */
  productId?: string | null;
  packages?: number | null;
};

export type StockProduct = { id: string; name: string; packageLabel: string };

export type ReceiptAnalysis = {
  supplierName: string | null;
  supplierTaxId: string | null;
  purchaseDate: string | null;
  amountCents: number | null;
  items: ReceiptItem[];
  confidence: "high" | "medium" | "low";
  /** Categoria sugerida pela IA; ausente em análises antigas ou quando nada serviu. */
  suggestedAccountId?: string | null;
  payment: null | {
    method: CompanyPaymentMethod | "unknown";
    amountCents: number | null;
    paidAt: string | null;
    payeeName: string | null;
    transactionId: string | null;
    confidence: "high" | "medium" | "low";
    amountMatchesReceipt: boolean | null;
    payeeMatchesSupplier: boolean | null;
  };
  warnings: string[];
};

export type LocalPurchaseContext = {
  units: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  resultCenters: Array<{ id: string; name: string; unitId: string }>;
  /** Produtos que recebem entrada de estoque; ausente em servidores anteriores a esta função. */
  products?: StockProduct[];
};

/** Sangria do PDV ainda sem nota, listada na tela inicial. */
export type OpenWithdrawal = {
  sourceId: string;
  unitId: string;
  unitName: string;
  date: string;
  time: string | null;
  amountCents: number;
  operatorName: string | null;
};

/** Compra em dinheiro enviada antes de a sangria aparecer; pode ser conciliada depois. */
export type AwaitingPurchase = { id: string; unitId: string; supplierName: string; purchaseDate: string; totalCents: number };

export type OpenWithdrawalsResult = {
  withdrawals: OpenWithdrawal[];
  awaitingPurchases?: AwaitingPurchase[];
  window: { from: string; to: string };
  partial: boolean;
};

export const formatCents = (value: number) => `R$ ${(value / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
export const formatDay = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

function responseMessage(raw: string, status: number) {
  try {
    const payload = JSON.parse(raw) as { error?: string | { message?: string }; message?: string };
    if (typeof payload.error === "object" && payload.error?.message) return payload.error.message;
    if (typeof payload.error === "string" && payload.error) return payload.error;
    if (typeof payload.message === "string" && payload.message) return payload.message;
  } catch {
    // A resposta não JSON não é exibida porque pode conter detalhes internos.
  }
  if (status === 405) return "Este ambiente do Coala One ainda não recebeu a API do aplicativo (HTTP 405). A nota ficou protegida no aparelho para sincronizar depois.";
  return `Não foi possível enviar a nota (HTTP ${status}).`;
}

export class UploadError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
    this.name = "UploadError";
  }
}

export async function uploadReceipt(params: {
  user: User;
  receipts: SelectedReceipt[];
  paymentProofs: SelectedReceipt[];
  fundingSource: FundingSource;
  submissionId: string;
  capturedAt: string;
  note: string;
  onProgress: (value: number) => void;
}) {
  const token = await params.user.getIdToken();
  const attestation = await attestationHeaders(params.user);
  const body = new FormData();
  body.append("submissionId", params.submissionId);
  body.append("capturedAt", params.capturedAt);
  if (params.note.trim()) body.append("note", params.note.trim());
  body.append("fundingSource", params.fundingSource);
  // Até duas imagens por papel; o servidor analisa todas em uma única chamada.
  for (const [field, documents] of [["receipt", params.receipts], ["paymentProof", params.paymentProofs]] as const) {
    for (const document of documents) body.append(field, { uri: document.uri, name: document.name, type: document.mimeType } as unknown as Blob);
  }

  return new Promise<UploadResult>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${appConfig.apiBaseUrl}/api/financial/inbox/mobile-upload`);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    for (const [name, value] of Object.entries(attestation)) request.setRequestHeader(name, value);
    request.timeout = 150_000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) params.onProgress(Math.min(0.98, event.loaded / event.total));
    };
    request.onerror = () => reject(new UploadError("Sem conexão com o Coala One. A nota ficou protegida no aparelho para sincronizar depois.", null, true));
    request.ontimeout = () => reject(new UploadError("O envio demorou mais que o esperado. A nota ficou protegida no aparelho; a tentativa seguinte não criará duplicidade.", null, true));
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new UploadError(responseMessage(request.responseText, request.status), request.status, request.status === 405 || request.status >= 500));
        return;
      }
      try {
        params.onProgress(1);
        resolve(JSON.parse(request.responseText) as UploadResult);
      } catch {
        reject(new Error("O Coala One recebeu o envio, mas retornou uma confirmação inválida."));
      }
    };
    request.send(body);
  });
}

export async function authenticatedJson<T>(user: User, path: string, init?: RequestInit) {
  const token = await user.getIdToken();
  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(await attestationHeaders(user)),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(responseMessage(raw, response.status));
  return JSON.parse(raw) as T;
}

export async function loadOpenWithdrawals(user: User) {
  return authenticatedJson<OpenWithdrawalsResult>(user, "/api/purchasing/local-purchases/withdrawals");
}

export async function loadLocalPurchaseContext(user: User) {
  return authenticatedJson<LocalPurchaseContext>(user, "/api/purchasing/local-purchases/context");
}

export async function confirmLocalPurchase(user: User, input: {
  submissionId: string;
  unitId: string;
  supplierName: string;
  supplierTaxId: string | null;
  purchaseDate: string;
  totalCents: number;
  fundingSource: "cash_withdrawal" | "company_payment";
  companyPaymentMethod: "pix" | "card_credit" | "card_debit" | "cash" | "boleto" | "term" | null;
  accountPlanId: string;
  resultCenterId: string;
  note?: string;
  items: Array<{ description: string; quantity: number; unit: string; unitPriceCents: number; totalCents: number; baseItemId: null; stock?: { productId: string; quantity: number; expiryDate: string | null } }>;
  withdrawal?: { sourceId: string; date: string };
}) {
  return authenticatedJson<{ purchase: { id: string; status: string; duplicate: boolean; stockEntry?: "done" | "pending" | "not_needed"; stockItemCount?: number } }>(
    user,
    "/api/purchasing/local-purchases/confirm",
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Mesmo caminho do Coala One na web: o servidor envia o e-mail e nunca revela se a conta existe. */
export async function requestPasswordReset(email: string) {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(`Não foi possível solicitar a redefinição (HTTP ${response.status}).`);
}

/** Concilia com uma sangria uma compra que já tinha sido enviada sem ela. */
export async function linkPurchaseToWithdrawal(user: User, input: { purchaseId: string; withdrawal: { sourceId: string; date: string } }) {
  return authenticatedJson<{ purchase: { id: string; status: string; changeCents: number } }>(
    user,
    "/api/purchasing/local-purchases/link-withdrawal",
    { method: "POST", body: JSON.stringify(input) },
  );
}
