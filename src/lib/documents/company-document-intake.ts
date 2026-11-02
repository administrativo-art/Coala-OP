import { z } from "zod";

export const COMPANY_DOCUMENT_TYPES = [
  { code: "CARTAO-CNPJ", label: "Cartão CNPJ", reference: false },
  { code: "INSCRICAO-ESTADUAL", label: "Inscrição estadual", reference: false },
  { code: "CONTRATO-SOCIAL", label: "Contrato social ou alteração", reference: true },
  { code: "ALVARA", label: "Alvará", reference: true },
  { code: "CERTIDAO", label: "Certidão", reference: true },
  { code: "CONTRATO-EMPRESARIAL", label: "Contrato empresarial", reference: true },
  { code: "ATESTADO-TECNICO-REP-P", label: "Atestado técnico REP-P", reference: true },
  { code: "REGISTRO-INPI-REP-P", label: "Registro INPI REP-P", reference: true },
  { code: "RELATORIO-VALIDACAO-REP-P", label: "Relatório de validação REP-P", reference: true },
] as const;
const id = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const companyIntakeSchema = z.object({
  title: z.string().trim().min(1).max(180), category: z.string().trim().min(1).max(80),
  unitId: id.optional(),
  documentType: z.string().optional(), reference: z.string().trim().max(100).default(""),
}).strict().superRefine((value, ctx) => {
  if (!value.documentType) return;
  const type = COMPANY_DOCUMENT_TYPES.find((item) => item.code === value.documentType);
  if (!type || type.reference && !/[a-zA-Z0-9]/.test(value.reference)) ctx.addIssue({ code: "custom", message: "Tipo ou referência obrigatória inválida." });
});

export function companyIntakeName(input: { documentType: string; unitId?: string; reference?: string; version: number; extension: string }) {
  const reference = input.reference?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase();
  return [input.documentType, input.unitId ? `UNIDADE-${input.unitId}` : "GERAL", ...(reference ? [reference] : []), `v${String(input.version).padStart(2, "0")}`].join("__") + `.${input.extension}`;
}
