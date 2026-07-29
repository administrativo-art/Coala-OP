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
});

export type ManagedTerminationCreateInput = z.infer<typeof managedTerminationCreateSchema>;
