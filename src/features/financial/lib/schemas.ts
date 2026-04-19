import { z } from "zod";

export const expenseFormSchema = z
  .object({
    accountPlan: z.string().min(1, "O plano de contas é obrigatório."),
    description: z
      .string()
      .min(10, "A descrição deve ter pelo menos 10 caracteres."),
    totalValue: z.coerce.number().positive("O valor total deve ser positivo."),
    competenceDate: z.date({
      required_error: "Data de competência é obrigatória.",
    }),
    dueDate: z.date().optional(),
    isApportioned: z.boolean().default(false),
    resultCenter: z.string().optional(),
    apportionments: z
      .array(
        z.object({
          resultCenter: z.string().min(1, "Centro de resultado é obrigatório."),
          percentage: z.coerce
            .number()
            .min(1, "Porcentagem deve ser maior que 0."),
        })
      )
      .optional(),
    paymentMethod: z.enum(["single", "installments"]).default("single"),
    installments: z.coerce
      .number()
      .int()
      .min(2, "O número mínimo de parcelas é 2.")
      .optional(),
    installmentType: z.enum(["equal", "varied"]).optional(),
    firstInstallmentDueDate: z.date().optional(),
    installmentPeriodicity: z
      .enum(["monthly", "weekly", "biweekly"])
      .default("monthly")
      .optional(),
    variedInstallments: z
      .array(
        z.object({
          dueDate: z.date({ required_error: "Data de vencimento é obrigatória." }),
          value: z.coerce.number().positive("O valor deve ser positivo."),
        })
      )
      .optional(),
    supplier: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.paymentMethod === "single") {
        return !!data.dueDate;
      }
      return true;
    },
    {
      message: "Data de vencimento é obrigatória para pagamento à vista.",
      path: ["dueDate"],
    }
  )
  .refine(
    (data) => {
      if (data.isApportioned) {
        return data.apportionments && data.apportionments.length > 0;
      }
      return !!data.resultCenter;
    },
    {
      message: "Defina a unidade ou o rateio.",
      path: ["resultCenter"],
    }
  )
  .refine(
    (data) => {
      if (data.isApportioned && data.apportionments) {
        const totalPercentage = data.apportionments.reduce(
          (sum, item) => sum + item.percentage,
          0
        );
        return Math.abs(totalPercentage - 100) < 0.001;
      }
      return true;
    },
    {
      message: "A soma dos percentuais do rateio deve ser 100%.",
      path: ["apportionments"],
    }
  )
  .refine(
    (data) => {
      if (data.paymentMethod === "installments") {
        return data.installments && data.installments >= 2;
      }
      return true;
    },
    {
      message: "O número de parcelas deve ser no mínimo 2.",
      path: ["installments"],
    }
  )
  .refine(
    (data) => {
      if (
        data.paymentMethod === "installments" &&
        data.installmentType === "equal"
      ) {
        return !!data.firstInstallmentDueDate;
      }
      return true;
    },
    {
      message: "A data do primeiro vencimento é obrigatória.",
      path: ["firstInstallmentDueDate"],
    }
  )
  .refine(
    (data) => {
      if (
        data.paymentMethod === "installments" &&
        data.installmentType === "varied" &&
        data.variedInstallments &&
        data.installments
      ) {
        if (data.variedInstallments.length !== data.installments) return false;
        const total = data.variedInstallments.reduce(
          (acc, curr) => acc + (curr.value || 0),
          0
        );
        return Math.abs(total - (data.totalValue || 0)) < 0.01;
      }
      return true;
    },
    {
      message:
        "A soma dos valores deve ser igual ao valor total e a quantidade de parcelas deve ser a mesma.",
      path: ["variedInstallments"],
    }
  );

export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

export const accountPlanFormSchema = z.object({
  name: z.string().min(3, "O nome da conta deve ter pelo menos 3 caracteres."),
  description: z.string().optional(),
  parentId: z.string().nullable().optional(),
});
export type AccountPlanFormValues = z.infer<typeof accountPlanFormSchema>;

export const resultCenterFormSchema = z.object({
  name: z
    .string()
    .min(3, "O nome do centro de resultado deve ter pelo menos 3 caracteres."),
  description: z.string().optional(),
  unitIds: z.array(z.string()).optional().default([]),
});
export type ResultCenterFormValues = z.infer<typeof resultCenterFormSchema>;

export const paymentMethodSchema = z.object({
  id: z.string(),
  type: z.enum(["debit_card", "credit_card", "pix", "transfer", "cash"]),
  label: z.string().min(1, "Rótulo é obrigatório."),
  lastDigits: z.string().max(4).optional(),
  cardNumber: z.string().optional(),
  limit: z.coerce.number().optional(),
  pixKey: z.string().optional(),
});

export const bankAccountSchema = z.object({
  name: z.string().min(2, "Nome da instituição é obrigatório."),
  agency: z.string().optional(),
  accountNumber: z.string().optional(),
  active: z.boolean().default(true),
  resultCenterId: z.string().optional(),
  paymentMethods: z
    .array(paymentMethodSchema)
    .min(1, "Adicione pelo menos uma forma de pagamento."),
});
export type BankAccountFormValues = z.infer<typeof bankAccountSchema>;
export type PaymentMethodValues = z.infer<typeof paymentMethodSchema>;
