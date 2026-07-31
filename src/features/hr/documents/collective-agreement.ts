import { z } from "zod";

export const collectiveAgreementInputSchema = z.object({
  unitId: z.string().trim().min(1, "Selecione a unidade."),
  registryNumber: z.string().trim().min(2, "Informe o registro da CCT no MTE.").max(120),
  validFrom: z.string().date("Informe a data inicial da vigência."),
  validUntil: z.string().date("Informe a data final da vigência."),
  employeeUnion: z.string().trim().min(2, "Informe o sindicato profissional.").max(240),
  employerUnion: z.string().trim().min(2, "Informe o sindicato patronal.").max(240),
  notes: z.string().trim().max(1000).optional(),
}).refine((value) => value.validUntil >= value.validFrom, {
  message: "O fim da vigência não pode ser anterior ao início.",
  path: ["validUntil"],
});

export type CollectiveAgreementInput = z.infer<typeof collectiveAgreementInputSchema>;

export function collectiveAgreementPeriodsOverlap(
  left: Pick<CollectiveAgreementInput, "validFrom" | "validUntil">,
  right: Pick<CollectiveAgreementInput, "validFrom" | "validUntil">,
) {
  return left.validFrom <= right.validUntil && right.validFrom <= left.validUntil;
}
