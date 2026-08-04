import "server-only";

import axios from "axios";
import { z } from "zod";

import { createInterCobrancaClient } from "./client.server";
import { getInterCobrancaEnvironment, type InterCobrancaPayer } from "./config.server";

export const INTER_COBRANCA_SITUATIONS = [
  "RECEBIDO",
  "A_RECEBER",
  "MARCADO_RECEBIDO",
  "ATRASADO",
  "CANCELADO",
  "EXPIRADO",
  "FALHA_EMISSAO",
  "EM_PROCESSAMENTO",
  "PROTESTO",
] as const;

export type InterCobrancaSituation = (typeof INTER_COBRANCA_SITUATIONS)[number];

const situationSchema = z.string().trim().min(1);
const pagadorResponseSchema = z.object({
  cpfCnpj: z.string().optional(),
  tipoPessoa: z.string().optional(),
  nome: z.string().optional(),
  endereco: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  cep: z.string().optional(),
  email: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
}).passthrough();

export const interCobrancaDetailSchema = z.object({
  cobranca: z.object({
    codigoSolicitacao: z.string().uuid(),
    seuNumero: z.string(),
    dataEmissao: z.string().optional(),
    dataVencimento: z.string().optional(),
    valorNominal: z.union([z.number(), z.string()]),
    tipoCobranca: z.string().optional(),
    situacao: situationSchema,
    dataSituacao: z.string().optional(),
    valorTotalRecebido: z.union([z.number(), z.string()]).optional(),
    origemRecebimento: z.string().optional(),
    arquivada: z.boolean().optional(),
    pagador: pagadorResponseSchema.optional(),
  }).passthrough(),
  boleto: z.object({
    nossoNumero: z.string().optional(),
    codigoBarras: z.string().optional(),
    linhaDigitavel: z.string().optional(),
  }).passthrough().optional(),
  pix: z.object({
    txid: z.string().optional(),
    pixCopiaECola: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

export type InterCobrancaDetail = z.infer<typeof interCobrancaDetailSchema>;

export const interCobrancaWebhookItemSchema = z.object({
  codigoSolicitacao: z.string().uuid(),
  seuNumero: z.string(),
  situacao: situationSchema,
  dataHoraSituacao: z.string(),
  valorTotalRecebido: z.union([z.number(), z.string()]).optional(),
  origemRecebimento: z.string().optional(),
  nossoNumero: z.string().optional(),
  codigoBarras: z.string().optional(),
  linhaDigitavel: z.string().optional(),
  txid: z.string().optional(),
  pixCopiaECola: z.string().optional(),
}).passthrough();

export const interCobrancaWebhookSchema = z.array(interCobrancaWebhookItemSchema).min(1);
export type InterCobrancaWebhookItem = z.infer<typeof interCobrancaWebhookItemSchema>;

export type CreateInterCobrancaInput = {
  seuNumero: string;
  valorNominal: number;
  dataVencimento: string;
  numDiasAgenda: number;
  pagador: InterCobrancaPayer;
  formasRecebimento?: Array<"BOLETO" | "PIX">;
};

export class InterCobrancaApiError extends Error {
  status: number | null;
  details: unknown;

  constructor(message: string, status: number | null, details: unknown) {
    super(message);
    this.name = "InterCobrancaApiError";
    this.status = status;
    this.details = details;
  }
}

function apiError(error: unknown, fallback: string): never {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data;
    const message =
      (detail && typeof detail === "object" && "detail" in detail && typeof detail.detail === "string"
        ? detail.detail
        : null) ?? fallback;
    throw new InterCobrancaApiError(message, error.response?.status ?? null, detail);
  }
  throw error instanceof Error ? error : new Error(fallback);
}

export async function createCobranca(input: CreateInterCobrancaInput) {
  try {
    const client = await createInterCobrancaClient("boleto-cobranca.write");
    const response = await client.post("/cobrancas", {
      ...input,
      formasRecebimento: input.formasRecebimento ?? ["BOLETO", "PIX"],
    });
    return z.object({ codigoSolicitacao: z.string().uuid() }).parse(response.data);
  } catch (error) {
    return apiError(error, "Falha ao emitir cobrança no Banco Inter.");
  }
}

export async function retrieveCobranca(codigoSolicitacao: string) {
  try {
    const client = await createInterCobrancaClient("boleto-cobranca.read");
    const response = await client.get(`/cobrancas/${encodeURIComponent(codigoSolicitacao)}`);
    return interCobrancaDetailSchema.parse(response.data);
  } catch (error) {
    return apiError(error, "Falha ao consultar cobrança no Banco Inter.");
  }
}

export async function listCobrancas(input: {
  dataInicial: string;
  dataFinal: string;
  paginaAtual?: number;
  itensPorPagina?: number;
  situacao?: string;
  seuNumero?: string;
}) {
  try {
    const client = await createInterCobrancaClient("boleto-cobranca.read");
    const response = await client.get("/cobrancas", {
      params: {
        dataInicial: input.dataInicial,
        dataFinal: input.dataFinal,
        "paginacao.paginaAtual": input.paginaAtual ?? 0,
        "paginacao.itensPorPagina": input.itensPorPagina ?? 100,
        ...(input.situacao ? { situacao: input.situacao } : {}),
        ...(input.seuNumero ? { seuNumero: input.seuNumero } : {}),
      },
    });
    return z.object({
      totalPaginas: z.number(),
      totalElementos: z.number(),
      ultimaPagina: z.boolean(),
      primeiraPagina: z.boolean(),
      tamanhoPagina: z.number(),
      numeroDeElementos: z.number(),
      cobrancas: z.array(interCobrancaDetailSchema),
    }).passthrough().parse(response.data);
  } catch (error) {
    return apiError(error, "Falha ao listar cobranças no Banco Inter.");
  }
}

export async function retrieveCobrancaPdf(codigoSolicitacao: string) {
  try {
    const client = await createInterCobrancaClient("boleto-cobranca.read");
    const response = await client.get(`/cobrancas/${encodeURIComponent(codigoSolicitacao)}/pdf`);
    const parsed = z.object({ pdf: z.string().min(1) }).parse(response.data);
    const pdf = Buffer.from(parsed.pdf, "base64");
    if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("O Banco Inter retornou um PDF inválido.");
    }
    return pdf;
  } catch (error) {
    return apiError(error, "Falha ao baixar PDF da cobrança no Banco Inter.");
  }
}

export async function cancelCobranca(codigoSolicitacao: string, motivoCancelamento: string) {
  try {
    const client = await createInterCobrancaClient("boleto-cobranca.write");
    await client.post(
      `/cobrancas/${encodeURIComponent(codigoSolicitacao)}/cancelar`,
      { motivoCancelamento },
      { headers: { Accept: "*/*" } },
    );
  } catch (error) {
    return apiError(error, "Falha ao cancelar cobrança no Banco Inter.");
  }
}

export async function configureCobrancaWebhook(webhookUrl: string) {
  try {
    const client = await createInterCobrancaClient("boleto-cobranca.write");
    await client.put("/cobrancas/webhook", { webhookUrl });
  } catch (error) {
    return apiError(error, "Falha ao configurar webhook de cobrança no Banco Inter.");
  }
}

export async function retrieveConfiguredCobrancaWebhook() {
  try {
    const client = await createInterCobrancaClient("boleto-cobranca.read");
    const response = await client.get("/cobrancas/webhook");
    return z.object({ webhookUrl: z.string().url() }).passthrough().parse(response.data);
  } catch (error) {
    return apiError(error, "Falha ao consultar webhook de cobrança no Banco Inter.");
  }
}

export async function payCobrancaInSandbox(
  codigoSolicitacao: string,
  pagarCom: "BOLETO" | "PIX",
) {
  if (getInterCobrancaEnvironment() !== "sandbox") {
    throw new Error("O simulador de pagamento só existe no sandbox Inter.");
  }
  try {
    const client = await createInterCobrancaClient("boleto-cobranca.write");
    await client.post(
      `/cobrancas/${encodeURIComponent(codigoSolicitacao)}/pagar`,
      { pagarCom },
      { headers: { Accept: "*/*" } },
    );
  } catch (error) {
    return apiError(error, "Falha ao simular pagamento no sandbox Inter.");
  }
}
