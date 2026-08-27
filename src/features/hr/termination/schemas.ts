import { z } from "zod";

import {
  CLT_TERMINATION_REASONS,
  PJ_TERMINATION_REASONS,
} from "@/lib/hr/employment-relationship";
import { JUST_CAUSE_TYPES } from "@/lib/hr/termination-options";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

function validCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const digit = (length: number) => {
    const sum = value.slice(0, length).split("").reduce((total, entry, index) => total + Number(entry) * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(value[9]) && digit(10) === Number(value[10]);
}

const pjWitnessSchema = z.object({
  name: z.string().trim().min(3, "Informe o nome completo da testemunha.").max(180),
  email: z.string().trim().email("Informe um e-mail válido para a testemunha.").max(240),
  cpf: z.string().transform((value) => value.replace(/\D/g, "")).refine(validCpf, "Informe um CPF válido para a testemunha."),
});

export const pjTerminationAgreementGenerateSchema = z.object({
  daysWorked: z.number().int().min(1, "Informe ao menos um dia trabalhado.").max(30, "O critério de trinta avos aceita no máximo 30 dias."),
  invoiceNumber: z.string().trim().min(1, "Informe o número da nota fiscal.").max(80),
  invoiceDate: dateOnlySchema,
  paymentConfirmed: z.literal(true, { errorMap: () => ({ message: "Confirme o recebimento antes de gerar o distrato." }) }),
  paymentDate: dateOnlySchema,
  signatureCity: z.string().trim().min(2, "Informe a cidade da assinatura.").max(180),
  forumCity: z.string().trim().min(2, "Informe o foro.").max(180),
  witnesses: z.tuple([pjWitnessSchema, pjWitnessSchema]),
});

export type PjTerminationAgreementGenerateInput = z.infer<typeof pjTerminationAgreementGenerateSchema>;

export const managedTerminationCreateSchema = z.object({
  source: z.literal("hr_manual"),
  employeeId: z.string().trim().min(1),
  employerUnitId: z.string({ required_error: "Selecione o CNPJ empregador." }).trim().min(1, "Selecione o CNPJ empregador."),
  terminationDate: dateOnlySchema,
  terminationReason: z.union([
    z.enum(CLT_TERMINATION_REASONS),
    z.enum(PJ_TERMINATION_REASONS),
  ]),
  terminationCause: z.enum(JUST_CAUSE_TYPES).optional(),
  terminationNotes: z.string().trim().max(2000).optional(),
  terminationInternalReason: z.string().trim().max(2000).optional(),
  communicationConfirmed: z.boolean().optional(),
  communicationAt: z.string().datetime().optional(),
  communicationLocation: z.string().trim().max(240).optional(),
  communicationParticipants: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
  noticeType: z.enum(["worked", "indemnified"]).optional(),
}).superRefine((value, context) => {
  const isJustCause = value.terminationReason === "Dispensa por justa causa";
  if (isJustCause && !value.terminationCause) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["terminationCause"],
      message: "Selecione o subtipo da justa causa.",
    });
  }
  if (!isJustCause && value.terminationCause) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["terminationCause"],
      message: "O subtipo de justa causa não se aplica ao motivo selecionado.",
    });
  }
  if (value.terminationReason === "Dispensa sem justa causa") {
    if (value.communicationConfirmed !== true) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["communicationConfirmed"], message: "Confirme que a colaboradora já foi comunicada presencialmente." });
    }
    if (!value.communicationAt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["communicationAt"], message: "Informe a data e a hora da comunicação presencial." });
    }
    if (!value.communicationLocation || value.communicationLocation.length < 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["communicationLocation"], message: "Informe o local da comunicação presencial." });
    }
    if (!value.noticeType) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["noticeType"], message: "Informe o tipo de aviso-prévio." });
    }
    if (value.communicationAt && value.terminationDate < value.communicationAt.slice(0, 10)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["terminationDate"], message: "O último dia de trabalho não pode ser anterior à comunicação presencial." });
    }
    if (!value.terminationInternalReason || value.terminationInternalReason.length < 3) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["terminationInternalReason"], message: "Registre o motivo interno e confidencial do desligamento." });
    }
  }
});

export type ManagedTerminationCreateInput = z.infer<typeof managedTerminationCreateSchema>;
