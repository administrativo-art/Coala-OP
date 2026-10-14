import { z } from "zod";

const requestedProductSchema = z.object({
  productId: z.string().trim().min(1).max(160),
  productName: z.string().trim().min(1).max(240),
  packages: z.number().finite().positive(),
  quantityBase: z.number().finite().positive(),
}).strict();

export const repositionRequestItemSchema = z.object({
  baseProductId: z.string().trim().min(1).max(160),
  productName: z.string().trim().min(1).max(240),
  unit: z.string().trim().min(1).max(40),
  currentStock: z.number().finite().nonnegative(),
  minimumStock: z.number().finite().nonnegative(),
  requestedQuantity: z.number().finite().positive(),
  requestedProducts: z.array(requestedProductSchema).max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict();

export const createRepositionRequestSchema = z.object({
  kioskId: z.string().trim().min(1).max(160).refine((value) => !value.includes("/")),
  items: z.array(repositionRequestItemSchema).min(1).max(100),
  notes: z.string().trim().max(2000).optional(),
}).strict();

export const cancelRepositionRequestSchema = z.object({
  status: z.literal("Cancelada"),
}).strict();

export type CreateRepositionRequestInput = z.infer<typeof createRepositionRequestSchema>;
export type CancelRepositionRequestInput = z.infer<typeof cancelRepositionRequestSchema>;
