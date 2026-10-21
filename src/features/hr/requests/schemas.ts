import { z } from "zod";

/** Pedido de vale-transporte do próprio colaborador; também valida o payload do Coala Go. */
export const transportVoucherRequestCreateSchema = z.object({
  action: z.enum(["activate", "change", "suspend", "reactivate"]),
  details: z.string().trim().max(1_500).optional().default(""),
}).strict();
