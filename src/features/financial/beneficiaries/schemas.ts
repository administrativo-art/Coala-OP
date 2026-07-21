import { z } from "zod";

export const paymentBeneficiaryReferenceSchema = z.discriminatedUnion("sourceType", [
  z.object({ sourceType: z.literal("employee"), sourceId: z.string().trim().min(1) }),
  z.object({ sourceType: z.literal("entity"), sourceId: z.string().trim().min(1) }),
]);

const bankDetailsSchema = z.object({
  bankCode: z.string().trim().min(1, "Banco obrigatório."),
  agency: z.string().trim().min(1, "Agência obrigatória."),
  account: z.string().trim().min(1, "Conta obrigatória."),
  accountType: z.enum(["checking", "savings", "payment"]),
});

export const supplierPaymentProfileInputSchema = z
  .object({
    active: z.boolean().default(true),
    paymentMethod: z.enum(["pix_key", "pix_copy_paste", "bank_details"]),
    pixKeyType: z.enum(["cpf", "cnpj", "email", "phone", "random"]).optional(),
    pixKey: z.string().trim().max(180).optional(),
    pixCopyPaste: z.string().trim().max(1200).optional(),
    bankDetails: bankDetailsSchema.optional(),
    holderName: z.string().trim().min(2).max(180),
    holderDocument: z.string().trim().min(11).max(24),
    validated: z.boolean().default(false),
    keepExistingDestination: z.boolean().default(false),
  })
  .superRefine((data, context) => {
    if (data.paymentMethod === "pix_key" && !data.pixKey && !data.keepExistingDestination) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pixKey"], message: "Informe a chave Pix." });
    }
    if (data.paymentMethod === "pix_key" && !data.pixKeyType) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pixKeyType"], message: "Informe o tipo da chave Pix." });
    }
    if (data.paymentMethod === "pix_copy_paste" && !data.pixCopyPaste && !data.keepExistingDestination) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pixCopyPaste"], message: "Informe o Pix Copia e Cola." });
    }
    if (data.paymentMethod === "bank_details" && !data.bankDetails && !data.keepExistingDestination) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["bankDetails"], message: "Informe os dados bancários." });
    }
  });

export const asoClinicConfigInputSchema = z.object({
  entityId: z.string().trim().min(1),
  active: z.boolean().default(true),
  asoPrice: z.coerce.number().positive("O valor do ASO deve ser positivo."),
  defaultPaymentDescription: z.string().trim().min(3).max(240),
  schedulingEmail: z.string().trim().email(),
  address: z.object({
    street: z.string().trim().min(2).max(180),
    number: z.string().trim().min(1).max(30),
    complement: z.string().trim().max(120).optional(),
    district: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(120),
    state: z.string().trim().length(2).transform((value) => value.toUpperCase()),
    postalCode: z.string().trim().min(8).max(10),
    reference: z.string().trim().max(240).optional(),
    mapsUrl: z.string().trim().url().optional().or(z.literal("")),
  }),
});
