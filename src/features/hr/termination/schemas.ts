import { z } from "zod";

import {
  CLT_TERMINATION_REASONS,
  PJ_TERMINATION_REASONS,
} from "@/lib/hr/employment-relationship";
import { JUST_CAUSE_TYPES } from "@/lib/hr/termination-options";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

export const managedTerminationCreateSchema = z.object({
  source: z.literal("hr_manual"),
  employeeId: z.string().trim().min(1),
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
